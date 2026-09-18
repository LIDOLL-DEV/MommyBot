# Quest-making notes

## Discord community features

Starboard votes and reaction roles are server features, not quests or currency
rewards. Do not count them as Littlepottchi care tasks or imply that starring a
message earns coins. Configuration belongs in `/admin/`; see [ADMIN_GUIDE.md](ADMIN_GUIDE.md).

## Littlepottchi

Count complete design IDs, not individual A/B/C or back-section PNGs, for future
collection quests. The 929-item wardrobe has 12 clothing/accessory slots. Only
diapers and training pants may fill the inner-bottom slot; never award ordinary underwear.
Trousers and pants are retired: exclude their historical design IDs from new rewards.

Automatic clothing stretch and stance adjustments are rendering only. They do
not consume garments, create new items, complete quests or grant rewards. Changing
diapers retains equipped clothing; do not require a new clothing roll for a wider base.

Care moments currently count companionship actions only; they grant no coins,
items or quest completion. Future clothing quests must reference a unique settled
clothing job, never a reveal animation or a wardrobe render. Equipping and fresh
changes do not consume or award collectible copies. See [DRESSUP_GUIDE.md](DRESSUP_GUIDE.md).

## Ordinary conversation

Chat categorization is not a quest event. A respond/skip decision grants no
progress or coins; both silently skipped messages and free-form replies remain
independent of the game economy.

Prism Drop wagers return 2x, rounded-up 1.5x, 1x or zero according to landing
distance. These are wallet-journal game payouts, not quest rewards. Replaying a
saved animation must never award progress or additional coins. Any future quest
integration should consume a unique settled round once. See [BALLDROP_GUIDE.md](BALLDROP_GUIDE.md).

Coin pegs add 1-5 coins each once per paid drop, including misses. Bombs may
revisit pegs but cannot re-award them. Future quests must deduplicate by saved
round and peg coordinates rather than reacting to animation or replay events.
Layouts reshuffle each wager, so a coordinate is only a peg identity within its
saved round; it must never be treated as a persistent collectible.

Sound cues, including replayed coin chimes and landing melodies, are cosmetic
and must never grant quest progress or currency.

Little Log nightly reports are read-only and grant no currency, quest progress
or roles. Generated report prose must never trigger game actions. See
[NIGHTLY_REPORTS_GUIDE.md](NIGHTLY_REPORTS_GUIDE.md).

Server onboarding is not a quest or currency reward. The welcome message asks
members to read the rules and finish LiD0llID registration in Discord; only the
existing confirmed-link path can award their server-access role. Do not let a
welcome or generated greeting complete a quest or change wallet balances.

MommyBot currently has no quest editor or quest-authoring subsystem. The Coin
Garden leaderboard is a read-only view of online LiDollcoins and grants no quest
rewards. Any future quest rewards must use the existing wallet payment journal;
never change currency using leaderboard snapshots. See
[CONTRIBUTOR_GUIDE.md](CONTRIBUTOR_GUIDE.md) for wallet integration rules.

Player **Send coins/diamonds** actions are voluntary transfers, not quest rewards.
Future quests must not trigger a transfer on a player's behalf or grant rewards
from repeated transfer receipts. Stars remain excluded from player transfers.

## Littlepottchi wetting and timed care

Appearance editing and unclothed previews do not count as care, grant inventory,
reset accident timers or satisfy cleanup requirements. Keep quests independent
of anatomy, hairstyle, gender and body shape.

Opening a picture menu, searching diapers, selecting a card, and cancelling grant
no progress. Only the confirmed server action may count toward care. Fresh Change
keeps required wipe cleanup inside its menu; selection cannot bypass that guard.
Moving actions into dialogs does not change task deadlines or completion rewards.

Full/uncomfortable and leaking are separate states. Do not complete a leak or
cleanup quest merely because bulk reaches capacity. Only a successful overflow
roll or diaper-free accident creates body cleanup; a contained full diaper can
be changed freely. One wipe handles all accumulated cleanup regardless of count.

Public `/doll` and `/pottchistats` checks apply elapsed care but grant no care
moments, inventory, currency, or quest progress. Sharing never changes clothes,
uses a wipe, or restarts a timer; the same applies to their prefix aliases.

Toy sessions are optional adult-character care actions. Do not gate ordinary
quests on gender or toy use. A finished session adds one care moment; starting,
repeating activation, or stopping does not grant completion credit.

Diaper removal preserves accident clocks and burns a soiled diaper just like a
change does. Never write a quest that assumes a used collectible diaper survives a
change, and never grant replacement copies for care alone. A cleanup task completes
only after an owned baby wipe is consumed atomically; one wipe clears all current body accidents.
Contained diaper accidents do not require this task. Never grant wipes from a
purchase animation or count a pending supply payment as delivered inventory.

Messy accidents are optional care events, not rewards or quest completions.
Their intervals vary from 10 to 14 hours; quests must not assume a fixed deadline.
Fresh changes clear wetness and mess together; toggling the mode grants nothing
and preserves the remaining countdown. Do not require messy mode for ordinary care.

Littlepottchi play and rest are durable timed activities. Start an activity through the authenticated doll action; award its rewards only after finishesAt, once. Food, water and fresh replacements satisfy separate needs. Do not award coins or alter collection ownership for care tasks. See LITTLEPOTTCHI_API.md.
