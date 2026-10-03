# Piko clothing expansion

Ten unique white grayscale PNG overlays, named by base item. The engine
applies color; duplicate color variants have been removed. Open
`preview.html` to mix garments and inspect four-direction walking on either
supplied body. `wardrobe_preview.png` is the contact sheet; `wardrobe_walk.gif`
is the animated version. No server or internet connection is needed.

| Item | Filename | Slot |
| --- | --- | --- |
| Hoodie | Hoodie.png | top |
| Cardigan | Cardigan.png | top |
| Striped Tee | Striped_Tee.png | top |
| Jeans | Jeans.png | bottom |
| Chinos | Chinos.png | bottom |
| Pleated Skirt | Pleated_Skirt.png | bottom |
| Sundress | Sundress.png | dress |
| Pinafore | Pinafore.png | dress |
| Boots | Boots.png | shoes |
| Mary Janes | Mary_Janes.png | shoes |

## Import and layering

Import PNGs from `sheets/`. Each image is 128x128 RGBA with a 4x4 grid of
32x32 frames, no padding, and binary transparency. Slice into sixteen frames
without trimming or rescaling. Rows are front, left, right, back; columns
retain the original walk order, including repeated neutral poses.
Frame index = direction_row * 4 + walk_column. The body and all overlays
must use the same index and origin. Bottom center (16, 32) is a suggested
origin, not metadata recovered from a GameMaker project.

Draw body, bottom, top, footwear, then hair. A dress replaces both top and
bottom; pinafores include their undershirt. Select one item per slot.
Use nearest-neighbor rendering and disable texture interpolation.
All clothing RGB channels are equal: outline 135, shadow 187, fabric 236,
highlight/accent 255. Apply the engine tint by multiplying RGB; retain alpha.
The original body reference copies retain their skin colors for fit review.
The preview copies in `reference/` are supporting assets from the supplied
pack, with recolored hair; they are not additional clothing options.

These are standalone art assets, not an installed GameMaker resource or a
MommyBot wardrobe catalog update. The source folder contained no project
configuration. Body proportions follow Woman V2; both supplied bodies were
reviewed visually. Check final draw order and origins in your game.
Existing garment bulks, collision masks, economy rules, dialogue, and quests
are not inferred from the art.

## Rebuild

Requires Python 3 and Pillow. From this pack directory:

    py python/build_piko_clothing.py --source "PATH_TO_ORIGINAL_SHEETS" --output "PATH_TO_NEW_PACK"

The source is read only. Rebuilding writes generated filenames in the output
directory; use a new directory to protect manual edits. Keep the original
asset license/credits with any redistribution; this pack does not assign a
new license to the source artwork.

See CONTRIBUTOR_GUIDE.md, GENERATION_TUNING_GUIDE.md, QUEST_MAKING_GUIDE.md,
NPC_DIALOGUE_TREES.md, PLAYER_CHECKLIST.md, and TESTING_GUIDE.md for handoff notes.
