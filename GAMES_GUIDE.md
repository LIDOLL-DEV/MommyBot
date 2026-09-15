# Games in Little Log

Open **Games** at https://lidoll.dev/tracker/#games. Anyone with a LiD0llID
account can play Diaper Atelier, Cozy Hangman and Touhou Trader. Discord
membership is optional. Games open in a separate tab and require internet.

Press **Sign in with LiD0llID**, register if needed, and approve wallet access
on LiD0llID. The same verified account owns both the game session and the online
wallet. Sign-in itself does not charge coins or stars. Game prices stay unchanged:

| Game | Sign-in path on bot.lidoll.dev | Price |
| --- | --- | --- |
| Diaper Atelier | /diapers/login | 3 coins per roll |
| Cozy Hangman | /hangman/login | 1 coin per round; 1 coin earned per newly revealed letter position |
| Touhou Trader | /touhou/login | 1 star or 25 coins per adoption |
| Prism Drop | /balldrop/login | Bet 1, 5, 10, 25, 50 or 100 coins; returns depend on your landing guess |

Prism Drop is also available from `/menu`, `/balldrop` and the direct bot page
`https://bot.lidoll.dev/balldrop/`. Its 10-by-20 field has random entry pins 4-7,
glowing trails and free replay. Exact guesses return 2x, one away returns 1.5x
rounded up, two away returns 1x, and larger misses return zero. Returns include
your stake. See [BALLDROP_GUIDE.md](BALLDROP_GUIDE.md). The separate tracker site
needs its own game-list entry if it should launch Prism Drop from there.

## Saved progress and existing accounts

New standalone players receive an opaque web player ID in the identity database.
No Discord account, role or membership is created. Identity comes from the
verified issuer and subject, never a display name or browser-supplied owner ID.

If an account already has a confirmed Discord link when first playing on the
web, its existing player ID, collections, saves and payment journals are reused.
Standalone web progress keeps its ID even if the account later links to Discord.
There is no automatic merge between previously separate web and Discord saves;
Discord commands continue to use their Discord player ID. Wallet balances remain
with the same LiD0llID account. After removing an existing Discord link, a new
standalone web session cannot claim the former Discord player's collections.

Games have separate eight-hour sessions. Signing in again replaces that game's
older sessions. Use the game's Sign out button on shared devices; signing out of
Little Log does not close other game sessions. Discord unlink still invalidates
sessions owned by the removed link. Standalone sessions are independent.

## Touhou play spaces

**Little Log community** is a shared public collection/market world for all
signed-in players, including those without Discord. When it is your only play
space, it opens automatically. Discord-linked players can also select their
existing servers, with fresh membership checks on every request. Each play
space keeps separate character stock, ownership, trades, potions and battles.
The public world does not reveal or grant access to private servers.

To gift or swap in the public world, share the **player ID** displayed in your
trader. Both players must first open that play space. Enter the recipient's ID,
choose the character, and confirm. Swaps appear in the recipient's trade inbox;
they must accept within one minute. Press Refresh to check the inbox. In private
Discord worlds, recipient IDs remain Discord IDs. No web trade sends a Discord
notification. Existing ownership, menu revision and payment checks still apply.

Battles retain the existing 90-second idle limit; menus expire after five idle
minutes. Back to trader home reopens the menu. Momiji's existing reserved owner
rule is unchanged.

## Wallet consent and recovery

Game login requests openid/profile and wallet/stars read/write scopes with an
explicit consent prompt. The server exchanges the approved proof only after
verifying the OIDC identity, and checks the returned wallet identity again.
Tokens stay in the protected wallet database and never reach game JavaScript.
A denied or mismatched approval cannot create an authenticated game session.

For an expired wallet, use the game's LiD0llID sign-in link again. If a payment
response is lost, use Refresh and Retry pending payment rather than buying again.
Existing pending-payment guards, account pinning and durable receipts remain.

## Deployment

Back up the existing identity, wallet and game databases. The new
web_game_accounts and public_game_players tables are created automatically in
the identity database; no game records are rewritten. Include them in backups.

After reviewed changes are committed and pushed, update MommyBot first using
its existing scripts/update-fedora.sh, then update omo-trainer using its
existing deploy/fedora-update.sh. Restart through those normal service scripts.
No deployment is performed by preparing this patch.

Existing LiD0llID and wallet features must be enabled with matching client IDs.
The registered /auth/callback and existing consent scopes are reused; no new
OIDC client or redirect URI is needed. Proxy /auth/, /diapers/, /hangman/ and
/touhou/ to the bot's auth listener. Tracker game redirects continue using
LIDOLLBOT_PUBLIC_ORIGIN (default https://bot.lidoll.dev).

After deployment, check all three games with a real LiD0llID account that has
never linked Discord, then check an existing linked player's old collection.
Local fixtures use synthetic accounts and balances, so production consent and
routing still require this deployment check.
