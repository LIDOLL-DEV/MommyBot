# Piko outfit expansion

Eight grayscale overlays: Short Smock Dress, Short Sundress, Short Pinafore,
Kimono, Raincoat, Dungarees, Wrap Dress, and Sailor Dress. Each base item has
one PNG in sheets/, with no duplicate color variants.

The sailor skirt retains the source dress's rounded, animated hem and hand
occlusions. Its narrow trim follows the lower edge in each frame, rather
than staying on a fixed horizontal row or spreading with the feet.

The three short dresses end high enough to expose the lower part of the
supplied Diaper.png in all sixteen poses. Diapers remain a separate layer;
none is painted into the outfit. Visibility measurements in validation.json
refer to the supplied art, not a gameplay coverage or protection rule.

Open preview.html for body/direction selection and a diaper visibility toggle.
outfits_preview.png and outfits_walk.gif show all eight designs.

Sheets are 128x128 RGBA with sixteen 32x32 frames in four columns. Rows are
front, left, right, back. Preserve frame offsets and the common body origin.
Draw body, diaper, outfit, shoes, hair. Select one outfit instead of separate
top/bottom items; dungarees include the undershirt. Use nearest-neighbor
sampling and multiply grayscale RGB by the engine color, preserving alpha.
Opaque gray values are 135, 187, 236, and 255.

The kimono uses broad hanging sleeves, overlapping lapels, and an obi sash;
this low-resolution outfit is stylized. Preview references are copied from
the existing packs and are not additional outfit choices. No GameMaker
resources, item rules, quests, or saved characters are automatically changed.

Rebuild with Python 3 and Pillow (keep both bundled Python files together):

    py python/build_piko_outfits.py --source "ORIGINAL_SHEETS" --clothing "CLOTHING_PACK" --hair "HAIR_PACK" --output "NEW_OUTPUT"

Rebuild into a fresh folder to protect manual edits. Keep source artwork
credits and licensing with preview reference assets when redistributing.
