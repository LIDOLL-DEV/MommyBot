"""Discover wearable overlays by folder, preserving garment sections and color variants."""
from collections import Counter
from pathlib import Path
from PIL import Image
import hashlib
import re

FOLDERS = {"Dresses": "top", "Headgear": "head", "Shoes": "shoes", "Stockings": "socks",
           "Trousers": "bottom", "Skirts": "bottom", "Bras": "bra", "Corsets": "corset",
           "Knickers": "underwear", "Accessories": "accessory", "Bags": "bag",
           "Belts_Suspenders": "belt", "Equippables": "hand", "HospitalArmband": "accessory"}
FADED_FOLDERS = {"Dresses", "Bras", "Knickers", "Trousers", "Skirts"}

def faded_copy(path):
    if not path.stem.endswith("d") or not path.with_name(path.stem[:-1] + ".png").exists():
        return False
    with Image.open(path) as art:
        return art.convert("RGBA").getchannel("A").getextrema()[1] <= 128  # Preserve opaque color variants whose names happen to end in d.

def discover(source, copy_asset, previous):
    root = source / "CW"
    clothes, audit, used = [], [], set()
    existing = {item["id"] for item in previous.get("clothes", [])}
    fingerprints = {}

    def record(path, status, **extra):
        audit.append({"source": path.relative_to(source).as_posix(), "status": status, **extra})

    def add(paths, slot, identity=None, back=None):
        paths, back = list(paths), list(back or [])
        for path in paths + back:
            with Image.open(path) as art:
                if art.size != (387, 875) or not art.getbbox():
                    record(path, "unsupported-canvas-or-empty")
                    return
        primary = paths[0]
        identifier = re.sub(r"[^a-z0-9]+", "-", (identity or primary.stem).lower()).strip("-")
        combined = Image.new("RGBA", (387, 875))
        for path in back + paths:
            with Image.open(path) as art:
                combined.alpha_composite(art.convert("RGBA"))
        signature = hashlib.sha256(slot.encode() + combined.tobytes()).hexdigest()
        if signature in fingerprints and identifier not in existing:
            for path in paths + back:
                record(path, "identical-art", sameAs=fingerprints[signature])
                used.add(path)
            return
        fingerprints[signature] = identifier  # Exact image aliases do not gain additional chances in the roll pool.
        display = re.sub(r"^(?:NEW)?TQ_Clothing_", "", identity or primary.stem)
        display = re.sub(r"[ABC]$", "", display) if primary.parent.name == "Dresses" else display
        display = re.sub(r"([a-z])([A-Z])", r"\1 \2", display).replace("_", " ")
        rarity = ("legendary" if any(word in display for word in ["Tiara", "Royal", "Magical"]) else
                  "epic" if any(word in display for word in ["Frilly", "Bridal", "Princess", "Wings"]) else
                  "rare" if any(word in display for word in ["Bonnet", "Pinafore", "Onesie", "Bunny", "Unicorn"]) else
                  "uncommon" if any(word in display for word in ["Sissybow", "Romper", "Blouse", "Lace", "Ribbon"]) else "common")
        upper = combined.getbbox()[3] <= 390
        stances = ["narrow", "wide"] if upper or slot in ["head", "bra", "corset", "accessory", "gloves", "hand", "bag"] else ["narrow"]
        names = [copy_asset(path.relative_to(source).as_posix()) for path in paths]
        item = {"id": identifier, "name": display, "description": f"A collectible {slot} piece for your Littlepottchi wardrobe.",
                "image": names[0], "rarity": rarity, "slot": slot, "stances": stances, "sprite": True}
        if len(names) > 1:
            item["parts"] = names[1:]
        if back:
            item["backParts"] = [copy_asset(path.relative_to(source).as_posix()) for path in back]
        clothes.append(item)
        for path in paths + back:
            used.add(path)
            record(path, "included", design=identifier)  # Audit all constituent files, including shared variant sections.

    for folder, default_slot in FOLDERS.items():
        candidates = []
        for path in sorted((root / folder).glob("*.png")):
            stem = path.stem
            if "buttcam" in stem.lower():
                record(path, "alternate-camera")
            elif folder in FADED_FOLDERS and faded_copy(path):
                record(path, "faded-overlay")
            elif folder == "Knickers" and re.search(r"Diaper|TrainingPants", stem, re.I):
                record(path, "atelier-diaper-family")
            elif folder == "Knickers":
                record(path, "excluded-ordinary-underwear")  # Only Atelier diapers and training pants may fill the inner-bottom slot.
            elif re.search(r"Strapon|VaginalSeal|ThumbVibrator|CockPaci|GapeGloves|TongueGloves", stem, re.I):
                record(path, "non-clothing-prop")
            else:
                candidates.append(path)
        if folder == "Dresses":
            groups = {}
            for path in candidates:
                match = re.fullmatch(r"(.+)([ABC])", path.stem)
                if match:
                    groups.setdefault(match[1], {})[match[2]] = path
            for key, sections in groups.items():
                if "_Back" in key:
                    continue
                if "A" in sections:
                    base = {}
                else:
                    stem = re.sub(r"[a-z]$", "", key)
                    base = groups.get(stem, groups.get(stem + "a", {}))  # Alternate b hems reuse the matching a bodice and waist.
                    if "A" not in base:
                        for path in sections.values():
                            used.add(path)
                            record(path, "missing-garment-section")
                        continue
                complete = {**base, **sections}
                back = groups.get(key + "_Back", {})
                add([complete[part] for part in "ABC" if part in complete], "top",
                    identity=sections.get("A", sections.get("C", sections.get("B"))).stem,
                    back=[back[part] for part in "ABC" if part in back])
            for path in candidates:
                if path in used:
                    continue
                if re.search(r"[ABC]$", path.stem):
                    record(path, "unmatched-garment-section")
                else:
                    add([path], "bottom" if "Skirt" in path.stem else "top")
        else:
            for path in candidates:
                slot = "gloves" if folder == "Equippables" and re.search(r"Gloves|Mittens|Claws|Nails", path.stem) else default_slot
                add([path], slot)
    summary = {"designs": len(clothes), "bySlot": dict(Counter(item["slot"] for item in clothes)),
               "sourceFiles": len({row["source"] for row in audit}), "dispositions": dict(Counter(row["status"] for row in audit)), "files": audit}
    return clothes, summary
