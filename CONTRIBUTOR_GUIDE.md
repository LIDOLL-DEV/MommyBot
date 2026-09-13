# Contributing to MommyBot

The application is an ES-module Node.js Discord bot. Runtime code lives under
`src/`; dependency versions are declared in `package.json` and resolved in
`package-lock.json`. Keep both in sync and use `npm ci` to reproduce installs.
Run `npm test` before deploying.

LiD0llID account linking lives in `src/auth/`. See
[LIDOLLID_GUIDE.md](LIDOLLID_GUIDE.md) for the OIDC registration and proxy setup.
Keep issuer/subject as identity keys, final confirmation bound to the initiating
Discord user, callback cookies host-only, and responses ephemeral. Do not retain
provider tokens, grant roles from profile claims, or connect remote wallet
permissions implicitly. The new `data/lidollid.db` participates in state backups.
`openid-client` is pinned to omo-trainer's tested version; preserve its signature,
state, nonce, PKCE and UserInfo-subject checks when upgrading.

The Touhou trader is in `src/touhou/`; its ported images and rarity seed are in
`assets/`. See [TOUHOU_TRADER_GUIDE.md](TOUHOU_TRADER_GUIDE.md) for commands and
local wallet rules. Keep currency debits, ownership transfers and receipt writes
inside the same `TouhouStore.mutate` transaction. Do not let chat-model output
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
