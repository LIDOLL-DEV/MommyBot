"""Bake compact alpha silhouettes for Littlepottchi's shared clothing fitting code."""
import json
from pathlib import Path
from PIL import Image

ART = Path(__file__).resolve().parents[1] / "assets/dressup"


def profile(image):
    alpha = image.resize((193, 437), Image.Resampling.BILINEAR).getchannel("A")
    rows = []
    opaque = alpha.tobytes().translate(bytes(1 if value > 8 else 0 for value in range(256)))
    for y in range(437):
        left, right = opaque[y * 193:y * 193 + 96], opaque[y * 193 + 96:(y + 1) * 193]
        lo, li, ri, ro = left.find(b"\x01"), left.rfind(b"\x01"), right.find(b"\x01"), right.rfind(b"\x01")
        row = [193 - 2 * lo if lo >= 0 else 0, 2 * (ro + 96) - 193 if ro >= 0 else 0,
               193 - 2 * li if li >= 0 else 0, 2 * (ri + 96) - 193 if ri >= 0 else 0]
        if rows and rows[-1][1:] == row:
            rows[-1][0] += 1
        else:
            rows.append([1, *row])
    return rows  # Run-length encode two-pixel rows, including inner leg edges for stance alignment.


def bake(art=ART):
    catalog = json.loads((art / "catalog.json").read_text(encoding="utf-8"))
    names = {name for group in catalog["bases"].values() for name in group.values()}
    for item in catalog["clothes"] + catalog["diapers"]:
        names.update([item["image"], *item.get("parts", []), *item.get("backParts", [])])
    profiles = {}
    for name in sorted(names):
        with Image.open(art / name) as image:
            profiles[name] = profile(image.convert("RGBA").resize((387, 875)))
    # Illustration diapers have a registration rectangle; scan their actual on-doll silhouette.
    for item in catalog["diapers"]:
        if item.get("rect"):
            x, y, width, height = item["rect"]
            canvas = Image.new("RGBA", (387, 875))
            with Image.open(art / item["image"]) as image:
                canvas.alpha_composite(image.convert("RGBA").resize((width, height)), (x, y))
            profiles[item["image"] + ":" + ",".join(map(str, item["rect"]))] = profile(canvas)
    (art / "fit-profiles.json").write_text(json.dumps(profiles, separators=(",", ":")) + "\n", encoding="utf-8")
    return len(profiles)  # Original PNGs remain untouched; rebake after importing or modifying artwork.


if __name__ == "__main__":
    print(f"Baked {bake()} clothing, diaper and base profiles.")
