"""Import the wearable archive and explicit Atelier-to-overlay mappings."""
from pathlib import Path
from collections import Counter
from PIL import Image
import argparse
import json
import re
import shutil
from wardrobe_catalog import discover

ROOT = Path(__file__).resolve().parents[1]

def diaper_bulk(filename):
    for family, bulk in [("Waddle", 10), ("Moosive", 8), ("Giant", 6), ("Huge", 5), ("Large", 4),
                         ("Medium", 3), ("Small", 2), ("Training", 1), ("Cover", 1)]:
        if family in filename:
            return bulk
    return 3  # Author Littlepottchi capacity in wetting units; stance remains the independently reviewed visual fit.

def build(source):
    out = ROOT / "assets/dressup"
    out.mkdir(parents=True, exist_ok=True)
    previous = json.loads((out / "catalog.json").read_text(encoding="utf-8")) if (out / "catalog.json").exists() else {}
    provenance = {}

    def copy(relative):
        path = source / relative
        with Image.open(path) as art:
            size = list(art.size)
            bbox = art.getbbox()
        shutil.copyfile(path, out / path.name)  # Preserve original PNG bytes and their transparent registration canvas.
        provenance[path.name] = {"source": relative, "size": size, "bounds": list(bbox)}
        return path.name

    bases = {}
    for shape, narrow, wide in [("soft", 3, 2), ("angular", 2, 4)]:
        bases[shape] = {"narrow": copy(f"CW/Body/TQ_Base_{narrow}.png"),
                        "wide": copy(f"CharWins/DQWin/DQ_Base_{wide}.png")}
    faces = [copy(p.relative_to(source).as_posix()) for p in sorted((source / "CW/Body/Face").glob("*_0.png"))]
    hair = [copy(p.relative_to(source).as_posix()) for p in sorted((source / "CW/Body/Hair").glob("*.png"))
            if not p.stem.endswith(("_Back", "_Front"))]
    for path in sorted((source / "CW/Body/Hair").glob("*.png")):
        if path.stem.endswith(("_Back", "_Front")):
            copy(path.relative_to(source).as_posix())
    # These pairings were compared against the CW, DQ and Items contact sheets.
    families = {"10": "Small", "1": "Moosive", "2": "Giant", "3": "Waddle", "4": "Velcro",
                "5": "Bunny", "6": "Cloth", "7": "Huge", "8": "Large", "9": "Medium"}
    diapers = []
    for item in json.loads((ROOT / "diaper-gacha/catalog.json").read_text(encoding="utf-8")):
        image = item["image"]
        rect = None
        if image.startswith("TQ_"):
            relative = f"CW/Knickers/{image}"
        elif image.startswith("trainingpants"):
            number = image.removeprefix("trainingpants").removesuffix(".png")
            relative = f"CW/Knickers/TQ_Clothing_Knickers_TrainingPants_{'Sexy' if number == '5' else number}.png"
        elif image.startswith("diapercover"):
            number = {"1": 4, "2": 3, "3": 1, "4": 2}[image[len("diapercover")]]
            relative = f"CharWins/DQWin/Diapers/DQ_Clothing_DiaperCover{number}_1.png"
        elif image in ["diaper25.png", "diaper26.png", "diaper27.png"]:
            family = {"diaper25.png": "RubberDiaper", "diaper26.png": "GhostDiaper1", "diaper27.png": "SlimeDiaper"}[image]
            relative = f"CharWins/DQWin/Diapers/DQ_Clothing_{family}_1.png"
        elif image == "diaper2d.png":
            # Resolve the exact item illustration; this print has no native overlay.
            relative = next(p.relative_to(source).as_posix() for p in (source / "Items").rglob(image))
            with Image.open(source / "CharWins/DQWin/Diapers/DQ_Clothing_GiantDiaper1_1.png") as art:
                bounds = art.getbbox()
            rect = [bounds[0], bounds[1], bounds[2] - bounds[0], bounds[3] - bounds[1]]
        else:
            number, letter = re.fullmatch(r"diaper(\d+)([a-e])\.png", image).groups()
            variant = ord(letter) - ord("a") + 1
            if number == "2" and letter == "e":
                variant = 4
            if number == "3" and variant in [2, 3]:
                family = f"WaddleDiaper{variant}_Large"
            else:
                family = f"{families[number]}Diaper{variant}"
            relative = f"CharWins/DQWin/Diapers/DQ_Clothing_{family}_1.png"
        filename = copy(relative)
        with Image.open(source / relative) as art:
            bbox = art.getbbox()
        # The reviewed wide silhouettes extend well below the narrow base's crotch.
        bottom = rect[1] + rect[3] if rect else bbox[3]
        stance = "wide" if bottom > 505 else "narrow"
        diapers.append({"id": item["id"], "image": filename, "stance": stance, "bulk": 6 if rect else diaper_bulk(filename),
                        **({"rect": rect, "fitNote": "Item illustration fitted to the matching Giant silhouette; no native print overlay supplied."} if rect else {})})

    clothes, audit = discover(source, copy, previous)
    # A wide-stance option is available for feet and legs instead of stretching narrow footwear.
    for filename, slot, name in [("DQ_Clothing_Shoes_Rollerskates_1b.png", "shoes", "Wide-stance Roller Skates")]:
        clothes.append({"id": "dq-wide-roller-skates", "name": name, "description": "Skates aligned to the wide-legged DQ base.",
                        "image": copy(f"CharWins/DQWin/{filename}"), "rarity": "rare", "slot": slot, "stances": ["wide"], "sprite": True})
    for item in clothes + diapers:
        bounds = [provenance[name]["bounds"] for name in [item["image"]] + item.get("parts", []) + item.get("backParts", [])]
        item["bounds"] = [min(b[0] for b in bounds), min(b[1] for b in bounds), max(b[2] for b in bounds), max(b[3] for b in bounds)]
    for group, items in [("clothes", clothes), ("diapers", diapers)]:
        old = {item["id"]: item for item in previous.get(group, [])}
        for item in items:
            keys = ["name", "description", "rarity", "slot", "stances"] if group == "clothes" else ["stance", "fitNote", "bulk"]
            for key in keys:
                if key in old.get(item["id"], {}):
                    item[key] = old[item["id"]][key]  # Rebuilding artwork preserves the handler's saved tuning.
    foods = []
    for food_id, name, filename, fullness, joy in [("apple", "Apple", "apple1.png", 30, 3),
            ("banana", "Banana", "banana1.png", 35, 3), ("cookie", "Cookie", "cookie1.png", 15, 10),
            ("nuts", "Peanuts", "nuts1.png", 25, 5), ("lunch", "Packed lunch", "baglunch1.png", 45, 5)]:
        foods.append({"id": food_id, "name": name, "image": copy(f"Items/Collectibles/{filename}"), "fullness": fullness, "joy": joy})
    manifest = {"version": 3, "canvas": [387, 875], "bases": bases, "faces": faces, "hair": hair,
                "diapers": diapers, "clothes": clothes, "foods": foods, "provenance": provenance}
    audit["designs"] = len(clothes)
    audit["bySlot"] = dict(Counter(item["slot"] for item in clothes))
    (out / "catalog.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    (out / "import-report.json").write_text(json.dumps(audit, indent=2) + "\n", encoding="utf-8")
    print(f"Imported {len(clothes)} clothes and mapped all {len(diapers)} Atelier designs ({sum(d['stance'] == 'wide' for d in diapers)} wide).")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path(r"C:\Users\langley\GameMakerProjects\extraAssets\Figures"))
    build(parser.parse_args().source)
