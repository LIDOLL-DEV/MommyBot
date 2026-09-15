# Quest-making notes

Prism Drop wagers return 2x, rounded-up 1.5x, 1x or zero according to landing
distance. These are wallet-journal game payouts, not quest rewards. Replaying a
saved animation must never award progress or additional coins. Any future quest
integration should consume a unique settled round once. See [BALLDROP_GUIDE.md](BALLDROP_GUIDE.md).

Coin pegs add 1-5 coins each once per paid drop, including misses. Bombs may
revisit pegs but cannot re-award them. Future quests must deduplicate by saved
round and peg coordinates rather than reacting to animation or replay events.
Layouts reshuffle each wager, so a coordinate is only a peg identity within its
saved round; it must never be treated as a persistent collectible.

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
