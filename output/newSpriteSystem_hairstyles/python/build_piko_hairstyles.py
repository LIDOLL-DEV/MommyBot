"""Create eight grayscale Piko hair overlays with original 32px frame registration.

Usage: py python/build_piko_hairstyles.py --source PATH --clothing PATH --output PATH
Requires Pillow; source and clothing packs are read only.
"""

import argparse
import hashlib
import json
import shutil
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

STYLES = ["Pixie_Cut", "Blunt_Bob", "Shoulder_Length", "High_Ponytail",
          "Twin_Tails", "Side_Braid", "Double_Buns", "Spiky_Crop"]
GRAYS = [135, 187, 236, 255]
ROWS = ["front", "left", "right", "back"]


def tile(sheet, row, column):
    return sheet.crop((column * 32, row * 32, column * 32 + 32, row * 32 + 32))  # Preserve the source grid without trimming.


def silhouette(style, direction):
    mask = Image.new("L", (32, 32))
    draw = ImageDraw.Draw(mask)

    def polygon(points):
        draw.polygon(points, fill=255)  # Add a hand-authored silhouette to the shared frame mask.

    if direction == 0:
        polygon([(12, 0), (18, 0), (20, 2), (21, 5), (20, 7), (18, 6),
                 (17, 7), (14, 6), (12, 7), (10, 6), (10, 3)])
    elif direction == 1:
        polygon([(14, 0), (19, 0), (21, 2), (22, 5), (21, 8), (18, 8),
                 (17, 6), (12, 6), (11, 5), (11, 2)])
    else:
        polygon([(12, 0), (18, 0), (20, 2), (21, 5), (21, 8),
                 (19, 10), (12, 10), (10, 9), (9, 6), (10, 2)])

    if style == "Pixie_Cut":
        if direction == 0:
            polygon([(10, 4), (12, 4), (11, 8), (10, 7)])
            polygon([(18, 3), (21, 4), (20, 8), (19, 6)])
        elif direction == 1:
            polygon([(18, 5), (22, 5), (21, 9), (19, 8)])
        else:
            polygon([(11, 7), (20, 7), (18, 11), (15, 10), (13, 11)])
    elif style in ("Blunt_Bob", "Shoulder_Length"):
        hem = 12 if style == "Blunt_Bob" else 17
        outer = 9 if style == "Blunt_Bob" else 7
        if direction == 0:
            polygon([(11, 2), (12, 5), (11, hem), (outer, hem), (outer, 7), (9, 4)])
            polygon([(19, 2), (21, 4), (31 - outer, 7), (31 - outer, hem), (20, hem), (19, 5)])
        elif direction == 1:
            polygon([(19, 2), (22, 4), (23, 8), (24 if hem == 17 else 23, hem),
                     (17, hem), (17, 8), (18, 5)])
        else:
            polygon([(10, 3), (20, 3), (22, 7), (23 if hem == 17 else 22, hem),
                     (8 if hem == 17 else 9, hem), (9, 7)])
    elif style == "High_Ponytail":
        if direction == 0:
            polygon([(20, 2), (23, 2), (25, 4), (25, 8), (23, 13), (21, 14), (22, 8), (21, 5)])
        elif direction == 1:
            polygon([(21, 1), (24, 2), (26, 5), (25, 10), (22, 16), (21, 14), (23, 7), (21, 5)])
        else:
            polygon([(14, 2), (18, 2), (20, 6), (19, 12), (17, 17), (14, 16), (13, 11), (12, 6)])
    elif style == "Twin_Tails":
        if direction in (0, 3):
            polygon([(8, 4), (11, 5), (10, 10), (9, 15), (5, 14), (6, 9), (5, 7)])
            polygon([(20, 5), (23, 4), (26, 7), (25, 9), (26, 14), (22, 15), (21, 10)])
        else:
            polygon([(21, 4), (24, 4), (26, 7), (25, 12), (23, 16), (21, 15), (22, 10), (20, 7)])
    elif style == "Side_Braid":
        if direction == 0:
            polygon([(20, 4), (22, 6), (22, 10), (21, 12), (23, 14), (22, 17),
                     (20, 18), (19, 16), (20, 14), (19, 12), (20, 9), (19, 6)])
        elif direction == 1:
            polygon([(20, 4), (23, 5), (23, 10), (24, 12), (23, 14), (24, 16),
                     (22, 18), (20, 17), (21, 14), (20, 12), (21, 9), (19, 7)])
        else:
            polygon([(9, 4), (12, 6), (11, 10), (12, 12), (11, 14), (12, 16),
                     (10, 18), (8, 17), (9, 14), (8, 12), (9, 9), (8, 6)])
    elif style == "Double_Buns":
        if direction in (0, 3):
            draw.ellipse((6, 1, 12, 7), fill=255)
            draw.ellipse((19, 1, 25, 7), fill=255)
        else:
            draw.ellipse((20, 1, 26, 7), fill=255)
            draw.ellipse((13, 0, 16, 3), fill=255)
    elif style == "Spiky_Crop":
        if direction == 0:
            polygon([(9, 4), (11, 1), (12, 3), (14, 0), (15, 2), (18, 0), (18, 2),
                     (21, 1), (21, 4), (23, 5), (20, 8), (19, 5), (16, 6), (13, 5), (10, 8)])
        elif direction == 1:
            polygon([(10, 4), (12, 1), (13, 3), (15, 0), (16, 2), (19, 0), (19, 2),
                     (22, 1), (22, 4), (24, 5), (22, 7), (23, 10), (19, 9), (17, 5)])
        else:
            polygon([(8, 5), (10, 2), (12, 3), (13, 0), (15, 2), (18, 0), (19, 3),
                     (22, 2), (21, 5), (23, 7), (20, 8), (20, 11), (17, 10),
                     (15, 12), (13, 10), (10, 11), (10, 8)])
    if direction == 0:
        draw.rectangle((11, 8, 19, 12), fill=0)
    elif direction == 1:
        draw.rectangle((0, 7, 16, 12), fill=0)
        draw.rectangle((0, 6, 15, 6), fill=0)
    return mask  # Keep the face and eyes unobstructed in the front and profile poses.


def shade(mask, style, direction):
    result = Image.new("RGBA", mask.size)

    def inside(x, y):
        return 0 <= x < 32 and 0 <= y < 32 and mask.getpixel((x, y)) > 0

    for y in range(32):
        for x in range(32):
            if not inside(x, y):
                continue
            edge = any(not inside(x + dx, y + dy) for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1)])
            value = 135 if edge else 187 if (x + y // 5) % 5 == 0 or x > 21 else 236
            if not edge and (2 <= y <= 4 and x % 4 == 1 or 6 <= y <= 11 and x % 6 == 2):
                value = 255
            result.putpixel((x, y), (value, value, value, 255))

    def detail(x, y, value):
        if inside(x, y):
            result.putpixel((x, y), (value, value, value, 255))  # Add strand marks without changing the silhouette.

    if style == "Side_Braid":
        center = 21 if direction == 0 else 22 if direction == 1 else 10
        for y in range(8, 17):
            detail(center + (y % 2), y, 187)
            detail(center - 1 + (y % 2), y, 255)
        detail(center, 17, 135)
    if style == "High_Ponytail":
        for x in (range(14, 19) if direction == 3 else range(21, 24)):
            detail(x, 4, 135)
            detail(x, 5, 255)
    if style == "Double_Buns":
        for center in ([9, 22] if direction in (0, 3) else [23]):
            for x, y, value in [(center - 1, 3, 255), (center, 2, 255), (center + 1, 3, 187), (center, 4, 135)]:
                detail(x, y, value)
    if style == "Blunt_Bob":
        for x in range(8, 25):
            detail(x, 11, 187)
    return result  # Use only the clothing pack's neutral 135/187/236/255 palette.


def hair_frame(style, row, column):
    direction = 1 if row == 2 else row
    frame = shade(silhouette(style, direction), style, direction)
    if row == 2:
        mirrored = Image.new("RGBA", (32, 32))
        mirrored.paste(ImageOps.mirror(frame), (-1, 0))
        frame = mirrored  # The source profiles mirror around x=15, so use x'=30-x rather than 31-x.
    result = Image.new("RGBA", (32, 32))
    bob = column % 2
    rear_shift = 1 if row == 3 and column == 3 else 0
    sway = 1 if column == 1 else -1 if column == 3 else 0
    for y in range(32 - bob):
        for x in range(32):
            pixel = frame.getpixel((x, y))
            if not pixel[3]:
                continue
            offset = sway if y >= 13 and style in {"Shoulder_Length", "High_Ponytail", "Twin_Tails", "Side_Braid"} else 0
            result.putpixel((x + rear_shift + offset, y + bob), pixel)
    return result  # Match one-pixel head bob and add subtle movement only at the long hair tips.


def compose(base, wardrobe, hair):
    result = base.copy()
    for layer in wardrobe:
        result.alpha_composite(layer)
    result.alpha_composite(hair)
    return result  # Hair draws over the dressed character, with face openings preserved in the overlay.


def previews(output, bases, wardrobe, sheets):
    font = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 17)
    frames = []
    for column in range(4):
        canvas = Image.new("RGB", (1280, 714), "#202a37")
        draw = ImageDraw.Draw(canvas)
        draw.text((24, 12), "PIKO HAIR | 8 grayscale styles | front / left / right / back", font=font, fill="white")
        for index, (style, hair) in enumerate(sheets.items()):
            x, y = index % 2 * 640, index // 2 * 164 + 50
            draw.rounded_rectangle((x + 8, y, x + 632, y + 156), radius=10, fill="#2e3a48")
            draw.text((x + 22, y + 8), style.replace("_", " "), font=font, fill="white")
            dressed = compose(bases[0], wardrobe, hair)
            for row in range(4):
                enlarged = tile(dressed, row, column).resize((112, 112), Image.Resampling.NEAREST)
                canvas.paste(enlarged, (x + 58 + row * 138, y + 36), enlarged)
        frames.append(canvas)
    frames[0].save(output / "hairstyles_preview.png")
    palette = frames[0].quantize(colors=256)
    indexed = [frame.quantize(palette=palette, dither=Image.Dither.NONE) for frame in frames]
    indexed[0].save(output / "hairstyles_walk.gif", save_all=True, append_images=indexed[1:],
                    loop=0, duration=180, disposal=2, optimize=False)  # A shared palette and full-frame disposal keep preview labels stable.
    return frames[0]  # Create a shareable overview and synchronized walking preview.


def write_viewer(output, manifest):
    template = '''<!doctype html><html lang="en"><meta charset="utf-8"><title>Piko hairstyles</title>
<style>body{font:16px system-ui;background:#202a37;color:#eee;max-width:1040px;margin:32px auto;padding:16px}main{display:flex;gap:32px;flex-wrap:wrap}aside{width:290px}label{display:block;margin:16px 0 6px}select,button,input{font:inherit;padding:8px;width:100%;box-sizing:border-box}canvas{image-rendering:pixelated;border:1px solid #667888}p{color:#c3cfdb}button{margin-top:20px}</style>
<h1>Piko hairstyles</h1><p>Eight unique white/grayscale overlays. 128×128 sheets; sixteen 32×32 frames. Colors come from your engine.</p>
<main><aside><label for="hair">Hairstyle</label><select id="hair"></select>
<label for="body">Body</label><select id="body"><option value="Woman">Woman V2</option><option value="Man">Man V1</option></select>
<label for="direction">Direction</label><select id="direction"><option>Front</option><option>Left</option><option>Right</option><option>Back</option></select>
<label for="speed">Frames per second</label><input id="speed" type="range" min="1" max="12" value="6"><button id="pause">Pause animation</button><p id="status">Loading…</p></aside>
<section><canvas id="walk" width="384" height="384"></canvas><p>Walking preview at 12× zoom.</p><canvas id="sheet" width="512" height="512"></canvas><p>All sixteen poses at 4× zoom.</p></section></main><script>
const pack = PACK;
const $=id=>document.getElementById(id), images=new Map();
for(const item of pack.items) $('hair').add(new Option(item.name,item.id));
let paused=false,frame=0,last=0;
$('pause').onclick=()=>{paused=!paused;$('pause').textContent=paused?'Resume animation':'Pause animation';};
const sources=[...pack.items.map(item=>[item.id,item.file]),['Woman','reference/Woman.png'],['Man','reference/Man.png'],['Outfit','reference/Outfit.png']];
Promise.all(sources.map(([id,path])=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{images.set(id,img);resolve();};img.onerror=()=>reject(new Error(path));img.src=path;})))
.then(()=>{$('status').textContent='Loaded. Hair follows the original head positions.';requestAnimationFrame(draw);})
.catch(error=>{$('status').textContent='Unable to load '+error.message+'. Keep the complete pack together.';});
function background(ctx,size,cell){ // Show transparency behind the composed character.
 for(let y=0;y<size;y+=cell)for(let x=0;x<size;x+=cell){ctx.fillStyle=((x+y)/cell)%2?'#394755':'#303d4a';ctx.fillRect(x,y,cell,cell);}
}
function draw(now){ // Render every layer from the same direction and animation frame.
 if(!paused&&now-last>=1000/Number($('speed').value)){frame=(frame+1)%4;last=now;}
 const walk=$('walk').getContext('2d'),sheet=$('sheet').getContext('2d');walk.imageSmoothingEnabled=false;sheet.imageSmoothingEnabled=false;
 background(walk,384,24);background(sheet,512,16);
 for(const id of [$('body').value,'Outfit',$('hair').value]){walk.drawImage(images.get(id),frame*32,$('direction').selectedIndex*32,32,32,0,0,384,384);sheet.drawImage(images.get(id),0,0,512,512);}
 sheet.strokeStyle='#617386';for(let i=0;i<=4;i++){sheet.beginPath();sheet.moveTo(i*128,0);sheet.lineTo(i*128,512);sheet.moveTo(0,i*128);sheet.lineTo(512,i*128);sheet.stroke();}
 requestAnimationFrame(draw);
}
</script></html>'''
    (output / "preview.html").write_text(template.replace("PACK", json.dumps(manifest)), encoding="utf-8")  # Inline metadata permits offline preview without a server.


def write_docs(output):
    (output / "README.md").write_text('''# Piko grayscale hairstyles

Eight unique styles: Pixie Cut, Blunt Bob, Shoulder Length, High Ponytail,
Twin Tails, Side Braid, Double Buns, and Spiky Crop. One base-item PNG per
hairstyle lives in `sheets/`. There are no color variants.

Open `preview.html` to change style, body, direction, and animation speed.
`hairstyles_preview.png` and `hairstyles_walk.gif` provide an overview.

Every sheet is 128x128 RGBA, arranged as four columns of 32x32 frames and
four rows: front, left, right, back. Keep the original frame offsets, use
the same frame/origin as the body, and draw hair after clothing. The longer
styles drape over the shoulders in this single-overlay system.
Columns retain the original gait bob; longer tips also sway by one pixel.
RGB shades are 135, 187, 236, and 255. Multiply RGB by the engine hair color
and preserve alpha. Use nearest-neighbor sampling. Preview references are
body/outfit copies, not additional hairstyles or game assets to import.

The pack does not install GameMaker resources. Verify origins, texture
filtering, draw order, and your own hats/accessories in the game.

Rebuild with Python 3 and Pillow:

    py python/build_piko_hairstyles.py --source "ORIGINAL_SHEETS" --clothing "CLOTHING_PACK" --output "NEW_OUTPUT"

Use a fresh output folder to protect manual edits; the builder overwrites
its generated filenames. Source files are read only. Preserve the source
body/artwork credits and license when distributing preview references.
''', encoding="utf-8")
    notes = {
        "CONTRIBUTOR_GUIDE.md": "Edit silhouette() for per-direction shapes, shade() for strands, and hair_frame() for gait motion. STYLES contains the eight stable base-item IDs. Preserve original face openings and 32px head registration.",
        "GENERATION_TUNING_GUIDE.md": "Use only grayscale 135/187/236/255 with binary alpha. Hair is authored by deterministic pixel scripts, with no runtime model. Keep rigid upper hair aligned to the body bob; sway only longer tips. Do not generate color-suffixed aliases.",
        "QUEST_MAKING_GUIDE.md": "This pack adds artwork only. Register IDs from manifest.json in the actual game's item system before using a hairstyle as a reward. No quests, prices, or unlock rules are changed.",
        "NPC_DIALOGUE_TREES.md": "No dialogue is changed. Display names in manifest.json can label appearance choices after integration; reactions and gameplay conditions require separately authored dialogue.",
        "PLAYER_CHECKLIST.md": "Open preview.html, try all eight styles on both bodies, and review all four directions. Check the face, neckline, moving tips, and any in-game head accessories before release.",
        "TESTING_GUIDE.md": "validation.json records 128 nonempty frames across eight distinct 128x128 RGBA sheets. The builder checks grayscale, binary alpha, head bounds, eye clearance, and original head bob. Visually inspect both bodies and test final GameMaker rendering. The modding editor's --sprite-pack option opens this pack's preview.html.",
    }
    for filename, note in notes.items():
        (output / filename).write_text("# Hairstyle pack notes\n\n" + note + "\n", encoding="utf-8")
    (output / "python").mkdir(exist_ok=True)
    target = output / "python" / Path(__file__).name
    if target.resolve() != Path(__file__).resolve():
        shutil.copyfile(__file__, target)  # Ship the exact standalone builder with the generated art.


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--clothing", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.resolve() in (args.source.resolve(), args.clothing.resolve()):
        parser.error("Use a separate output folder.")
    output = args.output
    for folder in (output, output / "sheets", output / "reference"):
        folder.mkdir(parents=True, exist_ok=True)
    names = ["Piko_Woman_Walk_4-dir_V2.png", "Piko_Man_Walk_4-dir_V1.png"]
    bases = [Image.open(args.source / name).convert("RGBA") for name in names]
    wardrobe = [Image.open(args.clothing / "sheets" / f"{name}.png").convert("RGBA") for name in ["Jeans", "Hoodie", "Boots"]]
    if any(im.size != (128, 128) for im in bases + wardrobe):
        raise ValueError("Source body and clothing sheets must be 128x128.")
    manifest = {"sheet_size": [128, 128], "frame_size": [32, 32], "rows": ROWS, "columns": 4,
                "color_mode": "white_grayscale", "grayscale_values": GRAYS,
                "layer_order": ["body", "clothing", "hair"], "origin_note": "Use the same frame origin as the body; no trimming.",
                "source_sha256": {name: hashlib.sha256((args.source / name).read_bytes()).hexdigest() for name in names}, "items": []}
    sheets, checks = {}, []
    for style in STYLES:
        sheet = Image.new("RGBA", (128, 128))
        bounds = []
        for row in range(4):
            for column in range(4):
                frame = hair_frame(style, row, column)
                bound = frame.getbbox()
                if not bound or bound[0] < 3 or bound[2] > 29 or bound[3] > 20 or bound[1] != column % 2:
                    raise ValueError(f"Invalid head registration: {style}, {row}, {column}, {bound}")
                for base in bases:
                    face = tile(base, row, column)
                    for y in range(7 + column % 2, 11 + column % 2):
                        for x in range(32):
                            if face.getpixel((x, y)) in [(0, 0, 0, 255), (255, 255, 255, 255), (40, 217, 147, 255)] and frame.getpixel((x, y))[3]:
                                raise ValueError(f"Eye overlap: {style}, {row}, {column}, {x}, {y}")
                sheet.paste(frame, (column * 32, row * 32))
                bounds.append(bound)
        if set(sheet.getchannel("A").get_flattened_data()) != {0, 255}:
            raise ValueError(f"Invalid alpha: {style}")
        if any(r != g or g != b or r not in GRAYS for r, g, b, a in sheet.get_flattened_data() if a):
            raise ValueError(f"Invalid grayscale: {style}")
        sheet.save(output / "sheets" / f"{style}.png")
        sheets[style] = sheet
        manifest["items"].append({"id": style, "name": style.replace("_", " "), "slot": "hair", "file": f"sheets/{style}.png", "engine_tintable": True})
        checks.append({"file": f"{style}.png", "nonempty_frames": 16, "frame_bounds": bounds, "eye_clearance": True, "grayscale": True})
    if len({im.tobytes() for im in sheets.values()}) != len(STYLES):
        raise ValueError("Duplicate hairstyles generated.")
    for name, base in zip(["Woman", "Man"], bases):
        base.save(output / "reference" / f"{name}.png")
    outfit = Image.new("RGBA", (128, 128))
    for layer in wardrobe:
        outfit.alpha_composite(layer)
    outfit.save(output / "reference" / "Outfit.png")
    previews(output, bases, wardrobe, sheets)
    write_viewer(output, manifest)
    write_docs(output)
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    (output / "validation.json").write_text(json.dumps({"total_frames": 128, "sheets": checks}, indent=2) + "\n", encoding="utf-8")
    print(f"Created {len(sheets)} unique grayscale hairstyles / 128 frames at {output}")  # Report only fully validated builds.


if __name__ == "__main__":
    main()  # Run the standalone builder only when invoked directly.
