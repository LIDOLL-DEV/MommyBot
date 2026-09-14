# Contributing to MommyBot

The application is an ES-module Node.js Discord bot. Runtime code lives under
`src/`; dependency versions are declared in `package.json` and resolved in
`package-lock.json`. Keep both in sync and use `npm ci` to reproduce installs.
Run `npm test` before deploying.

Little Log wallet support lives in `src/wallet/`; see
[ONLINE_WALLET_GUIDE.md](ONLINE_WALLET_GUIDE.md). Request explicit OIDC wallet
consent for both currencies in the combined account login, and keep bearer grants
out of Discord replies and logs. Never set local balances from remote snapshots. Online adoption pins an
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
