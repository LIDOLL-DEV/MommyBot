# Littlepottchi and Clothes Emporium

## Play

Your doll is an adult of any gender. Set optional gender text in **Make this doll
your own**, independently of body shape. Choose hair style and color separately,
plus face, chest, nipple detail, genital appearance and pubic hair. Available
genital choices are no added anatomy, vulva, and five penis styles. The bare
camera follows this choice independently of gender and body shape; the five
penis styles share one supplied rear view.

Changes preview locally. **Preview body without clothing** shows anatomy without
removing anything from the wardrobe or changing care state. Press **Save my doll**
to keep your choices. Covered anatomy is hidden to prevent clipping through clothes.
The clothed doll's leg stance continues to follow the equipped diaper.

**Excitement** uses a 0–255 meter and
builds gradually. Choose a reusable toy from the menu and press **Activate toy**
to lower it over a 1–3 minute session; **Stop toy** ends the session early and
retains earned relief. Toys are free and their timers continue offline.

Open `/littlepottchi/` or `/clothes/` on the MommyBot host, or use the matching
Discord slash command. Sign in with LiD0llID. An existing Diaper Atelier browser
session works across all three games, including sign-out and account revocation.

- **Clothes Emporium:** roll for one complete garment for 3 LiDollcoins by default.
  The catalog contains **929 wearable items** across 12 clothing/accessory slots.
  Trousers, jeans, leggings, shorts, bloomers and dungarees are excluded from rolls,
  the bank and wearable outfits. Skirts, diapers and training pants remain available.
  Browse 36 designs per page, search by name and filter by slot or rarity.
  A/B/C image sections combine into one garment, including alternate hems and back sections.
  Duplicates remain separate copies; buy and sell them at the shared clothing bank.
- **Littlepottchi:** choose a name, soft/angular body, hair and face. Wear owned
  clothing and any of the 58 Atelier designs. A starter shirt and Cloud Tapes
  appear by default; these free fallback visuals are not sellable copies. **Remove
  diaper** deliberately leaves the doll diaper-free until dressed again.
  Bras and corsets can replace the fallback shirt. Only diapers and training pants
  may fill the inner-bottom slot. Ordinary underwear is excluded from imports,
  rolls, the wardrobe and bank. Legacy outfits fall back to a diaper without
  resetting wetness; old payment receipts remain recoverable.
- **Automatic stance:** the equipped diaper selects the base. Larger silhouettes
  select `DQ_Base_2` (soft) or `DQ_Base_4` (angular). Smaller diapers restore
  `TQ_Base_3` or `TQ_Base_2`. Players do not choose the stance separately.
  Clothes stay equipped when the stance changes. Garments stretch using
  lidollquest's silhouette algorithm; stockings and shoes follow the legs.
- Feed, play, rest and fresh changes are free. Food and water have 30-second
  cooldowns; play and rest use activity timers. Fullness, energy, comfort and happiness decrease gradually offline,
  stopping at zero. There is no death or loss of collectibles. Changes do not
  consume owned diapers or create another copy.

The rear camera follows the equipped diaper: its first frame is clean and later
frames appear only for messy accidents while messy mode is on. Missing print
sequences use a labeled generic camera. Diaper-free care uses the supplied bare
camera. Accidents continue without a diaper. Diaper-free accidents and leaks
require **one baby wipe** before redressing; contained accidents do not. Buy wipes
at Diaper Atelier for 1 coin each by default. One wipe cleans all accumulated body
accidents. The editor can preview clean and messy cameras without changing art.

The wardrobe checks available ownership every time it renders. Selling the last
copy, or reserving it for sale, removes permission to wear it. Another available
duplicate keeps the design wearable. Refresh other open tabs after a trade.

| Slot | Designs |
| --- | ---: |
| Tops and dresses | 380 |
| Headwear | 150 |
| Shoes | 77 |
| Accessories | 66 |
| Bottoms | 63 |
| Bras | 45 |
| Socks and stockings | 42 |
| Handhelds | 40 |
| Belts and suspenders | 33 |
| Gloves | 22 |
| Corsets | 16 |
| Bags | 15 |

## Asset review and fit

The source scan examined 4,557 images under `Figures/CW` and `Figures/Items`.
`lidollquest/scripts/scrPaperdoll/scrPaperdoll.gml` supplied the shared-canvas
layering reference. Wide bases and additional matching diaper overlays were found
in the neighboring `Figures/CharWins/DQWin` folder. The original projects are
read-only references; runtime assets are copied into `assets/dressup/`.

`python/wardrobe_catalog.py` discovers complete garments across the wearable CW
folders rather than selecting a short list of clothing names. The packaged
`assets/dressup/import-report.json` accounts for 2,747 source PNGs and records
which designs use each section. It excludes 952 faded display overlays from new
rolls, while preserving opaque color variants even when their filenames end in
`d`. Alternate camera art, empty/incorrect-size overlays, non-clothing props and
the diaper families handled by Atelier are recorded separately. Shared sections
can appear under more than one complete garment. Exact duplicate art is not
added again, and existing IDs and handler tuning remain stable across imports.

The manifest records each source path, native image dimensions, gallery crop
bounds, constituent garment sections, native art stances and diaper mappings.
The initial 20 wide diapers were selected from inspected silhouettes with an
alpha-bound bottom beyond row 505. This threshold bootstraps the explicit manifest;
the game uses the manifest's saved `stance`, not a runtime size guess.
`Berry Spell` has no supplied matching full-canvas print overlay: its original
Items illustration uses a documented fit rectangle matching the Giant silhouette.
All other diaper designs use full-canvas wearable overlays.

Body and wearable layers use their original 387 × 875 coordinates. Never stretch
a narrow body sideways to fit a diaper. Hair style 4 draws its back before the
body and its front below headwear. Clothing covers lower layers normally.
Clothes are wearable in either stance. The shared renderer compares garment and
diaper alpha silhouettes, smooths horizontal band stretching, preserves sleeve
positions and applies dress hem drop. Detailed-hem exceptions follow lidollquest.
Stockings and shoes also move with each leg when the base changes;
native wide roller skates remain registered to the wide base. A short garment
may still expose part of a very large diaper, as in the reference fitting rules.
Browser dolls, Discord PNGs and editor previews share the same fitting plan.
School uniforms stretch automatically, including over Pearl diapers. They override
the reference game's no-stretch exception and preserve thin hem details while fitting.

## Modding tools

The independent MommyBot editor is `python/game_editor_gui.py`; the existing
GameMaker editor in `lidollquest` is unchanged. The packaged editor requires
Python, Pillow, Tkinter and Node.js. Run:

```powershell
py -3.11 python/game_editor_gui.py
py -3.11 python/game_editor_gui.py --validate
py -3.11 python/scan_dressup_assets.py
py -3.11 python/bake_clothing_profiles.py
py -3.11 python/import_dressup_assets.py --source C:\Users\langley\GameMakerProjects\extraAssets\Figures
```

The editor previews both bases, changes garment names/rarities/slots/fit and the
diaper's automatic stance. It validates with the shipping Node loader, backs up
successful saves, and restores the previous catalog on validation errors.
Restart the bot to load changes. The importer preserves existing tuning by ID.
The editor includes a searchable garment list and all 12 clothing slots.
Add new artwork through the folder-based importer, retaining all original canvas
margins; IDs must never be reused for different garments. Retain retired art and
manifest records for existing owners. The runtime pool consists of wearable
overlays; standalone Items illustrations do not become additional wearable
copies of the same designs. New clothing fit defaults use upper-body alpha bounds
and slot rules to record native artwork stances, not equip restrictions. Imported
`clothing-fit-rules.json` supplies detailed/extended hem defaults; catalog `warp`
(`auto` or `none`) and `warpFullHem` values override them. Rebuild and ship
`fit-profiles.json` after changes to source art or diaper registration rectangles.
These are editable defaults; the entire expanded catalog has not had every possible
outfit combination visually reviewed.

## Economy and operation

Tier odds are Common 55%, Uncommon 25%, Rare 14%, Epic 5%, Legendary 1%.
Each item within a tier is equally likely; exact odds appear in the design book.
Rolls charge coins only, with the existing Atelier pricing and receipt rules.
`CLOTHES_GACHA_ROLL_PRICE` accepts whole numbers from 3 to 10,000.
`CLOTHES_GACHA_ENABLED=false` pauses new clothing trades while retaining recovery.
Clothing trading also follows Atelier's enablement gate. Care and saved outfits
remain available while new purchases are paused.

`data/clothes-gacha.db` holds the clothing inventory, payment journal and
`littlepottchi_players`. `data/diaper-gacha.db` remains the Atelier collection
source. Back up both together with identity/wallet state. Clothing has its own
wallet recovery registration; Retry payment and `/lidollid wallet retry` resume
the exact saved purchase. Wallet credentials never reach the browser.

The shared HTTP server serves both games. The deployment script packages their
assets and editor and validates the manifest before switching releases. If the
reverse proxy already forwards `/`, no change is needed; otherwise also forward
`/clothes/` and `/littlepottchi/` to the same listener as `/diapers/`.
No live deployment or real-wallet purchase is part of the local verification.

## Littlepottchi wetting and timed care

Optional **messy mode** adds a saved timer randomly set to 10–14 hours for each accident. Each messy accident uses
two bulk units alongside wettings. Disabling pauses the timer; a fresh change
clears both conditions. The UI labels this as game timing because the AI analysis
currently contains no bowel-event counts. Messy reminders use the existing opt-in.

Littlepottchi now has saved wettings, per-diaper bulk capacity, leaks, pantry food, hydration and timed care. Replacing a diaper clears wetness and selects its matching base; collectible designs are reusable. LITTLEPOTTCHI_API.md describes the latest-analysis community rhythm, default behavior and optional Little Log push bridge.
