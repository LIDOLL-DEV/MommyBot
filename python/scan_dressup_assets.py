"""Build labeled contact sheets for reviewing native doll alignment (no source edits)."""
from pathlib import Path
from PIL import Image, ImageDraw
import json

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(r"C:\Users\langley\GameMakerProjects\extraAssets\Figures")
OUT = ROOT / "data" / "dressup-review"

def sheet(paths, name, columns=5):
    canvas = Image.new("RGB", (columns * 210, ((len(paths) + columns - 1) // columns) * 470), "#fff5fa")
    draw = ImageDraw.Draw(canvas)
    for index, path in enumerate(paths):
        art = Image.open(path).convert("RGBA")
        art.thumbnail((190, 420))  # Retain the complete source canvas to compare alignment.
        x, y = (index % columns) * 210, (index // columns) * 470
        canvas.paste(art, (x + 10, y), art)
        label = path.stem.replace("TQ_Clothing_Knickers_", "").replace("TQ_Clothing_", "")
        draw.text((x + 4, y + 423), label[:29], fill="black")
        draw.text((x + 4, y + 440), label[29:58], fill="black")
    canvas.save(OUT / name)  # Save a review artifact; original files remain intact.

if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    sheet(sorted((SOURCE / "CharWins/DQWin").glob("DQ_Base_*.png")), "bases.png")
    diapers = sorted(p for p in (SOURCE / "CW/Knickers").glob("*Diaper*.png") if not p.stem.endswith("d"))
    sheet(diapers, "diapers.png", 8)
    entries = []
    for group in ["CW", "Items"]:
        for path in sorted((SOURCE / group).rglob("*")):
            if path.suffix.lower() not in [".png", ".jpg", ".jpeg"]:
                continue
            with Image.open(path) as art:
                entries.append({"path": path.relative_to(SOURCE).as_posix(), "size": list(art.size)})
    (OUT / "scan.json").write_text(json.dumps(entries, indent=2), encoding="utf-8")
    print(f"Scanned {len(entries)} images; contact sheets in {OUT}")
