# Piko grayscale hairstyles

Eight unique styles: Pixie Cut, Blunt Bob, Shoulder Length, High Ponytail,
Twin Tails, Side Braid, Double Buns, and Spiky Crop. One base-item PNG per
hairstyle lives in `sheets/`. There are no color variants.

Open `preview.html` to change style, body, direction, and animation speed.
`hairstyles_preview.png` and `hairstyles_walk.gif` provide an overview.

Every sheet is 128x128 RGBA, arranged as four columns of 32x32 frames and
four rows: front, left, right, back. Keep the original frame offsets, use
the same frame/origin as the body, and draw hair after clothing. The longer
styles drape over the shoulders in this single-overlay system.
Columns retain the original gait bob; longer tips also sway by one pixel.
RGB shades are 135, 187, 236, and 255. Multiply RGB by the engine hair color
and preserve alpha. Use nearest-neighbor sampling. Preview references are
body/outfit copies, not additional hairstyles or game assets to import.

The pack does not install GameMaker resources. Verify origins, texture
filtering, draw order, and your own hats/accessories in the game.

Rebuild with Python 3 and Pillow:

    py python/build_piko_hairstyles.py --source "ORIGINAL_SHEETS" --clothing "CLOTHING_PACK" --output "NEW_OUTPUT"

Use a fresh output folder to protect manual edits; the builder overwrites
its generated filenames. Source files are read only. Preserve the source
body/artwork credits and license when distributing preview references.
