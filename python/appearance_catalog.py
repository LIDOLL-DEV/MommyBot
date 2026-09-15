"""Import the registered CW anatomy layers used by lidollquest's adult creator."""
import re


def appearance(copy_asset, hair):
    def layer(name):
        return {"image": copy_asset(f"CW/Body/{name}.png")}

    neutral = copy_asset("CharWins/DQWin/Buttcams/DQ_Base_ButtCam_1a.png")
    vulva = copy_asset("CharWins/DQWin/Buttcams/DQ_Base_ButtCam_1b.png")
    penis = copy_asset("CharWins/DQWin/Buttcams/DQ_Base_ButtCam_1c.png")
    vulva_layer = layer("TQ_Base_1")
    vulva_layer.update(sourceRect=[177, 443, 13, 25], rect=[177, 443, 13, 25])
    # The supplied vulva is baked into Base_1; draw its small anatomy region over either body without replacing the physique.
    choices = {
        "chest": [{"id": "base", "name": "Base chest", "layers": []},
                  {"id": "breasts", "name": "Breasts", "layers": [layer("TQ_Breasts_1")]}],
        "nipples": [{"id": "none", "name": "Base detail", "layers": []}] + [
            {"id": f"style-{n}", "name": f"Style {n}", "layers": [layer(f"TQ_Nipples_{n}")]} for n in range(1, 3)],
        "genitals": [{"id": "neutral", "name": "No added anatomy", "layers": [], "camera": neutral},
                     {"id": "vulva", "name": "Vulva", "layers": [vulva_layer], "camera": vulva}] + [
            {"id": f"penis-{n}", "name": f"Penis · style {n}", "layers": [layer(f"TQ_Penis_{n}")], "camera": penis}
            for n in range(1, 6)],
        "pubes": [{"id": "none", "name": "None", "layers": []}] + [
            {"id": f"style-{n}", "name": f"Style {n}", "layers": [layer(f"TQ_Pubes_{n}")]} for n in range(1, 4)],
    }
    choices["hair"] = [{"image": name, "style": re.fullmatch(r"TQ_Hair_(\d+)_(.+)\.png", name)[1],
                        "color": re.fullmatch(r"TQ_Hair_(\d+)_(.+)\.png", name)[2]} for name in hair]
    return choices  # Copy original image bytes; source rectangles and native full-canvas scaling belong to the renderer.
