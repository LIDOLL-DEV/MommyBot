"""Render a server-selected doll layer list to PNG on stdout, with no saved player files."""
import json
import math
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
        if layer.get("strips"):
            strips = layer["strips"]
            if not isinstance(strips, list) or len(strips) > 700:
                raise ValueError("Invalid clothing strips")
            for strip in strips:
                if len(strip) != 8 or any(not isinstance(n, (int, float)) or not math.isfinite(n) for n in strip):
                    raise ValueError("Invalid clothing strip")
                sx, sy, sw, sh, dx, dy, dw, dh = strip
                if min(sx, sy) < 0 or min(sw, sh, dw, dh) <= 0 or sx + sw > 387 or sy + sh > 875 or dw > 387 * 3.5 or dh > 875 * 5 or abs(dx) > 2000 or abs(dy) > 5000:
                    raise ValueError("Invalid clothing strip bounds")
                left, top, right, bottom = map(lambda n: math.floor(n + 0.5), (dx, dy, dx + dw, dy + dh))
                if right <= left or bottom <= top:
                    continue
                patch = overlay.crop((sx, sy, sx + sw, sy + sh)).resize((right - left, bottom - top), Image.Resampling.BILINEAR)
                canvas.alpha_composite(patch, (left, top))
            continue  # Consume the same bounded strip plan as Canvas; clip expanded clothing to the native doll canvas.
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
