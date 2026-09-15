# Littlepottchi and Clothes Emporium

## Play

Open `/littlepottchi/` or `/clothes/` on the MommyBot host, or use the matching
Discord slash command. Sign in with LiD0llID. An existing Diaper Atelier browser
session works across all three games, including sign-out and account revocation.

- **Clothes Emporium:** roll for one complete garment for 3 LiDollcoins by default.
  The catalog contains **1,080 wearable items** across 13 clothing/accessory slots.
  Browse 36 designs per page, search by name and filter by slot or rarity.
  A/B/C image sections combine into one garment, including alternate hems and back sections.
  Duplicates remain separate copies; buy and sell them at the shared clothing bank.
- **Littlepottchi:** choose a name, soft/angular body, hair and face. Wear owned
  clothing and any of the 58 Atelier designs. A starter shirt and Cloud Tapes
  appear when those slots are empty; these free fallback visuals are not sellable copies.
  Bras and corsets can replace the fallback shirt. Ordinary underwear replaces
  the equipped diaper and uses the regular stance; equipping a diaper replaces
  underwear and selects that diaper's stance. Neither choice consumes a copy.
- **Automatic stance:** the equipped diaper selects the base. Larger silhouettes
  select `DQ_Base_2` (soft) or `DQ_Base_4` (angular). Smaller diapers restore
  `TQ_Base_3` or `TQ_Base_2`. Players do not choose the stance separately.
  Incompatible garments are removed from the outfit but remain owned.
- Feed, play, rest and fresh changes are free. Each action has its own 30-second
  cooldown. Fullness, energy, comfort and happiness decrease gradually offline,
  stopping at zero. There is no death or loss of collectibles. Changes do not
  consume owned diapers or create another copy.

The wardrobe checks available ownership every time it renders. Selling the last
copy, or reserving it for sale, removes permission to wear it. Another available
duplicate keeps the design wearable. Refresh other open tabs after a trade.

| Slot | Designs |
| --- | ---: |
| Tops and dresses | 380 |
| Headwear | 150 |
| Underwear | 131 |
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
bounds, constituent garment sections, compatible stances and diaper mappings.
The initial 20 wide diapers were selected from inspected silhouettes with an
alpha-bound bottom beyond row 505. This threshold bootstraps the explicit manifest;
the game uses the manifest's saved `stance`, not a runtime size guess.
`Berry Spell` has no supplied matching full-canvas print overlay: its original
Items illustration uses a documented fit rectangle matching the Giant silhouette.
All other diaper designs use full-canvas wearable overlays.

Body and wearable layers use their original 387 × 875 coordinates. Never stretch
a narrow body sideways to fit a diaper. Hair style 4 draws its back before the
body and its front below headwear. Clothing covers lower layers normally.
Stockings and most bottoms/long dresses are conservatively restricted to narrow
stance until their alternate fit is reviewed. Wide roller skates supply one
explicit alternate footwear option.

## Modding tools

The independent MommyBot editor is `python/game_editor_gui.py`; the existing
GameMaker editor in `lidollquest` is unchanged. The packaged editor requires
Python, Pillow, Tkinter and Node.js. Run:

```powershell
py -3.11 python/game_editor_gui.py
py -3.11 python/game_editor_gui.py --validate
py -3.11 python/scan_dressup_assets.py
py -3.11 python/import_dressup_assets.py --source C:\Users\langley\GameMakerProjects\extraAssets\Figures
```

The editor previews both bases, changes garment names/rarities/slots/fit and the
diaper's automatic stance. It validates with the shipping Node loader, backs up
successful saves, and restores the previous catalog on validation errors.
Restart the bot to load changes. The importer preserves existing tuning by ID.
The editor includes a searchable garment list and all 13 clothing slots.
Add new artwork through the folder-based importer, retaining all original canvas
margins; IDs must never be reused for different garments. Retain retired art and
manifest records for existing owners. The runtime pool consists of wearable
overlays; standalone Items illustrations do not become additional wearable
copies of the same designs. New clothing fit defaults use upper-body alpha bounds
and slot rules, with conservative narrow fits for leg-dependent garments. These
are editable defaults; the entire expanded catalog has not had every possible
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
