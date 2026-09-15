"""Render a server-selected doll layer list to PNG on stdout, with no saved player files."""
import json
import re
import sys
from pathlib import Path
from PIL import Image

ART = Path(__file__).resolve().parents[1] / "assets" / "dressup"


def render(layers):
    if not isinstance(layers, list) or len(layers) > 100:
        raise ValueError("Invalid layer list")
    canvas = Image.new("RGBA", (387, 875))
    for layer in layers:
        name = layer["image"]
        if not re.fullmatch(r"[\w-]+\.png", name) or "_ButtCam_" in name:
            raise ValueError("Invalid doll asset")
        with Image.open(ART / name) as source:
            overlay = source.convert("RGBA")
        if layer.get("sourceRect"):
            x, y, width, height = layer["sourceRect"]
            overlay = overlay.crop((x, y, x + width, y + height))
        x, y, width, height = layer.get("rect", [0, 0, 387, 875])
        if width < 1 or height < 1 or width > 387 or height > 875:
            raise ValueError("Invalid layer dimensions")
        overlay = overlay.resize((width, height), Image.Resampling.BILINEAR)
        canvas.alpha_composite(overlay, (x, y))
    return canvas  # Preserve native registration, transparency, anatomical crops and automatic stance.


if __name__ == "__main__":
    render(json.load(sys.stdin)).save(sys.stdout.buffer, format="PNG")  # Pipe bytes directly to Discord; no public image endpoint or temporary files.
