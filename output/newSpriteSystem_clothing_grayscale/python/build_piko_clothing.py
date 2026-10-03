"""Build aligned 32px Piko clothing overlays and a portable wardrobe preview.

Usage: py python/build_piko_clothing.py --source PATH --output PATH
Requires Pillow. Source images are read only; use a fresh output directory.
"""

import argparse
import hashlib
import json
import shutil
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

SIZE = 32
ROWS = ["front", "left", "right", "back"]
CLEAR = (0, 0, 0, 0)


def rgba(color):
    return tuple(bytes.fromhex(color.lstrip("#"))) + (255,)  # Decode an opaque palette swatch.


GRAYSCALE = [rgba(c) for c in ["878787", "bbbbbb", "ececec", "ffffff", "ffffff"]]  # One neutral palette for engine tinting.


def tile(sheet, row, col):
    return sheet.crop((col * SIZE, row * SIZE, (col + 1) * SIZE, (row + 1) * SIZE))  # Preserve original frame origins.


def opaque(im, x, y):
    return 0 <= x < SIZE and 0 <= y < SIZE and im.getpixel((x, y))[3] != 0  # Keep pixel reads inside this frame.


def recolor(im, palette, family="cloth"):
    result = Image.new("RGBA", im.size)
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = im.getpixel((x, y))
            if not a:
                continue
            if family == "skin":
                shade = 0 if r == 186 else 1 if r == 221 else 3 if r == 255 else 2
            elif family == "shoe":
                shade = 0 if r == 81 else 1 if r == 99 else 2 if r == 111 else 3
            else:
                shade = 0 if r <= 156 else 1 if r <= 201 else 2
            result.putpixel((x, y), palette[shade])
    return result  # Reuse source shading with a small opaque pixel-art palette.


def mark(im, x, y, color):
    if opaque(im, x, y):
        im.putpixel((x, y), color)  # Decorations never introduce floating pixels outside the garment.


def top(src, row, col, palette, style):
    tee = tile(src["Tee.png"], row, col)
    body = tile(src["Piko_Woman_Walk_4-dir_V2.png"], row, col)
    result = recolor(tee, palette)
    bob = col % 2
    if style in ("Hoodie", "Cardigan"):
        arms = recolor(body, palette, "skin")
        for y in range(15 + bob, 20 + (row == 3)):
            for x in range(SIZE):
                if opaque(arms, x, y) and not opaque(tee, x, y):
                    result.putpixel((x, y), arms.getpixel((x, y)))
        result.alpha_composite(recolor(tee, palette))  # Retain the source shirt's foreground arm seams.
    if style == "Striped_Tee":
        for y in range(14 + bob, 21 + bob):
            for x in range(SIZE):
                if result.getpixel((x, y)) == palette[2] and (y - bob) % 3 == 0:
                    result.putpixel((x, y), palette[3])  # Keep white stripes visible against the light-gray fabric after engine tinting.
    elif style == "Hoodie":
        if row == 0:
            for x in (14, 16):
                mark(result, x, 14 + bob, palette[4])
            for x in range(14, 17):
                mark(result, x, 18 + bob, palette[1])
        elif row == 3:
            for y, span in [(12, (13, 17)), (13, (12, 18)), (14, (13, 17)), (15, (14, 16))]:
                for x in range(span[0], span[1] + 1):
                    mark(result, x, y + bob, palette[1] if x in span or y == 15 else palette[3])
    elif style == "Cardigan" and row != 3:
        seam = 15 if row == 0 else 13 if row == 1 else 17
        for y in range(14 + bob, 21 + bob):
            mark(result, seam, y, palette[0])
            if (y - bob) % 3 == 0:
                mark(result, seam, y, palette[4])
    return result  # Tops preserve the tee's neckline, gait, and sleeve registration.


def trousers(src, row, col, palette, style):
    body = tile(src["Piko_Woman_Walk_4-dir_V2.png"], row, col)
    shoes = tile(src["Shoes.png"], row, col)
    shorts = tile(src["Booty_Shorts.png"], row, col)
    colored = recolor(body, palette, "skin")
    result = Image.new("RGBA", (SIZE, SIZE))
    # These hip spans exclude the hands as they swing across the upper thighs.
    hips = [
        [(12, 18), (12, 16), (12, 18), (14, 18)],
        [(13, 16), (13, 19), (13, 16), (14, 19)],
        [(14, 17), (11, 16), (14, 17), (11, 17)],
        [(12, 18), (14, 18), (12, 18), (12, 16)],
    ][row][col]
    waist = 19 if row == 3 else 20 + col % 2
    for y in range(waist, SIZE):
        for x in range(SIZE):
            include = y >= 24 or hips[0] <= x <= hips[1] or opaque(shorts, x, y)
            if include and opaque(body, x, y) and not opaque(shoes, x, y):
                result.putpixel((x, y), colored.getpixel((x, y)))
    for x in range(hips[0], hips[1] + 1):
        mark(result, x, waist, palette[0])
    if row == 0:
        mark(result, 15, waist, palette[4])
    if style == "Jeans":
        for x in (hips[0] + 1, hips[1] - 1):
            mark(result, x, waist + 1, palette[3])
            mark(result, x, waist + 2, palette[1])
    else:
        for y in range(24, 28):
            for x in range(SIZE):
                if result.getpixel((x, y)) == palette[2] and opaque(result, x - 1, y) and not opaque(result, x - 2, y):
                    mark(result, x, y, palette[3])
    return result  # Trousers follow the original leg poses, leaving the feet for separate shoes.


def skirt_mask(src, row, col):
    dress = tile(src["Piko_Dress_Walk_4-dir_V1.png"], row, col)
    result = Image.new("RGBA", (SIZE, SIZE))
    start = (18 if row in (0, 3) else 18) + col % 2
    for y in range(start, 28 + (row in (1, 2) and col == 1)):
        for x in range(SIZE):
            p = dress.getpixel((x, y))
            if not p[3]:
                continue
            # Remove the detached side bow; the back bow becomes plain fabric.
            if row in (1, 2) and p[0] != p[1]:
                whites = [xx for xx in range(SIZE) if opaque(dress, xx, y) and dress.getpixel((xx, y))[0] == dress.getpixel((xx, y))[1]]
                if y >= 20 and whites and not min(whites) <= x <= max(whites):
                    continue
                if y < 20 and ((row == 1 and x > 19) or (row == 2 and x < 11)):
                    continue
            result.putpixel((x, y), (236, 236, 236, 255) if p[0] != p[1] else p)
    return result  # Retain the dress's hand occlusions and animated hem while removing its large bow.


def dress_or_skirt(src, row, col, palette, style):
    skirt = recolor(skirt_mask(src, row, col), palette)
    bob = col % 2
    for y in range(20 + bob, 28):
        for x in range(SIZE):
            if skirt.getpixel((x, y)) == palette[2]:
                if style == "Pleated_Skirt" and (x - col % 2) % 3 == 0:
                    skirt.putpixel((x, y), palette[1])
                elif style == "Sundress" and (x + 2 * y) % 7 == 0:
                    skirt.putpixel((x, y), palette[4])
    if style == "Pleated_Skirt":
        for x in range(SIZE):
            mark(skirt, x, 19 + bob, palette[0])
        return skirt
    dress = tile(src["Piko_Dress_Walk_4-dir_V1.png"], row, col)
    result = Image.new("RGBA", (SIZE, SIZE))
    if style == "Pinafore":
        result = recolor(tile(src["Tee.png"], row, col), GRAYSCALE)
    for y in range(11, 20 + bob):
        for x in range(SIZE):
            p = dress.getpixel((x, y))
            if not p[3]:
                continue
            if row == 1 and x > 19 or row == 2 and x < 11:
                continue
            # The pinafore keeps a light undershirt and two narrow shoulder straps.
            if style == "Pinafore" and y < 15 + bob and row in (0, 3) and x not in (13, 17):
                continue
            shade = 0 if p[0] == 135 else 1 if p[0] == 187 and p[1] == 187 else 2
            result.putpixel((x, y), palette[shade])
    result.alpha_composite(skirt)
    for x in range(SIZE):
        mark(result, x, 19 + bob, palette[1])
    if style == "Pinafore" and row == 0:
        for x in (14, 16):
            mark(result, x, 15 + bob, palette[4])
        for x in range(14, 17):
            mark(result, x, 17 + bob, palette[1])
    return result  # Dresses and pinafores occupy both the top and bottom clothing slots.


def footwear(src, row, col, palette, style):
    shoes = tile(src["Shoes.png"], row, col)
    socks = tile(src["Piko_Socks_Walk_4-dir_V1.png"], row, col)
    result = recolor(socks, palette) if style == "Boots" else Image.new("RGBA", (SIZE, SIZE))
    if style == "Boots":
        for x in range(SIZE):
            ys = [y for y in range(SIZE) if opaque(result, x, y)]
            if ys:
                mark(result, x, min(ys), palette[0])
    result.alpha_composite(recolor(shoes, palette, "shoe"))
    if style == "Mary_Janes":
        # One small buckle per disconnected foot reads clearly at this tiny scale.
        unseen = {(x, y) for y in range(SIZE) for x in range(SIZE) if opaque(shoes, x, y)}
        while unseen:
            pending = [min(unseen)]
            component = set()
            while pending:
                point = pending.pop()
                if point not in unseen:
                    continue
                unseen.remove(point)
                component.add(point)
                x, y = point
                pending.extend([(x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)])
            top_y = min(y for _, y in component)
            upper = sorted(x for x, y in component if y == top_y + 1)
            if len(upper) >= 3:
                mark(result, upper[-2], top_y + 1, palette[4])
    return result  # Boots use the sock shaft; low shoes retain the original foot outlines.


DESIGNS = [
    ("Hoodie", "top", top),
    ("Cardigan", "top", top),
    ("Striped_Tee", "top", top),
    ("Jeans", "bottom", trousers),
    ("Chinos", "bottom", trousers),
    ("Pleated_Skirt", "bottom", dress_or_skirt),
    ("Sundress", "dress", dress_or_skirt),
    ("Pinafore", "dress", dress_or_skirt),
    ("Boots", "shoes", footwear),
    ("Mary_Janes", "shoes", footwear),
]


def outfit(src, sheets, names, body="Piko_Woman_Walk_4-dir_V2.png"):
    result = src[body].copy()
    for name in names:
        result.alpha_composite(sheets[name])
    result.alpha_composite(recolor(src["Piko_Hair_Walk_4-dir_V1.png"], GRAYSCALE))
    return result  # Compose an outfit using the same common origin as the game.


def previews(src, sheets, output):
    looks = [
        ("Hoodie with jeans", ["Jeans", "Hoodie", "Boots"]),
        ("Hoodie with chinos", ["Chinos", "Hoodie", "Mary_Janes"]),
        ("Cardigan with skirt", ["Pleated_Skirt", "Cardigan", "Mary_Janes"]),
        ("Cardigan with jeans", ["Jeans", "Cardigan", "Boots"]),
        ("Striped tee with chinos", ["Chinos", "Striped_Tee", "Mary_Janes"]),
        ("Striped tee with skirt", ["Pleated_Skirt", "Striped_Tee", "Boots"]),
        ("Sundress with Mary Janes", ["Sundress", "Mary_Janes"]),
        ("Sundress with boots", ["Sundress", "Boots"]),
        ("Pinafore with boots", ["Pinafore", "Boots"]),
        ("Pinafore with Mary Janes", ["Pinafore", "Mary_Janes"]),
    ]  # Show ten distinct outfit combinations using the ten unique base items.
    font = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 16)
    frames = []
    for frame in range(4):
        canvas = Image.new("RGB", (1280, 868), "#202a37")
        draw = ImageDraw.Draw(canvas)
        draw.text((24, 12), "PIKO WARDROBE | white grayscale overlays | front / left / right / back", font=font, fill="#ffffff")
        for index, (label, names) in enumerate(looks):
            x, y = index % 2 * 640, index // 2 * 162 + 52
            draw.rounded_rectangle((x + 8, y, x + 632, y + 154), radius=10, fill="#2e3a48")
            label = " / ".join(name.replace("_", " ") for name in names)
            draw.text((x + 20, y + 8), label, font=font, fill="white")
            composed = outfit(src, sheets, names)
            for row in range(4):
                sprite = tile(composed, row, frame).resize((112, 112), Image.Resampling.NEAREST)
                canvas.paste(sprite, (x + 58 + row * 138, y + 34), sprite)
        frames.append(canvas)
    frames[0].save(output / "wardrobe_preview.png")
    frames[0].save(output / "wardrobe_walk.gif", save_all=True, append_images=frames[1:], duration=180, loop=0)
    return [(f"Outfit {index + 1}: " + " / ".join(name.replace("_", " ") for name in names), names)
            for index, (_, names) in enumerate(looks)]  # Label presets by garment instead of their retired baked-in colors.


def write_viewer(output, manifest, looks):
    data = json.dumps({"items": manifest["items"], "looks": looks})
    template = r'''<!doctype html>
<html lang="en"><meta charset="utf-8"><title>Piko wardrobe preview</title>
<style>
body{background:#202a37;color:#eee;font:16px system-ui;max-width:1060px;margin:32px auto;padding:0 20px}
main{display:flex;gap:28px;flex-wrap:wrap} aside{width:310px}label{display:block;margin:14px 0 5px}
select,button,input{font:inherit;padding:7px;width:100%;box-sizing:border-box}button{margin-top:16px;cursor:pointer}
canvas{image-rendering:pixelated;border:1px solid #617386}p{line-height:1.5;color:#bfcdd9}h1{font-size:26px}
</style><h1>Piko wardrobe preview</h1><p>10 unique white grayscale clothing overlays for engine tinting. Every sheet uses the original 128×128 canvas and sixteen 32×32 frames.</p>
<main><aside><label for="look">Outfit</label><select id="look"></select>
<label for="body">Body</label><select id="body"><option value="Piko_Woman_Walk_4-dir_V2.png">Woman V2</option><option value="Piko_Man_Walk_4-dir_V1.png">Man V1</option></select>
<label for="direction">Direction</label><select id="direction"><option>Front</option><option>Left</option><option>Right</option><option>Back</option></select>
<label for="top">Top</label><select id="top"></select><label for="bottom">Bottom</label><select id="bottom"></select>
<label for="dress">Dress (replaces top and bottom)</label><select id="dress"></select>
<label for="shoes">Footwear</label><select id="shoes"></select>
<label for="speed">Frames per second</label><input id="speed" type="range" min="1" max="12" value="6">
<button id="pause">Pause animation</button><p id="status">Loading images…</p></aside>
<section><canvas id="walk" width="384" height="384"></canvas><p>Animation at 12× zoom, with nearest-neighbor pixels.</p>
<canvas id="sheet" width="512" height="512"></canvas><p>Composite sheet: four columns × four direction rows.</p></section></main>
<script>
const pack = DATA;
const $ = id => document.getElementById(id);
const images = new Map();
const slots = ['top','bottom','dress','shoes'];
for (const slot of slots) {
  $(slot).add(new Option('None',''));
  for (const item of pack.items.filter(item => item.slot === slot)) $(slot).add(new Option(item.name,item.id));
}
pack.looks.forEach(([name],index) => $('look').add(new Option(name,index)));
function chooseLook() { // Apply a complete outfit without leaving conflicting layers selected.
  slots.forEach(slot => $(slot).value = '');
  for (const id of pack.looks[Number($('look').value)][1]) {
    const item = pack.items.find(item => item.id === id); $(item.slot).value = id;
  }
}
$('look').onchange = chooseLook; chooseLook();
$('dress').onchange = () => { if ($('dress').value) {$('top').value = ''; $('bottom').value = '';}};
for (const slot of ['top','bottom']) $(slot).onchange = () => {$('dress').value = '';};
let paused = false, frame = 0, last = 0;
$('pause').onclick = () => { paused = !paused; $('pause').textContent = paused ? 'Resume animation' : 'Pause animation'; };
function background(ctx,width,height,cell) { // Draw a checkerboard to reveal the transparent canvas.
  for (let y=0;y<height;y+=cell) for(let x=0;x<width;x+=cell) {
    ctx.fillStyle = ((x+y)/cell)%2 ? '#394755' : '#303d4a'; ctx.fillRect(x,y,cell,cell);
  }
}
const sources = [...pack.items.map(item=>[item.id,item.file]),...['Piko_Woman_Walk_4-dir_V2.png','Piko_Man_Walk_4-dir_V1.png','hair.png'].map(name=>[name,'reference/'+name])];
Promise.all(sources.map(([id,path])=>new Promise((resolve,reject)=>{
  const img=new Image();img.onload=()=>{images.set(id,img);resolve();};img.onerror=()=>reject(new Error(path));img.src=path;
}))).then(()=>{$('status').textContent='Loaded. Original frame offsets are preserved.'; requestAnimationFrame(draw);})
.catch(error=>{$('status').textContent='Could not load '+error.message+'. Keep this file inside the complete pack folder.';});
function draw(now) { // Render the selected layers at their unmodified frame origins.
  if (!paused && now-last >= 1000/Number($('speed').value)) {frame=(frame+1)%4;last=now;}
  const layers=[$('body').value];
  for(const slot of ($('dress').value ? ['dress','shoes'] : ['bottom','top','shoes'])) if($(slot).value) layers.push($(slot).value);
  layers.push('hair.png');
  const walk=$('walk').getContext('2d'), sheet=$('sheet').getContext('2d');
  walk.imageSmoothingEnabled=false;sheet.imageSmoothingEnabled=false;
  background(walk,384,384,24);background(sheet,512,512,16);
  for(const id of layers) {walk.drawImage(images.get(id),frame*32,$('direction').selectedIndex*32,32,32,0,0,384,384);sheet.drawImage(images.get(id),0,0,512,512);}
  sheet.strokeStyle='#718292';for(let i=0;i<=4;i++){sheet.beginPath();sheet.moveTo(i*128,0);sheet.lineTo(i*128,512);sheet.moveTo(0,i*128);sheet.lineTo(512,i*128);sheet.stroke();}
  requestAnimationFrame(draw);
}
</script></html>'''
    (output / "preview.html").write_text(template.replace("DATA", data), encoding="utf-8")  # Embed metadata so local-file previews need no web server.


def write_docs(output):
    docs = {
        "README.md": """# Piko clothing expansion

Ten unique white grayscale PNG overlays, named by base item. The engine
applies color; duplicate color variants have been removed. Open
`preview.html` to mix garments and inspect four-direction walking on either
supplied body. `wardrobe_preview.png` is the contact sheet; `wardrobe_walk.gif`
is the animated version. No server or internet connection is needed.

| Item | Filename | Slot |
| --- | --- | --- |
| Hoodie | Hoodie.png | top |
| Cardigan | Cardigan.png | top |
| Striped Tee | Striped_Tee.png | top |
| Jeans | Jeans.png | bottom |
| Chinos | Chinos.png | bottom |
| Pleated Skirt | Pleated_Skirt.png | bottom |
| Sundress | Sundress.png | dress |
| Pinafore | Pinafore.png | dress |
| Boots | Boots.png | shoes |
| Mary Janes | Mary_Janes.png | shoes |

## Import and layering

Import PNGs from `sheets/`. Each image is 128x128 RGBA with a 4x4 grid of
32x32 frames, no padding, and binary transparency. Slice into sixteen frames
without trimming or rescaling. Rows are front, left, right, back; columns
retain the original walk order, including repeated neutral poses.
Frame index = direction_row * 4 + walk_column. The body and all overlays
must use the same index and origin. Bottom center (16, 32) is a suggested
origin, not metadata recovered from a GameMaker project.

Draw body, bottom, top, footwear, then hair. A dress replaces both top and
bottom; pinafores include their undershirt. Select one item per slot.
Use nearest-neighbor rendering and disable texture interpolation.
All clothing RGB channels are equal: outline 135, shadow 187, fabric 236,
highlight/accent 255. Apply the engine tint by multiplying RGB; retain alpha.
The original body reference copies retain their skin colors for fit review.
The preview copies in `reference/` are supporting assets from the supplied
pack, with recolored hair; they are not additional clothing options.

These are standalone art assets, not an installed GameMaker resource or a
MommyBot wardrobe catalog update. The source folder contained no project
configuration. Body proportions follow Woman V2; both supplied bodies were
reviewed visually. Check final draw order and origins in your game.
Existing garment bulks, collision masks, economy rules, dialogue, and quests
are not inferred from the art.

## Rebuild

Requires Python 3 and Pillow. From this pack directory:

    py python/build_piko_clothing.py --source "PATH_TO_ORIGINAL_SHEETS" --output "PATH_TO_NEW_PACK"

The source is read only. Rebuilding writes generated filenames in the output
directory; use a new directory to protect manual edits. Keep the original
asset license/credits with any redistribution; this pack does not assign a
new license to the source artwork.

See CONTRIBUTOR_GUIDE.md, GENERATION_TUNING_GUIDE.md, QUEST_MAKING_GUIDE.md,
NPC_DIALOGUE_TREES.md, PLAYER_CHECKLIST.md, and TESTING_GUIDE.md for handoff notes.
""",
        "CONTRIBUTOR_GUIDE.md": """# Contributing clothing

Edit `python/build_piko_clothing.py`. `DESIGNS` defines styles, base item IDs, and
slots; `GRAYSCALE` defines outline, shadow, fabric, highlight, and accent.
Keep 32x32 frame origins and original gait positions. Draw on transparent
layers and use only alpha 0/255. Never crop frames to garment bounds.
Add new stable IDs rather than changing IDs already referenced by game data.
Regenerate into a new folder, inspect the preview, and compare source hashes.
The workspace modding editor also offers a Piko sprite-pack preview launcher.
""",
        "GENERATION_TUNING_GUIDE.md": """# Clothing generation tuning

Generation is deterministic pixel editing, with no image model or API.
All garments use GRAYSCALE (135, 187, 236, 255); the engine supplies color.
Each design exports one base-item filename; no color variants are generated.
Tops reuse tee shading; longer sleeves follow the body's arm pixels.
Trousers use explicit hip spans to keep hands visible and follow leg pixels.
Skirts and dresses reuse animated hem registration and remove the large bow.
Boot shafts follow the socks; shoe buckles are one pixel per connected foot.
Tune poses in the relevant function before adjusting neutral shading values.
The manifest records source SHA-256 hashes. Preview timing defaults to about
six frames per second; animation timing remains a game integration choice.
""",
        "QUEST_MAKING_GUIDE.md": """# Using clothing as quest rewards

This pack supplies art only. Use item IDs from `manifest.json` when adding
rewards to the actual game's item registry. Register the item before granting
it. Dresses occupy both top and bottom; footwear occupies the shoes slot.
No quests, reward probabilities, prices, or unlock requirements are included.
""",
        "NPC_DIALOGUE_TREES.md": """# Clothing dialogue handoff

No dialogue trees are changed by this art pack. Display names in
`manifest.json` can label wardrobe or shop choices after game integration.
Do not infer warmth, protection, absorbency, or character reactions from a
sprite. Those behaviors need authored item metadata and dialogue conditions.
""",
        "PLAYER_CHECKLIST.md": """# Wardrobe review checklist

- Open `preview.html` and try all ten preset outfits.
- Compare both body options in front, left, right, and back views.
- Mix tops, bottoms, and shoes; dresses replace the top and bottom selection.
- Pause the animation to examine hand overlaps and seams at the waist.
- Confirm the imported game's frames and layers match the browser preview.

The preview does not equip items in a saved game.
""",
        "TESTING_GUIDE.md": """# Validating this sprite pack

The generator checks all ten sheets for 128x128 dimensions, binary alpha,
sixteen nonempty frames, and unexpected top/side frame-edge pixels.
`validation.json` records all 160 frame bounds. Contact sheets and the
animated preview are for visual checks; automated dimensions do not prove
that every combination will fit a modified body.

Before handoff, compare source hashes against `manifest.json`, confirm all
opaque pixels have R=G=B and all ten files have distinct pixels, and inspect walking hands, hips, hems,
and ankles on both supplied bodies. Open `preview.html` locally and confirm
its loaded status, controls, and pixel-sharp rendering. In-game import,
texture settings, and origin alignment require a final GameMaker check.
""",
    }
    for name, content in docs.items():
        (output / name).write_text(content, encoding="utf-8")
    (output / "python").mkdir(exist_ok=True)
    target = output / "python" / Path(__file__).name
    if target.resolve() != Path(__file__).resolve():
        shutil.copyfile(__file__, target)  # Include the exact build recipe in the portable pack.


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.source.resolve() == args.output.resolve():
        parser.error("Use a separate output folder to preserve the source images.")
    output = args.output
    output.mkdir(parents=True, exist_ok=True)
    (output / "sheets").mkdir(exist_ok=True)
    (output / "reference").mkdir(exist_ok=True)
    src = {path.name: Image.open(path).convert("RGBA") for path in args.source.glob("*.png")}
    if any(im.size != (128, 128) for im in src.values()):
        raise ValueError("All input sprite sheets must be 128×128.")
    manifest = {"sheet_size": [128, 128], "frame_size": [32, 32], "rows": ROWS,
                "color_mode": "white_grayscale", "tint": "multiply_rgb_preserve_alpha",
                "grayscale_values": sorted({p[0] for p in GRAYSCALE}),
                "columns": 4, "origin": [16, 32], "origin_note": "Suggested bottom center; every body and overlay must use the same origin.",
                "layer_order": ["body", "bottom", "top_or_dress", "shoes", "hair"],
                "source_sha256": {name: hashlib.sha256((args.source / name).read_bytes()).hexdigest() for name in sorted(src)}, "items": []}
    sheets = {}
    checks = []
    for style, slot, maker in DESIGNS:
        name = style  # Export one stable base-item ID and filename per unique design.
        sheet = Image.new("RGBA", (128, 128))
        for row in range(4):
            for col in range(4):
                frame = maker(src, row, col, GRAYSCALE, style)
                sheet.paste(frame, (col * SIZE, row * SIZE))
        sheet.save(output / "sheets" / f"{name}.png")
        sheets[name] = sheet
        manifest["items"].append({"id": name, "name": style.replace("_", " "),
                                  "slot": slot, "file": f"sheets/{name}.png", "design": style, "engine_tintable": True})
        alpha = set(sheet.getchannel("A").get_flattened_data())
        bounds = [tile(sheet, r, c).getbbox() for r in range(4) for c in range(4)]
        if alpha != {0, 255} or not all(bounds):
            raise ValueError(f"Invalid transparency or empty frames: {name}")
        if any(r != g or g != b for r, g, b, a in sheet.get_flattened_data() if a):
            raise ValueError(f"Non-grayscale garment pixels: {name}")  # Prevent baked-in color from returning on rebuild.
        if any(bound[0] == 0 or bound[2] == 32 or bound[1] == 0 for bound in bounds):
            raise ValueError(f"Unexpected frame-edge pixels: {name}")
        checks.append({"file": name + ".png", "size": list(sheet.size), "alpha": sorted(alpha), "grayscale": True,
                       "nonempty_frames": len(bounds), "frame_bounds": bounds})
    for name in ("Piko_Woman_Walk_4-dir_V2.png", "Piko_Man_Walk_4-dir_V1.png"):
        src[name].save(output / "reference" / name)
    recolor(src["Piko_Hair_Walk_4-dir_V1.png"], GRAYSCALE).save(output / "reference" / "hair.png")
    looks = previews(src, sheets, output)
    write_viewer(output, manifest, looks)
    write_docs(output)
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    (output / "validation.json").write_text(json.dumps({"sheets": checks, "total_frames": len(checks) * 16}, indent=2) + "\n", encoding="utf-8")
    print(f"Created {len(sheets)} sheets / {len(sheets) * 16} frames at {output}")  # Report the complete generated pack location.


if __name__ == "__main__":
    main()  # Build only when explicitly run, so the drawing helpers remain importable.
