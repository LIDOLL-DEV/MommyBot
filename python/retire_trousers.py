"""Retire pants from the packaged wardrobe without changing historical inventory or original PNGs."""
from collections import Counter
import json
from pathlib import Path
from wardrobe_catalog import excluded_trousers
from bake_clothing_profiles import bake

ART = Path(__file__).resolve().parents[1] / "assets/dressup"


def retire():
    path = ART / "catalog.json"
    catalog = json.loads(path.read_text(encoding="utf-8"))
    removed = {item["id"] for item in catalog["clothes"]
               if excluded_trousers(catalog["provenance"][item["image"]]["source"])}
    catalog["clothes"] = [item for item in catalog["clothes"] if item["id"] not in removed]
    path.write_text(json.dumps(catalog, indent=2) + "\n", encoding="utf-8")
    report_path = ART / "import-report.json"
    report = json.loads(report_path.read_text(encoding="utf-8"))
    for row in report["files"]:
        if excluded_trousers(row["source"]):
            row["status"] = "excluded-trousers"
            row.pop("design", None)
            row.pop("sameAs", None)
    report["designs"] = len(catalog["clothes"])
    report["bySlot"] = dict(Counter(item["slot"] for item in catalog["clothes"]))
    report["dispositions"] = dict(Counter(row["status"] for row in report["files"]))
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    rules_path = ART / "clothing-fit-rules.json"
    rules = json.loads(rules_path.read_text(encoding="utf-8"))
    active = {item["image"] for item in catalog["clothes"]}
    rules_path.write_text(json.dumps({name: rule for name, rule in rules.items() if name in active}, indent=2) + "\n", encoding="utf-8")
    bake(ART)
    print(f"Retired {len(removed)} trouser-family garments; {len(catalog['clothes'])} clothing designs remain.")
    # Existing database designs remain auditable but the live catalog hides them from rolls, banks and outfits.


if __name__ == "__main__":
    retire()
