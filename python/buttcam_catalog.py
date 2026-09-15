"""Map the supplied DQ camera sequences without importing ordinary-underwear cameras."""
from pathlib import Path
import re

def cameras(source, diapers, copy_asset):
    folder = source / "CharWins/DQWin/Diapers/Buttcams"
    generic = "DQ_Clothing_LargeDiaper1"
    for item in diapers:
        stem = Path(item["image"]).stem
        family = re.sub(r"_1$", "", stem) if stem.startswith("DQ_") else ""
        family = family.replace("GhostDiaper1", "GhostDiaper")
        training = re.search(r"TrainingPants_(\w+)$", stem)
        if training:
            suffix = training[1]
            family = "DQ_Clothing_" + ("SexyTrainingPants" if suffix == "Sexy" else "TrainingPants" + ("" if suffix == "1" else suffix))
        special = re.search(r"Diaper_(Bunny|Cloth)_(\d+)$", stem)
        if special:
            family = f"DQ_Clothing_{special[1]}Diaper{special[2]}"
        frames = sorted(folder.glob(f"{family}_ButtCam_*.png"), key=lambda path: int(path.stem.rsplit("_", 1)[1])) if family else []
        if not frames:
            frames = sorted(folder.glob(f"{generic}_ButtCam_*.png"))
            item["buttcamNote"] = "Generic diaper camera; this print has no matching supplied sequence."
        item["buttcams"] = [copy_asset(path.relative_to(source).as_posix()) for path in frames]
        if not item["buttcams"] or not item["buttcams"][0].endswith("_1.png"):
            raise ValueError(f"Missing clean camera for {item['id']}")
    # Bare variants are anatomical alternatives, not messy progression frames. Keep their supplied artwork intact.
    return {"soft": copy_asset("CharWins/DQWin/Buttcams/DQ_Base_ButtCam_1a.png"),
            "angular": copy_asset("CharWins/DQWin/Buttcams/DQ_Base_ButtCam_2.png")}
