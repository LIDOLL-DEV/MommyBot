# Contributing to MommyBot

The application is an ES-module Node.js Discord bot. Runtime code lives under
`src/`; dependency versions are declared in `package.json` and resolved in
`package-lock.json`. Keep both in sync and use `npm ci` to reproduce installs.
Run `npm test` before deploying.

`src/graph/connection.js` supplies shared model URLs, bounded read-only probes
and sanitized nested network error codes. Keep probes consistent with the chat
and router endpoints. `scripts/check-runtime.mjs` reports model reachability and
swear-jar configuration without printing secrets or touching account databases.
Deployments record source revision metadata and preserve the production dotenv
file; changing the checkout `.env` never repairs Fedora's service settings.

The swear jar uses `src/swearJar.js` for message matching, Discord notices and
weekly scheduling, and `src/wallet/swearJar.js` for the durable coin journal.
See [SWEAR_JAR_GUIDE.md](SWEAR_JAR_GUIDE.md). Charge exactly one online coin per
matched human server message, before the AI channel gate. Deduplicate by message
ID, wait for in-flight wallet changes before creating a fine, and allocate only
confirmed debits to a single saved winner per server and weekly boundary.
Check all confirmed Discord links against current server membership; missing
wallet grants must not exclude a linked winner. Keep pending prizes pinned to
their original identity/account, compose the wallet reservation guards before
HTTP startup, and preserve payment recovery when new fines are paused. Stop and
drain the scheduler before closing identity/wallet storage on SIGINT or SIGTERM.

Cozy Hangman lives in `src/hangman/`; see [HANGMAN_GUIDE.md](HANGMAN_GUIDE.md).
Charge exactly one online coin before exposing a playable word. Credit one
coin per newly revealed position, recording the guess and credit reservation
atomically. Duplicate guesses never earn again. Keep answers server-side until
the round ends, bind every round to its original wallet, and compose its pending
guard with the other games. Register and route `/hangman`, `!hangman` and the
private menu button through the same handoff. `src/games/sessions.js` shares the
identity-bound browser session logic while preserving existing atelier table
names and sessions. Each game retains independent cookies and CSRF values.
Load all journals before opening HTTP routes, revoke all game sessions on
unlink, and leave journals open until wallet actions drain during shutdown.

Diaper Atelier lives in `src/gacha/`, with supplied art and the reviewed rarity
manifest under `diaper-gacha/`. See [DIAPER_GACHA_GUIDE.md](DIAPER_GACHA_GUIDE.md).
`/diaper` and `/diapers` issue the same ephemeral, one-use browser handoff; all play happens under
the existing bot origin's `/diapers/` routes. Keep GET previews non-consuming,
and keep `!diapers` links in DMs. Dispatch that exact prefix before the chat
channel gate and LLM, ignoring messages from bots. Preserve
sessions bound to the confirmed identity, and mutations protected by exact
Origin and session CSRF checks. Browser code never receives wallet tokens.
Keep bank-copy reservations, pinned account/price, payment journal and delivery
in the same game DB. Compose `wallet.hasPending` across games, and load all
payment guards before opening the HTTP listener. Keep the game DB open until
wallet actions drain at shutdown. Cuteness ranks are explicitly authored in the
manifest. Bank prices use each design's stock; validate the displayed quote
before reserving and retain it for retries. Sale quotes use the post-deposit
stock and a spread so a buy/sell cycle cannot create coins.
Explain disabled Roll controls next to the button; reserve waiting cursors for
in-flight requests. Keep request preparation inside try/finally, and show a
confirmed prize before refreshing the balance. A failed refresh must not suggest
that a completed purchase needs to be repeated.

Little Log wallet support lives in `src/wallet/`; see
[ONLINE_WALLET_GUIDE.md](ONLINE_WALLET_GUIDE.md). Request explicit OIDC wallet
consent for both currencies in the combined account login, and keep bearer grants
out of Discord replies and logs. Administrator gifts live in `src/wallet/gifts.js`;
the shared `src/permissions.js` policy requires Manage Server or
`TOUHOU_ADMIN_ROLE_ID` on gift creation and administrator retries. Recipients may
only retry their own already-approved gift. Keep its original guild, actor,
recipient, asset, amount and account/API binding in `wallet_gifts`, along with
the Discord interaction ID and durable provider request ID. Load its pending
guard in WalletService before game guards, validate credit receipts for both
currencies, and never release an uncertain payment because a later retry fails.
Gift replies must not expose total balances or provider error bodies.
The private `/menu` hub and `/lidollid [wallet] menu` aliases live in
`src/auth/menu.js`. Keep their owner/guild binding, five-minute expiry, bounded
session count, revision checks and in-flight lock. Route menu actions through
`runIdentityAction` and `runWalletAction` so slash and button permissions,
linked-role assignment, unlink guards and gift journaling stay identical.
Gift entry uses a user select, amount modal and final review; recheck admin
permissions on every step. Clear the send screen before awaiting a credit and
recover pending rewards through the existing retry path. Never put codes or
balances in public replies. Game launchers must keep the trader channel gate
and the atelier's private authenticated browser handoff.
Never set local balances from remote snapshots. Online adoption pins an
opaque wallet account and API registration to a persistent reservation before
debiting; delivery and its receipt commit together in the trader database.
Every retry reuses the original payment ID and currency. Failed delivery refunds
the original debit, also idempotently. Keep unsettled reservations when the
feature is disabled, and do not let reconnect/unlink strand a pending payment.
`test/online-wallet.test.js` covers both currencies and recovery across restarts.
`wallet/economy.js` routes all other trader money changes through online coins.
Purchase previews use a rolled-back SQLite transaction to reuse pricing and
ownership checks without delivering anything. Keep the balance interception
synchronous and restore it in `finally`; never await while it is installed.
After a confirmed debit, revalidate the exact ledger and character reservation
before committing delivery. Credit-only actions commit game effects and their
payout queue together. Never rerun a won battle to recover a missing payout.
Marketplace legs pin both accounts; buyer/seller locks precede network awaits.
Seller credits can remain pending after ownership transfer. Preserve their
operation IDs, account bindings and retry access for both participants.
`test/online-economy.test.js` covers these flows and legacy-balance isolation.
Include `scripts/check-wallet.mjs` in Fedora releases for read-only connectivity
and registration checks. Wallet diagnostics must never print response bodies,
redirect destinations or arbitrary network exception messages. An HTML proxy
error does not prove a debit failed; preserve its pending payment record.
`LIDOLLCOIN_API_URL` may explicitly target a private HTTP backend, while
`LIDOLLCOIN_PUBLIC_ORIGIN` pins the public HTTPS approval page. Keep those
destinations separate and never follow API redirects with bearer credentials.

LiD0llID account linking lives in `src/auth/`. See
[LIDOLLID_GUIDE.md](LIDOLLID_GUIDE.md) for the OIDC registration and proxy setup.
`auth/page.js` and `auth/theme.css` define the shared browser-page shell, matching
the default pastel Little Tracker theme. Bundle styles locally and authorize
their exact content with a CSP hash; do not load tracker scripts, remote fonts,
or browser storage on sign-in pages. Keep dynamic body values HTML-escaped.
The member-facing [ACCOUNT_LINKING_GUIDE.md](ACCOUNT_LINKING_GUIDE.md) covers
linking and testing resets. Keep the status button and `/lidollid unlink` on
the same revocation-first path. Bind unlink buttons to the authenticated Discord
user; never accept another user's ID as an unlink target. Unlink cancels pending
sign-ins but preserves game data, remote balances and the awarded role.
Keep issuer/subject as identity keys, final confirmation bound to the initiating
Discord user, callback cookies host-only, and responses ephemeral. Only stage the short-lived provider access token in the protected wallet database
until exchange/expiry; never retain it in the identity database. Do not grant roles
from profile claims or infer wallet permission from an identity-only token. The new `data/lidollid.db` participates in state backups.
The linked-account role is an explicit operator setting, defaulting to
`1548848979754614857`. Award it only after successful Discord confirmation, or
on `/lidollid status` for a stored link. Use a single-role add so other roles
are preserved. Role assignment failures must not undo identity/wallet activation
or expose Discord error bodies. Keep role IDs out of OIDC profile claims.
`openid-client` is pinned to omo-trainer's tested version; preserve its signature,
state, nonce, PKCE and UserInfo-subject checks when upgrading.
`auth/diagnostics.js` reports only allowlisted stages/codes and HTTP statuses.
Never log entire OIDC errors or their causes: these can contain response bodies,
authorization URLs and tokens. Include `scripts/check-lidollid.mjs` in Fedora
releases so operators can verify discovery using the deployed dependency versions.
Keep login GET requests read-only with respect to tickets and OIDC attempts:
preview fetches must not consume a Discord user's link. The Continue form uses
an HttpOnly browser cookie, same-origin POST and a bounded body; preserve these
checks and the single-use store transition when changing the login page.
The Continue page must use `Referrer-Policy: origin`: `no-referrer` makes real
browser form POSTs send `Origin: null`, which the required origin check rejects.
Keep `no-referrer` on redirects/callback pages and never include the ticket path
or query in Referer. Validate form-header changes with the real-browser check
in `scripts/check-lidollid-browser.mjs`; Node fetch tests set Origin manually.

The Touhou trader is in `src/touhou/`; its ported images and rarity seed are in
`assets/`. See [TOUHOU_TRADER_GUIDE.md](TOUHOU_TRADER_GUIDE.md) for commands and
wallet rules. Gate every trader entry point using
`TOUHOU_CHANNEL_ID` (default `1548647250543251507`); `CHANNEL_ID` controls chat.
Keep ownership changes and receipt writes inside the same
`TouhouStore.mutate` transaction. In online mode, route currency through the
persistent payment journal; local mode keeps its debits in SQLite. Do not let chat-model output
award or spend currency. Permission checks belong in the Discord handlers.
`better-sqlite3` is a direct dependency at the same version used by conversation
checkpointing, and Fedora releases must include the assets directory.
Momiji's only permitted owner is `MOMIJI_OWNER_ID` (`319254336402358272`). Keep the
startup repair, transfer guards and SQLite ownership triggers consistent; the
owner is not a configurable store option.

`battleRules.js` contains the original combat formulas and balance constants;
`battles.js` wraps combat, inventory, healing and buybacks in SQLite transactions.
Battle profiles are keyed by guild and character, so progression follows normal
ownership transfers. Never transfer an active fighter; both command and store
paths enforce that rule. New tables are additive and leave existing wallets and
collections intact. When rolling code back, stop/resume or expire active fights
first: older code does not enforce battle locks.

`menu.js` renders the full button/select/modal flow in one message. Menu IDs carry
session revisions, sessions lock before awaiting Discord, and money-changing
operations use idempotent receipts. Battles have independent persisted turn
counters. Preserve all three protections when adding controls. Menus expire
after five idle minutes; battles expire after 90 seconds and settle on access.
Include `assets/touhou-attacks-seed.json` in releases alongside the other assets.

LangGraph (`0.4.10`), its checkpoint package (`0.1.3`) and the SQLite saver
(`0.2.2`) are pinned as a tested combination. Upgrade them together and run the
conversation tests from a clean install: opening SQLite alone will not reveal
checkpoint compatibility failures. `buildGraph(checkpointer)` takes an explicit
saver so tests can use disposable databases without opening live memory.

`src/db/sqliteSaver.js` adapts the library's pre-v4 pending-send migration to the
Topic channel's `[seen, values]` format. Keep this adapter until a tested upstream
replacement can read the legacy fixture without it. It transforms loaded state
in memory and preserves queued tasks; it does not erase historical records.

Fedora deployment files live under `scripts/`. Keep Bash and systemd files in LF
format; `.gitattributes` enforces this on checkout. See
[DEPLOYMENT_FEDORA.md](DEPLOYMENT_FEDORA.md) for installation and recovery and
[TESTING_GUIDE.md](TESTING_GUIDE.md) for verification.

Preserve the deployment boundary: code belongs in immutable release directories,
configuration in `/etc/mommybot`, and writable data in `/var/lib/mommybot`. New
persistent files should live under `data/` so stopped-state backups include them.
Document new environment variables in `.env.example`. Never commit credentials,
SQLite files, node_modules or private chat history.

If startup's Discord-ready message changes, update the deployment readiness
check. If shutdown handling changes, keep `KillSignal` in the systemd unit in
sync. Any database migration needs a documented rollback strategy because code
rollback alone does not restore older data.


## Games in the PWA

See [GAMES_GUIDE.md](GAMES_GUIDE.md) for direct LiD0llID game sign-in and the Touhou web adapter. Preserve issuer/subject identity binding, per-server collections, fresh Discord membership checks, menu revisions and shared payment journals. The PWA opens these games; all gameplay remains in MommyBot.


## Diamonds

Diamond support extends wallet client validation, explicit OIDC/device scopes, gift receipts, slash-command currency choices, and the private gift menu. Existing grants may omit diamonds; display reconnect-to-enable instead of inventing a zero balance or silently upgrading consent. Keep saved gift asset/request/account bindings during retries.
