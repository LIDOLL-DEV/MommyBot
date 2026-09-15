"""Import lidollquest's detailed-hem exceptions and extended-hem flags by asset family."""
import argparse
import json
import re
from pathlib import Path

ART = Path(__file__).resolve().parents[1] / "assets/dressup"


def import_rules(reference):
    source = (reference / "scripts/scrPaperdoll/scrPaperdoll.gml").read_text(encoding="utf-8")
    section = source.split("function _tq_is_frilly_hem", 1)[1].split("global._tqFrillyHemSet =", 1)[0]
    normalize = lambda name: re.sub(r"[^a-z0-9]", "", name.lower())
    frilly = {normalize(name) for name in re.findall(r'"([a-z0-9_]+)"', section)}
    items = json.loads((reference / "datafiles/generation/items.json").read_text(encoding="utf-8"))["items"]
    extended = {normalize(name) for name, item in items.items() if item.get("warp_full_hem")}
    catalog = json.loads((ART / "catalog.json").read_text(encoding="utf-8"))
    rules = {}
    for item in catalog["clothes"]:
        name = re.sub(r"^(?:NEW)?(?:TQ|DQ)_Clothing_", "", Path(item["image"]).stem)
        if item["slot"] == "top":
            name = re.sub(r"[ABC]$", "", name)
        family = normalize(name)
        rule = {}
        if item["slot"] == "top" and family in frilly:
            rule["warp"] = "none"
        if family in extended:
            rule["warpFullHem"] = True
        if rule:
            rules[item["image"]] = rule
    (ART / "clothing-fit-rules.json").write_text(json.dumps(rules, indent=2) + "\n", encoding="utf-8")
    print(f"Imported fitting rules for {len(rules)} garment assets.")  # Unmatched Emporium-only variants use silhouette fitting.


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reference", type=Path)
    import_rules(parser.parse_args().reference)
