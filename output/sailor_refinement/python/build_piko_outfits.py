"""Build eight grayscale outfit overlays, including three deliberately short hems.

Requires Pillow and the bundled build_piko_clothing.py drawing helpers.
"""

import argparse
import hashlib
import json
import shutil
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

import build_piko_clothing as base

STYLES = ["Short_Smock_Dress", "Short_Sundress", "Short_Pinafore", "Kimono",
          "Raincoat", "Dungarees", "Wrap_Dress", "Sailor_Dress"]
SHORT = set(STYLES[:3])
P = base.GRAYSCALE


def line_inside(image, points, color, width=1):
    marks = Image.new("RGBA", image.size)
    ImageDraw.Draw(marks).line(points, fill=color, width=width)
    for y in range(32):
        for x in range(32):
            if marks.getpixel((x, y))[3] and base.opaque(image, x, y):
                image.putpixel((x, y), color)  # Clip seam details to existing garment pixels.


def skirt(src, row, col, hem, straight=False):
    result = base.recolor(base.skirt_mask(src, row, col), P)
    body = base.tile(src["Piko_Woman_Walk_4-dir_V2.png"], row, col)
    top_y = 23
    xs = [x for x in range(32) if base.opaque(result, x, top_y)]
    if not xs:
        raise ValueError("Expected source skirt pixels at the hip.")
    lower = [x for x in range(32) if base.opaque(body, x, hem - 1)]
    left, right = min(xs), max(xs)
    end_left = min(lower) - 1 if lower else left
    end_right = max(lower) + 1 if lower else right
    if not straight:
        end_left, end_right = min(left - 1, end_left), max(right + 1, end_right)
    for y in range(top_y, 32):
        for x in range(32):
            result.putpixel((x, y), (0, 0, 0, 0))
        if y >= hem:
            continue
        progress = (y - top_y) / max(1, hem - 1 - top_y)
        a = round(left + (end_left - left) * progress)
        b = round(right + (end_right - right) * progress)
        for x in range(a, b + 1):
            shade = 0 if x in (a, b) or y == hem - 1 else 1 if (x - a) % 5 == 0 else 2
            result.putpixel((x, y), P[shade])
    return result  # Extend the source waist into a coherent hem that follows the walking feet.


def short_dress(src, row, col, style):
    bob = col % 2
    diaper = base.tile(src["Diaper.png"], row, col)
    diaper_top = diaper.getbbox()[1]
    hem = diaper_top + (1 if style == "Short_Sundress" else 2)
    kind = "Pinafore" if style == "Short_Pinafore" else "Sundress"
    result = base.dress_or_skirt(src, row, col, P, kind)
    if style == "Short_Smock_Dress":
        result.alpha_composite(base.recolor(base.tile(src["Tee.png"], row, col), P))
    for y in range(hem, 32):
        for x in range(32):
            result.putpixel((x, y), (0, 0, 0, 0))
    # Flare the lower bodice only one pixel; its hem stays above the diaper's lower section.
    for y in range(hem - 2, hem):
        xs = [x for x in range(32) if base.opaque(result, x, y)]
        if not xs:
            continue
        left, right = min(xs), max(xs)
        for x in range(left - 1, right + 2):
            result.putpixel((x, y), P[0] if y == hem - 1 or x in (left - 1, right + 1) else P[2])
    if style == "Short_Smock_Dress":
        for x in range(32):
            if x % 2 == 0:
                base.mark(result, x, hem - 1, P[3])
        if row == 0:
            for y in range(14 + bob, hem - 2):
                base.mark(result, 15, y, P[0] if y % 2 else P[3])
    elif style == "Short_Sundress":
        for y in range(14 + bob, hem - 1):
            for x in range(32):
                if result.getpixel((x, y)) == P[2] and (x + 2 * y) % 5 == 0:
                    result.putpixel((x, y), P[3])
    else:
        if row == 0:
            line_inside(result, [(14, 16 + bob), (14, 18 + bob), (16, 18 + bob), (16, 16 + bob)], P[0])
        for x in range(32):
            base.mark(result, x, hem - 2, P[1])
    return result  # Short hems expose the separate diaper layer without baking it into the dress sprite.


def sailor_skirt(src, row, col):
    result = base.recolor(base.skirt_mask(src, row, col), P)
    bob = col % 2
    for y in range(21 + bob, 27 + bob):
        for x in range(32):
            if result.getpixel((x, y)) == P[2] and (x - bob) % 4 == 0:
                result.putpixel((x, y), P[1])  # Subtle pleats move with the source skirt instead of tracking the feet.
    for x in range(32):
        ys = [y for y in range(20, 32) if base.opaque(result, x, y)]
        if not ys or max(ys) < 24:
            continue
        bottom = max(ys)
        base.mark(result, x, bottom, P[0])
        base.mark(result, x, bottom - 1, P[3])
        base.mark(result, x, bottom - 2, P[1])
    return result  # Follow the authored moving hem, including its curved corners and hand occlusions.


def outfit_frame(src, row, col, style):
    if style in SHORT:
        return short_dress(src, row, col, style)
    bob = col % 2
    if style == "Dungarees":
        result = base.trousers(src, row, col, P, "Jeans")
        shirt = base.recolor(base.tile(src["Tee.png"], row, col), [P[1], P[2], P[3], P[3], P[3]])
        result.alpha_composite(shirt)
        if row in (0, 3):
            for y in range(14 + bob, 22 + bob):
                for x in range(13, 18):
                    base.mark(result, x, y, P[0] if x in (13, 17) else P[2])
            for x in (13, 17):
                line_inside(result, [(x, 12 + bob), (x, 16 + bob)], P[1])
                base.mark(result, x, 15 + bob, P[3])
            line_inside(result, [(14, 17 + bob), (14, 19 + bob), (16, 19 + bob), (16, 17 + bob)], P[1])
        else:
            x = 15 if row == 1 else 16
            line_inside(result, [(x, 13 + bob), (x, 21 + bob)], P[1], 2)
            base.mark(result, x, 16 + bob, P[0])
        return result  # Dungarees include the light undershirt, bib, straps, and trouser legs.

    result = base.dress_or_skirt(src, row, col, P, "Sundress")
    if style in ("Kimono", "Raincoat"):
        result = base.top(src, row, col, P, "Hoodie")
    hem = {"Kimono": 30, "Raincoat": 28, "Wrap_Dress": 29, "Sailor_Dress": 27}[style]
    result.alpha_composite(sailor_skirt(src, row, col) if style == "Sailor_Dress"
                           else skirt(src, row, col, hem, straight=style in ("Kimono", "Raincoat")))
    if style == "Kimono":
        sleeves = Image.new("RGBA", (32, 32))
        draw = ImageDraw.Draw(sleeves)
        if row in (0, 3):
            if col % 2 == 0:
                shapes = [[(10, 13), (12, 15), (11, 21), (7, 21), (8, 16)],
                          [(19, 15), (21, 13), (23, 16), (24, 21), (20, 21)]]
            else:
                shapes = [[(11, 14), (14, 16), (13, 21), (9, 20), (10, 17)],
                          [(18, 16), (20, 14), (22, 18), (21, 22), (18, 21)]]
                if col == 3:
                    shapes = [[(31 - x, y) for x, y in shape] for shape in shapes]
        else:
            shapes = [[(18, 14 + bob), (21, 15 + bob), (23, 22), (18, 22), (17, 17 + bob)]]
            if row == 2:
                shapes = [[(30 - x, y) for x, y in shape] for shape in shapes]
        for shape in shapes:
            draw.polygon(shape, fill=P[2], outline=P[0])
        result.alpha_composite(sleeves)
        if row == 0:
            line_inside(result, [(12, 12 + bob), (17, 18 + bob)], P[1], 2)
            line_inside(result, [(18, 12 + bob), (14, 18 + bob)], P[0])
        elif row in (1, 2):
            x = 13 if row == 1 else 17
            line_inside(result, [(x, 12 + bob), (15, 18 + bob)], P[0])
        for y in (18 + bob, 19 + bob, 20 + bob):
            for x in range(12, 20):
                base.mark(result, x, y, P[0] if y != 19 + bob else P[1])
        if row == 3:
            for x, y in [(12, 19), (13, 18), (13, 20), (17, 18), (18, 19), (17, 20)]:
                base.mark(result, x, y + bob, P[3])
        for y in range(23, 29):
            line_inside(result, [(16, y), (16, y)], P[1])
    elif style == "Raincoat":
        if row == 0:
            line_inside(result, [(15, 13 + bob), (15, 26)], P[0])
            for y in range(15 + bob, 26, 3):
                base.mark(result, 16, y, P[3])
            for x in (12, 18):
                line_inside(result, [(x, 22), (x, 24)], P[0])
        elif row == 3:
            line_inside(result, [(12, 13 + bob), (13, 16 + bob), (17, 16 + bob), (19, 13 + bob)], P[1], 2)
        for x in range(32):
            base.mark(result, x, 26, P[3])
    elif style == "Wrap_Dress":
        if row == 0:
            line_inside(result, [(12, 12 + bob), (18, 19 + bob)], P[1])
            line_inside(result, [(18, 12 + bob), (14, 19 + bob)], P[0])
        for x in range(32):
            base.mark(result, x, 19 + bob, P[0])
        for y in range(21, 28):
            base.mark(result, 14 + (y - 21) // 3, y, P[1])
    else:
        result.alpha_composite(base.recolor(base.tile(src["Tee.png"], row, col), P))
        if row == 0:
            line_inside(result, [(12, 13 + bob), (15, 17 + bob), (18, 13 + bob)], P[0], 2)
            line_inside(result, [(15, 16 + bob), (15, 19 + bob)], P[1])
        elif row == 3:
            line_inside(result, [(12, 12 + bob), (12, 16 + bob), (18, 16 + bob), (18, 12 + bob)], P[0])
        else:
            x = 18 if row == 1 else 12
            line_inside(result, [(x, 12 + bob), (x, 16 + bob)], P[0])
    return result  # Export one complete outfit layer; footwear remains a separate choice.


def write_preview(output, manifest, references, sheets):
    font = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 17)
    frames = []
    for column in range(4):
        canvas = Image.new("RGB", (1280, 714), "#202a37")
        draw = ImageDraw.Draw(canvas)
        draw.text((24, 12), "PIKO OUTFITS | 8 grayscale styles | front / left / right / back", font=font, fill="white")
        for index, (name, sheet) in enumerate(sheets.items()):
            x, y = index % 2 * 640, index // 2 * 164 + 50
            draw.rounded_rectangle((x + 8, y, x + 632, y + 156), radius=10, fill="#2e3a48")
            draw.text((x + 22, y + 8), name.replace("_", " "), font=font, fill="white")
            character = references["Woman"].copy()
            for layer in [references["Diaper"], sheet, references["Shoes"], references["Hair"]]:
                character.alpha_composite(layer)
            for row in range(4):
                frame = base.tile(character, row, column).resize((112, 112), Image.Resampling.NEAREST)
                canvas.paste(frame, (x + 58 + row * 138, y + 36), frame)
        frames.append(canvas)
    frames[0].save(output / "outfits_preview.png")
    palette = frames[0].quantize(colors=256)
    indexed = [frame.quantize(palette=palette, dither=Image.Dither.NONE) for frame in frames]
    indexed[0].save(output / "outfits_walk.gif", save_all=True, append_images=indexed[1:], duration=180, loop=0, disposal=2, optimize=False)
    template = '''<!doctype html><html lang="en"><meta charset="utf-8"><title>Piko outfits</title>
<style>body{font:16px system-ui;background:#202a37;color:#eee;max-width:1040px;margin:32px auto;padding:16px}main{display:flex;gap:32px;flex-wrap:wrap}aside{width:290px}label{display:block;margin:16px 0 6px}select,button,input[type=range]{font:inherit;padding:8px;width:100%;box-sizing:border-box}canvas{image-rendering:pixelated;border:1px solid #667888}p{color:#c3cfdb;line-height:1.5}button{margin-top:20px}</style>
<h1>Piko outfits</h1><p>Eight unique grayscale outfits, including three short dresses. Color comes from your engine.</p>
<main><aside><label for="outfit">Outfit</label><select id="outfit"></select><label for="body">Body</label><select id="body"><option value="Woman">Woman V2</option><option value="Man">Man V1</option></select>
<label for="direction">Direction</label><select id="direction"><option>Front</option><option>Left</option><option>Right</option><option>Back</option></select>
<label><input id="diaper" type="checkbox" checked> Show diaper</label><label for="speed">Frames per second</label><input id="speed" type="range" min="1" max="12" value="6"><button id="pause">Pause animation</button><p id="coverage"></p><p id="status">Loading…</p></aside>
<section><canvas id="walk" width="384" height="384"></canvas><p>Walking preview at 12× zoom.</p><canvas id="sheet" width="512" height="512"></canvas><p>All sixteen poses at 4× zoom.</p></section></main><script>
const pack = PACK;
const $=id=>document.getElementById(id),images=new Map();
for(const item of pack.items)$('outfit').add(new Option(item.name,item.id));
let paused=false,frame=0,last=0;
$('pause').onclick=()=>{paused=!paused;$('pause').textContent=paused?'Resume animation':'Pause animation';};
const sources=[...pack.items.map(item=>[item.id,item.file]),...['Woman','Man','Diaper','Shoes','Hair'].map(id=>[id,'reference/'+id+'.png'])];
Promise.all(sources.map(([id,path])=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{images.set(id,img);resolve();};img.onerror=()=>reject(new Error(path));img.src=path;})))
.then(()=>{$('status').textContent='Loaded. Outfit and diaper layers share the original frame positions.';requestAnimationFrame(draw);}).catch(error=>{$('status').textContent='Unable to load '+error.message;});
function background(ctx,size,cell){ // Reveal transparent portions of each composition.
 for(let y=0;y<size;y+=cell)for(let x=0;x<size;x+=cell){ctx.fillStyle=((x+y)/cell)%2?'#394755':'#303d4a';ctx.fillRect(x,y,cell,cell);}
}
function draw(now){ // Use the same animation index for every body, garment, and accessory layer.
 if(!paused&&now-last>=1000/Number($('speed').value)){frame=(frame+1)%4;last=now;}
 const walk=$('walk').getContext('2d'),sheet=$('sheet').getContext('2d');walk.imageSmoothingEnabled=false;sheet.imageSmoothingEnabled=false;background(walk,384,24);background(sheet,512,16);
 const layers=[$('body').value];if($('diaper').checked)layers.push('Diaper');layers.push($('outfit').value,'Shoes','Hair');
 for(const id of layers){walk.drawImage(images.get(id),frame*32,$('direction').selectedIndex*32,32,32,0,0,384,384);sheet.drawImage(images.get(id),0,0,512,512);}
 const item=pack.items.find(item=>item.id===$('outfit').value);$('coverage').textContent=item.short_hem?'Short hem: leaves part of the diaper visible in every pose.':'';
 sheet.strokeStyle='#617386';for(let i=0;i<=4;i++){sheet.beginPath();sheet.moveTo(i*128,0);sheet.lineTo(i*128,512);sheet.moveTo(0,i*128);sheet.lineTo(512,i*128);sheet.stroke();}requestAnimationFrame(draw);
}
</script></html>'''
    (output / "preview.html").write_text(template.replace("PACK", json.dumps(manifest)), encoding="utf-8")  # Keep preview assets and metadata usable offline.


def write_docs(output):
    (output / "README.md").write_text('''# Piko outfit expansion

Eight grayscale overlays: Short Smock Dress, Short Sundress, Short Pinafore,
Kimono, Raincoat, Dungarees, Wrap Dress, and Sailor Dress. Each base item has
one PNG in sheets/, with no duplicate color variants.

The sailor skirt retains the source dress's rounded, animated hem and hand
occlusions. Its narrow trim follows the lower edge in each frame, rather
than staying on a fixed horizontal row or spreading with the feet.

The three short dresses end high enough to expose the lower part of the
supplied Diaper.png in all sixteen poses. Diapers remain a separate layer;
none is painted into the outfit. Visibility measurements in validation.json
refer to the supplied art, not a gameplay coverage or protection rule.

Open preview.html for body/direction selection and a diaper visibility toggle.
outfits_preview.png and outfits_walk.gif show all eight designs.

Sheets are 128x128 RGBA with sixteen 32x32 frames in four columns. Rows are
front, left, right, back. Preserve frame offsets and the common body origin.
Draw body, diaper, outfit, shoes, hair. Select one outfit instead of separate
top/bottom items; dungarees include the undershirt. Use nearest-neighbor
sampling and multiply grayscale RGB by the engine color, preserving alpha.
Opaque gray values are 135, 187, 236, and 255.

The kimono uses broad hanging sleeves, overlapping lapels, and an obi sash;
this low-resolution outfit is stylized. Preview references are copied from
the existing packs and are not additional outfit choices. No GameMaker
resources, item rules, quests, or saved characters are automatically changed.

Rebuild with Python 3 and Pillow (keep both bundled Python files together):

    py python/build_piko_outfits.py --source "ORIGINAL_SHEETS" --clothing "CLOTHING_PACK" --hair "HAIR_PACK" --output "NEW_OUTPUT"

Rebuild into a fresh folder to protect manual edits. Keep source artwork
credits and licensing with preview reference assets when redistributing.
''', encoding="utf-8")
    notes = {
        "CONTRIBUTOR_GUIDE.md": "Edit outfit_frame() for full outfits and short_dress() for short styles. Keep one base filename per design. Shared clothing geometry is bundled in python/build_piko_clothing.py. All source sheets remain read only.",
        "GENERATION_TUNING_GUIDE.md": "Use the clothing grayscale palette with binary alpha. Short hem height follows each diaper frame's upper bound, keeping the lower section visible. Tune hem geometry before patterns; never bake the diaper into clothing. sailor_skirt() preserves the authored skirt mask; trace its lower edge for trim instead of drawing fixed-row stripes or widening toward the feet.",
        "QUEST_MAKING_GUIDE.md": "Register manifest item IDs in the actual game before using outfit rewards. This pack only adds art. All eight outfits replace top and bottom layers; footwear and diaper stay separate.",
        "NPC_DIALOGUE_TREES.md": "No dialogue is added. The short_hem flag describes art coverage for previewing; it does not automatically create NPC reactions or affect game mechanics.",
        "PLAYER_CHECKLIST.md": "Try all eight outfits on both bodies. For short dresses, inspect diaper visibility in four directions and while walking. Use the preview checkbox to confirm the diaper is an independent layer. Check the kimono's sleeves, the sailor dress's rounded moving hem, footwear, and in-game layering.",
        "TESTING_GUIDE.md": "The builder validates eight unique sheets, 128 nonempty frames, binary alpha, and grayscale. Each short dress must expose at least 35% of the source diaper's opaque pixels in every frame. validation.json records counts for all three styles. The sailor skirt must retain the original dress alpha mask below row 23, with trim following the animated lower edge. Check visual motion, hands, hems, and final GameMaker sprite origins separately.",
    }
    for filename, note in notes.items():
        (output / filename).write_text("# Outfit pack notes\n\n" + note + "\n", encoding="utf-8")
    (output / "python").mkdir(exist_ok=True)
    for source in (Path(__file__), Path(base.__file__)):
        target = output / "python" / source.name
        if source.resolve() != target.resolve():
            shutil.copyfile(source, target)  # Ship the exact builder and its drawing dependency.


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for option in ("source", "clothing", "hair", "output"):
        parser.add_argument("--" + option, type=Path, required=True)
    args = parser.parse_args()
    if args.output.resolve() in [p.resolve() for p in (args.source, args.clothing, args.hair)]:
        parser.error("Use a separate output folder.")
    output = args.output
    for folder in (output, output / "sheets", output / "reference"):
        folder.mkdir(parents=True, exist_ok=True)
    src = {p.name: Image.open(p).convert("RGBA") for p in args.source.glob("*.png")}
    references = {"Woman": src["Piko_Woman_Walk_4-dir_V2.png"], "Man": src["Piko_Man_Walk_4-dir_V1.png"],
                  "Diaper": src["Diaper.png"], "Shoes": Image.open(args.clothing / "sheets/Mary_Janes.png").convert("RGBA"),
                  "Hair": Image.open(args.hair / "sheets/Pixie_Cut.png").convert("RGBA")}
    if any(im.size != (128, 128) for im in list(src.values()) + list(references.values())):
        raise ValueError("All source sheets must be 128x128.")
    manifest = {"sheet_size": [128, 128], "frame_size": [32, 32], "rows": base.ROWS, "columns": 4,
                "color_mode": "white_grayscale", "layer_order": ["body", "diaper", "outfit", "shoes", "hair"],
                "source_sha256": {name: hashlib.sha256((args.source / name).read_bytes()).hexdigest() for name in src}, "items": []}
    sheets, checks = {}, []
    for style in STYLES:
        sheet = Image.new("RGBA", (128, 128))
        bounds, visible = [], []
        for row in range(4):
            for col in range(4):
                frame = outfit_frame(src, row, col, style)
                bound = frame.getbbox()
                if not bound or bound[0] < 3 or bound[2] > 29 or bound[1] < 10:
                    raise ValueError(f"Unexpected outfit bounds: {style}, {row}, {col}, {bound}")
                if style in SHORT:
                    diaper = base.tile(src["Diaper.png"], row, col)
                    points = [(x, y) for y in range(32) for x in range(32) if base.opaque(diaper, x, y)]
                    count = sum(not base.opaque(frame, x, y) for x, y in points)
                    if count / len(points) < 0.35:
                        raise ValueError(f"Short dress hides too much of the diaper: {style}, {row}, {col}")
                    visible.append({"row": row, "column": col, "visible_pixels": count, "total_diaper_pixels": len(points), "fraction": round(count / len(points), 4)})
                sheet.paste(frame, (col * 32, row * 32))
                bounds.append(bound)
        if set(sheet.getchannel("A").get_flattened_data()) != {0, 255}:
            raise ValueError(f"Invalid alpha: {style}")
        if any(r != g or g != b or r not in (135, 187, 236, 255) for r, g, b, a in sheet.get_flattened_data() if a):
            raise ValueError(f"Invalid grayscale: {style}")
        sheet.save(output / "sheets" / f"{style}.png")
        sheets[style] = sheet
        manifest["items"].append({"id": style, "name": style.replace("_", " "), "slot": "outfit", "replaces_slots": ["top", "bottom"], "short_hem": style in SHORT, "file": f"sheets/{style}.png"})
        checks.append({"file": f"{style}.png", "frame_bounds": bounds, "grayscale": True, "diaper_visibility": visible})
    if len({im.tobytes() for im in sheets.values()}) != len(STYLES):
        raise ValueError("Duplicate outfit sprites.")
    for name, sheet in references.items():
        sheet.save(output / "reference" / f"{name}.png")
    write_preview(output, manifest, references, sheets)
    write_docs(output)
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    (output / "validation.json").write_text(json.dumps({"total_frames": 128, "sheets": checks}, indent=2) + "\n", encoding="utf-8")
    print(f"Created eight grayscale outfits / 128 frames, including three validated short hems, at {output}")


if __name__ == "__main__":
    main()  # Run only when explicitly invoked, keeping the drawing functions reusable.
