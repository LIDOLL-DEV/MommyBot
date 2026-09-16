# Contributing to MommyBot

## Littlepottchi wardrobe

The catalog now covers 929 wearable items. Maintain folder-based discovery in
`python/wardrobe_catalog.py`, its per-source import report, 36-item browser pages,
and all 12 garment/accessory slots. Only diapers and training pants may fill the
inner-bottom slot; ordinary underwear must stay excluded. Preserve opaque color
variants, rejoin shared bodices with alternate hems, and draw back sections behind the body. Run
`py -3.11 python/test_wardrobe_catalog.py` when changing import classification.

Trousers, jeans, leggings, shorts, bloomers and dungarees are retired. Keep the
importer's `excluded-trousers` rule and the runtime catalog validation; old saved
selections are removed without deleting purchase history or resetting care.

`src/dressup/` connects Clothes Emporium and Littlepottchi to Atelier sessions and
inventory. See [DRESSUP_GUIDE.md](DRESSUP_GUIDE.md). Preserve automatic diaper-to-base
selection, complete A/B/C garment layers, live ownership checks and separate
clothing payment recovery. Art and fit metadata live in `assets/dressup/catalog.json`;
update `python/game_editor_gui.py` with any schema changes. Python tools belong
under `python/`, PowerShell tools under `ps/`. Run the dress-up tests and browser
check after changing outfit layers, fit rules or transactions.

Clothing no longer has stance-based equip restrictions. `web/fit.js` ports
lidollquest's pixel-profile dress/pants warp; browser Canvas, Discord PNGs and the
editor share its strip plan through `web/layers.js`. Keep complete garment
sections on the same plan and preserve sleeve positions. `stances` records native
art registration for leg alignment; it must not revoke ownership or unequip items.
Rebuild `assets/dressup/fit-profiles.json` with
`py -3.11 python/bake_clothing_profiles.py` after changing artwork or diaper
rectangles (the importer also runs it). Commit generated profiles with the art.
Only equipped profiles are sent to the browser; original PNGs stay unchanged.
School uniforms override imported no-warp flags. Preserve their `warp: "auto"`
and `warpPreserveHem: true` defaults when reimporting; see the Pearl diaper
regressions in `test/clothing-fit.test.js`.

## GitHub activity tracking

`GITHUB_REPOSITORIES` is a comma-separated list with precedence over the legacy
`GITHUB_REPOSITORY` setting. Keep per-repo event and commit cursors in the shared
version-2 state map, migrate legacy state without replaying it, and preserve
temporarily removed entries. Poll sequentially and checkpoint each successful repo
atomically; one repo's failure must not discard another repo's saved progress.
Tests must use mocked GitHub, Discord and AI transports, never live announcements.
Keep configuration errors inside the optional watcher. Log a controlled diagnostic
and return a no-op stop handler so GitHub configuration cannot crash Discord or games.
Keep `scripts/check-github.mjs` read-only: bound GitHub requests, prohibit redirects,
never touch cursor files or Discord, and omit credentials and commit text from output.

## Chat routing

Keep routing policy in `src/graph/router.js` and bounded Discord context in
`src/bot/conversation.js`. The handler supplies fresh context on every turn,
serializes each member's checkpoint updates and sends only an assistant message
from an explicit respond route. Never use cleaned user text or a previous
assistant message as evidence that the current turn should be sent.
Classifier failures stay silent; direct addresses bypass classification. See
[GENERATION_TUNING_GUIDE.md](GENERATION_TUNING_GUIDE.md) for prompts and diagnostics.

The application is an ES-module Node.js Discord bot. Runtime code lives under
`src/`; dependency versions are declared in `package.json` and resolved in
`package-lock.json`. Keep both in sync and use `npm ci` to reproduce installs.
Run `npm test` before deploying.

Prism Drop lives in `src/balldrop/`; see [BALLDROP_GUIDE.md](BALLDROP_GUIDE.md).
Preserve the 10-column/20-row field, uniform entry pins 4-7, server-owned random
bounces, six allowed bets, and gross payout rules with half coins rounded up.
Freeze outcomes before debiting; hide them until a verified debit. Debit and
payout retries must reuse their saved operation IDs and original wallet binding.
Load pending guards before HTTP and drain wallet actions before journal close.
Route `/balldrop`, `!balldrop`, private menus and standalone SSO consistently;
unlink must revoke its sessions. Animation/replay cannot affect payments.

Generate each new layout with `randomObstacles()` using server randomness.
Keep the 11 blocks, nine bombs and eight coins in distinct cells, with the entry
row clear. The fixed collision fixture belongs only in tests. Follow the
tracker pastel palette in both CSS and canvas; label saved fields as history.
The browser sound engine is `src/balldrop/web/sound.js`, served alongside the
other game assets. Initialize it from player gestures, preserve mute, release
audio nodes and keep audio exceptions outside the wallet flow.
Save each special-peg layout, full trajectory and rolled coin bonus before
debiting. Blocks deflect two columns; bombs launch in eight directions once per
drop; coin pegs award 1-5 coins once each. Combine landing return and bonus in
the existing idempotent credit, even on misses. Legacy rows have no obstacles
or bonus and keep their original path. Never recompute old results from the
current board or let cosmetic pickups call wallet operations.

Nightly Little Log publication lives in `src/reports/`; see
[NIGHTLY_REPORTS_GUIDE.md](NIGHTLY_REPORTS_GUIDE.md). Keep report-read tokens
separate from wallet credentials. Validate daily completion metadata and attach
full Markdown with mentions disabled. Persist channel/report documents before
sending and commit receipts with cursors after success. Never advance normal
polling to `latest_cursor` or blindly resend uncertain deliveries. Start on
Discord readiness and drain before disconnecting. Include the read-only
`scripts/check-reports.mjs` in releases and private `data/reports.db` in backups.
Run one publisher process per journal.

Report feeds accept explicit HTTP loopback/private IPv4 destinations in
production, matching the wallet's direct-backend policy for hairpin NAT bypass.
Keep public HTTP, URL credentials, queries and fragments rejected and redirects
blocked. Both document retrieval and listing must preserve the configured port
and base path. HTTPS remains available for public tracker connections.

Report configuration errors must disable only the optional publisher, leaving
Discord startup and the saved journal untouched. Validate configuration inside
the publisher factory's guarded body, not a default argument that can throw
before that guard. Keep diagnostic field names and requirements authored in
code, collect all failures, and never interpolate dotenv values or URL errors.
The standalone read-only check must still exit unsuccessfully for bad settings.

New-member onboarding lives in `src/welcome.js` and
`src/graph/welcomeMessage.js`; see [WELCOME_GUIDE.md](WELCOME_GUIDE.md). Route
`GuildMemberAdd` independently of chat and wallet gates and request `GuildMembers`
unless welcomes are disabled. Verify the destination belongs to the joining
member's server, skip bots, and permit mentions only for that member. Keep the
rules jump link and complete browser-to-Discord registration steps authored in
code. Generate only the welcome prose on the configured `.250` endpoint, with
a bounded timeout, shared persona and factual fallback. Never pass member data
to the model, assign roles from a welcome, backfill historical joins, or log
Discord/provider bodies. Preserve join-event deduplication, nonce enforcement
and shutdown draining. Welcome state is in memory; no database migration is needed.

Build every member-facing model persona through `buildSystemPrompt` in
`src/graph/prompt.js`, or use its shared `SYSTEM_PROMPT` export. The appended
community rule addresses all members as girls with she/her pronouns, including
when custom persona text is configured. Preserve the swear-jar masculine-wording
guard and feminine fallback notices when editing generation.

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

Swear-jar notification prose comes from `src/graph/swearJarMessage.js`, with a
bounded AI timeout and the original factual message as fallback. Append payment
status and `swearJarBalanceText` from the journal after generation and channel
lookup; keep unallocated confirmed coins separate from reserved unpaid prizes.
Do not send player messages, identities or balances to the model. AI prose must
never control payments, account guidance or winner selection. See
[GENERATION_TUNING_GUIDE.md](GENERATION_TUNING_GUIDE.md).

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
Player transfers live in `src/wallet/transfers.js`. Ordinary players send only
coins or diamonds, funding the recipient from their own wallet after a private
menu review. Never reuse administrator gift credits as transfers. Load transfer
guards in `WalletService` before games and HTTP startup. Lock both participants
before asynchronous validation and persist their original accounts, API settings,
asset, amount and Discord interaction ID before debiting. Reject stars at both
the service and database boundaries. Preserve stable debit/credit/refund IDs,
receipt checks and attempted flags: a later rejection cannot erase an earlier
uncertain payment. Refund only a definitively rejected first credit. Either
participant may retry the same transfer; both stay reserved until settlement.

`wallet_transfers` is an additive table in the existing wallet database. Finish
all transfers before rolling back to older code, which cannot enforce these
reservations. Preserve the table and provider receipts; do not restore balances
or delete journals to recover payments. No new environment settings are needed.

The private `/menu` hub and `/lidollid [wallet] menu` aliases live in
`src/auth/menu.js`. Keep their owner/guild binding, five-minute expiry, bounded
session count, revision checks and in-flight lock. Route menu actions through
`runIdentityAction` and `runWalletAction` so slash and button permissions,
linked-role assignment, unlink guards and gift journaling stay identical.

The **Coin leaderboard** link opens the public `/leaderboard/` page when online
wallets are enabled. `src/leaderboard/` lists confirmed Discord and standalone
browser registrations once per issuer/subject, including unavailable wallets.
Publish only usernames, online coins, ranks and read timestamps. Keep unknown
balances unranked, equal balances tied, provider reads limited to four at once,
and snapshots cached in memory for one minute. `WalletService.readBalance`
rechecks account/grant binding after its read without locking out purchases.
Re-read the registration roster after network awaits and render names through
DOM text nodes. Never persist snapshots as spendable local balances. See
[COIN_LEADERBOARD_GUIDE.md](COIN_LEADERBOARD_GUIDE.md).

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

## Explicit report sharing

The report client also accepts `source: manual` when `share_with_bot === 1`, set by Little Log's authenticated **Run and share with MommyBot** action. Bind document source/sharing metadata to the listed entry. Keep nightly captions unchanged for reconciliation; explicitly shared reports use the requested-report caption and the same durable delivery journal. See [NIGHTLY_REPORTS_GUIDE.md](NIGHTLY_REPORTS_GUIDE.md).

## Littlepottchi wetting and timed care

Adult appearance choices are imported by `python/appearance_catalog.py` and
validated in the catalog loader. `src/dressup/appearance.js` resolves layers and
the anatomy-specific bare camera; gender and physique cannot override the chosen
anatomy. Preserve original PNG bytes and full-canvas registration. CW pubic-hair
images use a 4× canvas and must scale to 387×875. The vulva uses a source rectangle
from the supplied Base_1 rather than replacing the player's chosen physique.

Adult-doll excitement is a separate abstract stat in `src/dressup/excitement.js`.
Advance it before updating `player.updated`; split offline time at toy completion.
Persist each session's duration and relief so tuning does not rewrite an active
timer. Gender is optional self-description, independent of body shape and rules.

The Little Log bridge can use private LAN HTTP for backend calls independently of
the public browser origin. Keep redirects disabled and bearer authentication
required; do not change OIDC callbacks to fix bridge hairpin NAT.

Rear cameras are mapped by `python/buttcam_catalog.py` and selected on the server.
Never publicly serve the camera PNGs or use wetting count to select messy frames.
Baby wipes use the clothing payment journal and `care_supplies` in the pet database;
consume stock and save cleanup together. Preserve recovery of already-paid jobs.

Messy mode defaults off. Sample a new 10–14-hour interval for each accident,
including offline catch-up; preserve existing deadlines across reads and restarts.
Preserve paused countdowns across toggles, lifetime
totals across changes, and old wetting state during migration. Both accident
types share bulk. Keep the bridge and service worker's `mess` notification aligned.

Care simulation lives in src/dressup/care.js; browser, background ticks and the Little Log API all use the same saved state. Preserve collectible ownership, server timing and identity-bound reminder opt-in. See LITTLEPOTTCHI_API.md for bridge installation and protocol.

### Littlepottchi picture menus

`src/dressup/web/menu.js` owns the native dialog for Fresh Change, Food, Toys,
Play & Rest, Wardrobe, Character, and Care & Settings. The dashboard keeps the
doll, meters and action buttons together. Picker cards use catalog artwork and
current ownership; selecting a card is local until its confirmation button is
pressed. Recheck cleanup and availability on every state update. Keep Close and
Escape available, restore focus to the opener, and show failures inside the menu.
Character drafts render on their own canvas; the dashboard shows the saved doll.
The shared shop page retains its inline collection and payment recovery controls.

Keep accident countdowns, interval ranges and community frequency out of the
player interface, including Care & Settings. Server accident timing still runs;
only care, activity and toy countdowns are displayed.

The dashboard buttcam sits before the care panel (below the doll on narrow screens).
Keep its single image on the authenticated camera endpoint; moving it out of the
settings dialog must not bypass server-selected clean/messy frames.

`src/dressup/web/pastel.css` loads after the layout styles and supplies the shared
Littlepottchi/Clothes Emporium theme. Its pink, lilac, mint and yellow palette and
local display fonts follow Little Log's `little-tracker` theme. Keep color changes
there, preserve visible focus and selected-card marks, and avoid external fonts
or image requests. Action illustrations are inline SVG; original doll art is unchanged.

`player.starterTopEnabled` defaults true for old saves. Unequipping the top slot
sets it false, so reads and restarts respect an empty top slot. Only the designated
starter shirt can be re-equipped without ownership; it grants no inventory or
sale entitlement. Browser and Discord rendering consume the same resolved top.

### Public Littlepottchi Discord commands

`src/dressup/commands.js` registers `/doll` (PNG plus diaper status) and
`/pottchistats` (public care stats), with exact `!doll` / `!pottchistats` aliases.
The existing gacha dispatcher routes both before conversation handling. Both
commands resolve the invoker's confirmed Discord identity to the browser's
canonical game account, including web-first saves. They post in the invoking
channel with a public `/littlepottchi/` link and no authentication ticket.

PNG export uses `src/dressup/web/layers.js`, also used by the browser, and
`python/render_littlepottchi.py` with Pillow. Install Pillow in the bot's Python
environment; Windows defaults to `py -3.11`, other hosts to `python3`. Set
`LITTLEPOTTCHI_PYTHON` to an executable path when needed. The subprocess receives
only registered image layers through stdin and returns PNG bytes through stdout;
it uses no shell, temporary player files, or public image route. Runtime guards
limit rendering to two concurrent jobs and one pending check per player.
The identity link is rechecked before a rendered image is posted.

Fedora deployment installs `python3-pillow` on first install and on updates that
lack it. `scripts/check-doll-render.mjs` renders a synthetic PNG as the service
account before tests and release activation, honoring the configured interpreter.
Keep operator errors classified in `DollRenderError`; do not print raw Python
stderr or expose dependency diagnostics in the public Discord reply.

Overflow uses one capacity unit per wet or messy accident, as in lidollquest's
`_handle_diaper_overflow`. Full diapers cause discomfort; only subsequent accidents
roll 10% per excess unit, capped at 100%. Resolve mixed offline events in timestamp
order and keep leak randomness separate from messy interval sampling. Batch only
guaranteed outcomes. `LittlepottchiStore.act` persists elapsed care before starting
the action transaction so a rejected change cannot reroll its newly due leak.
Wipe consumption and the resulting cleaned state still commit atomically.

Wallet mint/refund calls must go through WalletClient so server proofs bind the exact recipient and operation. Never serialize its non-enumerable rewardKey or forward it to browsers. See ONLINE_WALLET_GUIDE.md for setup.
