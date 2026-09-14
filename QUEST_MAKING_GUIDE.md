# Quest-making notes

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
