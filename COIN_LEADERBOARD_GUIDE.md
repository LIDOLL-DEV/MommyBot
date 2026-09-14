# Coin Garden leaderboard

Open `/menu`, `/lidollid menu` or `/lidollid wallet menu`, then press
**Coin leaderboard**. The link opens a pastel webpage at the bot origin's
`/leaderboard/` path. Anyone with the link can view it without signing in.

The page shows all accounts registered with MommyBot through confirmed Discord
linking or LiD0llID browser-game sign-in. It does not enumerate every account at
the identity provider. An identity registered in both places appears once.
Display names come from those registrations, and coin counts come from the
connected online wallet. Stars, diamonds, Discord IDs and wallet credentials
are not included. No coins are charged to open or refresh the leaderboard.

Players sort by coins from highest to lowest. Equal balances share ranks
(for example 1, 2, 2, 4). Search filters the whole list without changing ranks.
The first three readable entries also appear in the top cards. Zero is a valid
balance; unavailable wallets stay listed below the rankings without a rank.
Reconnect an expired wallet through **Connect / renew** in Discord, or sign in
again through the browser game, then refresh the leaderboard.

Snapshots stay in memory for one minute, including unavailable results. Refresh
does not bypass that cache. The page shows when the snapshot was checked; coin
counts may change while other players are earning or spending. A failed refresh
keeps previously displayed results and clearly identifies the failure.

The feature uses the existing identity HTTP listener and wallet configuration,
with no new environment variables, database migrations, or dependencies.
Deploy the updated `src/` tree using the normal release procedure and restart
the bot. The menu link is present only when online wallets are enabled. The
existing proxy must forward `/leaderboard/` along with the other bot routes.
Rollback is a normal code rollback; no balance data needs restoring.

See [TESTING_GUIDE.md](TESTING_GUIDE.md) for automated and browser checks.
