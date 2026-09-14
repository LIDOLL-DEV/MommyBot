# Testing MommyBot

## Cozy Hangman

`test/hangman.test.js` covers one-coin entry, per-occurrence letter rewards,
duplicate and wrong guesses, wins/losses, forfeits, account pinning, replay,
insufficient funds, lost debit/credit responses, restart and storage recovery,
daily earning caps, shared pending-payment guards and Discord recovery. HTTP
tests exercise private handoff, CSRF, masked words, user isolation, separate
game sessions and logout. Command tests check slash registration, private DMs,
the main menu launcher and unlink revocation.

`scripts/check-hangman-browser.mjs` runs real Chrome against disposable stores
and a fake wallet. It checks keyboard and touch controls, immediate board display
before wallet refresh, saved games, exact coin rewards, pending recovery,
low funds, wallet errors, request preparation failures, win/forfeit, logout,
desktop/mobile overflow and CSP errors. See [HANGMAN_GUIDE.md](HANGMAN_GUIDE.md)
for tool variables. Never use real accounts or coins in these fixtures.

## Private command menu

`test/account-menu.test.js` serializes real Discord builders and checks the
private pastel panel, row/custom-ID limits, menu aliases, role-gated gift
buttons, recipient selection, amount forms, review/cancel, account confirmation,
unlink/disconnect confirmation and game handoffs. Tests reject foreign users or
servers, stale and expired controls, concurrent actions, bots, invalid amounts
and revoked admin access. An integration test runs a menu gift against the real
wallet journal and an idempotency-compatible fake provider; no live coins are
used. Existing identity, role, unlink and wallet tests cover the shared actions.

After deployment, open `/menu` in Discord, verify your private controls, and
check that ordinary members do not see gift buttons. Touhou Trader must still
require its configured channel. Use a designated test account for any operator
gift checks, and review the amount before pressing Send gift.

## Administrator wallet gifts

`test/wallet-gifts.test.js` uses disposable SQLite databases and a fake idempotent
wallet. It covers coin and star credits, command bounds, permission and recipient
checks, replayed Discord interactions, original-server admin retries, recipient
recovery, daily caps, malformed receipts, account/API pinning, lost responses,
restart recovery, SQLite completion failures and unlink guards. No live gifts
are sent. Run `npm test` before deploying; ordinary users must retain access to
login and balance even though gift subcommands enforce administrator permissions.

## Diaper Atelier

`test/diaper-gacha.test.js` covers the reviewed catalog, tier boundaries, the
three-coin default, stock-driven bank prices, stale quotes, duplicates, shared
stock, last-copy contention, request replay, original-account pinning, lost debit
and credit responses, SQLite delivery failures, restart recovery and pending
payment guards across games. It also checks private browser handoff, CSRF,
session expiry/unlink/logout, static file allowlisting and collection isolation.
Fixtures use disposable databases and an idempotent fake online wallet.
`test/diaper-commands.test.js` verifies both command aliases register and issue
private handoffs for the authenticated Discord user, including partial
registration failure without exposing raw Discord response data.
It also checks that `!diapers` delivers its ticket only by DM, falls back to
slash-command instructions when DMs are blocked, and ignores unrelated messages.

`scripts/check-diaper-browser.mjs` checks real Chrome navigation, rolls, reveals,
selling, bank buyback, filtering and logout at desktop/mobile sizes. See
[DIAPER_GACHA_GUIDE.md](DIAPER_GACHA_GUIDE.md) for tool variables and optional
fixture screenshots. Never use live coins or production account data in tests.
The Chrome check also exercises insufficient coins, unavailable balances,
paused rolls and pending payments, verifies that disabled controls explain the
reason without a waiting cursor, and injects request-ID preparation failures.
It checks the secure fallback when `crypto.randomUUID` is unavailable, immediate
prize display during a delayed balance refresh, and lost-payment recovery.

## Local checks

Use a separate checkout if a running Windows instance has its native SQLite
module loaded; Windows can prevent npm from replacing that file.

```bash
npm ci
npm test
bash -n scripts/deploy-fedora.sh
bash -n scripts/update-fedora.sh
bash scripts/deploy-fedora.sh --help
bash scripts/update-fedora.sh --help
```

The Node tests exercise GitHub activity fetching, empty completion handling,
multiple conversation turns, reopening SQLite, user isolation and continuing
legacy checkpoints. They use mocked HTTP and disposable databases and do not
log into Discord, require a model server or open the real memory database.
`test/fixtures/legacy-checkpoints.json` contains synthetic SQLite rows generated
with LangGraph 0.2.74 and SQLite saver 0.2.2, the combination that caused
`checkpoint.pending_sends is not iterable` on the second turn. A separate test
checks that migrating a nonempty pending-task queue preserves its contents.

Optional
static checks on Fedora: install `ShellCheck` and run
`shellcheck scripts/*-fedora.sh`, then run
`systemd-analyze verify scripts/mommybot.service` after deployment paths exist.

## Fedora acceptance checks

`test/linked-role.test.js` checks role delivery after committed confirmation,
retries for linked users, invalid confirmations, DM resolution, missing members
and permission failures without exposing Discord error bodies. Combined-login
tests verify the role waits for wallet activation and is not granted after a
failed exchange. On Discord, give the bot Manage Roles and place its role above
`1548848979754614857`; confirm a test account and verify the role, then check that
`/lidollid status` can deliver it to an already-linked member.

Online wallet coverage in `test/online-wallet.test.js` uses disposable SQLite
databases and a simulated Little Log API. It checks both fixed prices, private
balances, explicit consent/backoff, saved grants, account pinning, revocation,
concurrent clicks, missing funds, Momiji protection, party capacity, malformed
receipts, lost debit/refund responses, restart recovery and all adoption entry
points. These tests never spend live currency. Run
`node --test test/online-wallet.test.js` for the focused suite.
The same suite checks safe transport/proxy error messages and the token-free
`scripts/check-wallet.mjs` probe, including missing app registration.
It also checks production LAN HTTP configuration, public HTTPS approval URLs,
rejection of public HTTP API addresses and unexpected approval origins.
Aggregate socket failures, permission errors and cyclic exception causes must
produce bounded, allowlisted diagnostics without leaking nested error messages.

For a live acceptance check, follow [ONLINE_WALLET_GUIDE.md](ONLINE_WALLET_GUIDE.md)
to register the wallet app and approve a disposable account through one combined
LiD0llID login. Return its confirmation code to the initiating Discord account.
Check its balances in Little Log and Discord, adopt once with each currency,
then verify exactly one star and 25 coins were spent and two Touhous delivered.
Restart and confirm the wallet remains connected. Verify **Online balance** is
private even from a public prefix menu. Buy potions, use paid healing, win a
battle and perform a buyback; verify debits and rewards in Little Log. Sell a
Touhou between two disposable connected accounts and verify the buyer's debit,
seller's credit and ownership. Legacy local balances must stay unchanged. Do
not test failures by deleting journals or restoring one DB.

`test/online-economy.test.js` covers online potions, free/paid healing, buybacks,
battle payouts, admin permissions and player sales through real store/services,
slash handlers and menus. It verifies insufficient funds, price changes, party
ownership locks, storage failures, delayed/refused credits, lost debit/credit/
refund responses, account pinning and restart recovery. Wallet fixtures use
different balances and receipts for each participant. No tests spend live coins.

LiD0llID tests in `test/lidollid.test.js` use a disposable local OIDC HTTP
provider with real RSA-signed tokens. They verify state, nonce, PKCE, signatures,
issuer, audience, expiry, missing ID tokens, denied sign-in, UserInfo subjects,
discovery recovery, callback cookies, replay rejection, escaped profile text,
Discord-user binding, expiry, concurrent replacement, unique links, unlinking,
persistence and production configuration. Configuration tests also reject using the identity-provider origin
as the bot origin, including equivalent URLs with a default port/trailing slash.
This prevents bot `/auth/login` links from hitting the provider's resume route
when both settings name the same host. No real accounts or provider tokens
are used. Run `node --test test/lidollid.test.js` for focused verification.
The same tests check failure-stage attribution, discovery issuer mismatch,
redaction of arbitrary error data, retries after failed discovery, and the
read-only checker's exit codes/output using a disposable environment file.
Browser-start tests also cover repeated preview GETs, HEAD requests, blocked
cookies, CSRF cookie mismatch, cross-origin submissions, content types, body
limits, single-use POST and the existing signed OIDC callback checks.

For browser-header regressions, install `puppeteer-core` in a separate tooling
directory and use an installed Chrome/Chromium browser. Run from a development
checkout (this optional helper is not copied into production releases):

```bash
PUPPETEER_MODULE=/absolute/path/to/puppeteer-core/lib/puppeteer/puppeteer-core.js \
CHROME_PATH=/usr/bin/chromium \
node scripts/check-lidollid-browser.mjs
```

Use the actual module entry path for your installed puppeteer-core version and
a Node version supported by that tool. The check was verified with puppeteer-core
25.10.0, Node 24 and headless Chrome. It first reproduces the former
`no-referrer` policy's `Origin: null` / HTTP 403, then uses the production
`origin` policy and follows the form/provider/callback flow to Discord
confirmation. It asserts only the origin is sent as the form's Referer and no
Referer reaches the provider. This uses in-memory accounts and a local provider
stub; cryptographic OIDC validation remains covered by the Node tests. No real
Discord or LiD0llID accounts or existing browser profiles are used.

The browser check also verifies that CSP permits the bundled pastel stylesheet
and that login, error and confirmation pages fit 390px and 1280px viewports.
Set `AUTH_SCREENSHOT_DIR` to a disposable output folder to save screenshots of
those fixture pages for visual review. It captures no live accounts.

For live SSO acceptance, follow [LIDOLLID_GUIDE.md](LIDOLLID_GUIDE.md), register
the exact callback and configure the HTTPS proxy. With a test Discord user,
run login, authenticate, confirm the browser code, and check status after a bot
restart. Test an existing LiD0llID browser session, a fresh/private browser,
the Continue form in your supported browsers, repeated visits before Continue,
denied login, a code submitted by another Discord account, callback replay,
expired links, and unlinking while sign-in is pending. Check that replies are
ephemeral and login URLs do not appear in proxy logs. Verify the other bot
commands still work during an identity-provider outage. Live Discord/HTTPS/SSO
acceptance requires a registered client and has not been performed by the local
test suite.

`test/unlink-account.test.js` exercises the private status unlink button and
slash command using real disposable identity/wallet databases. It checks user
binding, wallet revocation, stale confirmation rejection, a fresh login after
unlink, identity-only cancellation, and preservation on pending payments or
revocation failure. No live accounts or balances are changed. For a manual reset,
follow [ACCOUNT_LINKING_GUIDE.md](ACCOUNT_LINKING_GUIDE.md); remove the awarded
role manually only when retesting role delivery from an absent role.

Touhou tests cover both payment methods, insufficient funds, duplicate actions,
rollback after an ownership-write failure, stock/party limits, gifts, consenting
swaps, stale/expired offers, sales, wallet persistence, guild isolation, admin
permissions, menu ownership and prefix/slash routing. They use local fixtures
and disposable databases, never real Discord balances.
Momiji tests also verify her fixed owner, blocked transfers and adoption,
database-level ownership enforcement, and repair of old ownership/listing/offer
records on startup.

Battle and menu tests also exercise attack/defend/run/potion turns, elemental
damage, duplicate rewards, payout rollback, EXP caps, healing costs, cooldowns,
idle expiry, persisted fight recovery, mid-battle transfer locks and Momiji's
battle eligibility. UI tests walk actual Discord builders through party details,
rarity selection, battle/resume, potion purchase, listing-price modals, gifts,
swaps, quote confirmation and buybacks. They check component size limits and
reject foreign users, stale controls and expired sessions.

For live trader acceptance, set `TOUHOU_CHANNEL_ID` to your test channel (the
production default is `1548647250543251507`). Verify trader commands and controls
work there and direct players back there from other channels, independently of
the chat `CHANNEL_ID`. Give the test account a star in Little Log and award 25
LiDollcoins through the bot, adopt once with each method, and check `/touhou wallet` and
`/touhou collection`. Try an award as a normal member, a button as another
player, and a trade accepted by its recipient. Confirm two rapid payment clicks
on the same menu buy only one character. Restart the service and verify the
wallet and collection persist. Check artwork rendering and paginated market
navigation in Discord. Follow [TOUHOU_TRADER_GUIDE.md](TOUHOU_TRADER_GUIDE.md).

Also walk **Battle → character → rarity**, try all three attacks, Defend, Potion
and Run, then verify EXP/coin rewards on victory. Buy potions, test free/paid
healing, and confirm a buyback quote. List through the price modal and buy with
another test account; try gifting and a recipient-confirmed swap entirely through
menus. Reopen the menu mid-fight to resume it, restart within 90 seconds to check
persistence, and let another fight expire to check recovery. Confirm artwork,
dropdowns and modals render correctly in the real Discord client.

Use a test bot/channel and a Fedora VM with systemd for deployment validation.

1. Follow [DEPLOYMENT_FEDORA.md](DEPLOYMENT_FEDORA.md). Confirm the first invocation
   creates settings without starting an unconfigured bot.
2. Configure the bot and deploy again. Confirm `systemctl is-active mommybot`
   and `systemctl is-enabled mommybot` succeed; check the journal for Discord login.
3. Mention the bot twice in the allowed channel and verify it reaches the
   configured model on both turns. Restart the service, then send a third message
   and check that conversation memory persists. Also retry with a user who
   already had saved history before the update.
4. Run the updater from a clean checkout with an upstream. Confirm the release
   symlink changes, settings remain unchanged, a state archive appears, and the
   existing memory/cursors remain available.
5. Verify dirty checkouts, detached HEADs and missing upstreams are rejected
   before deployment. Concurrent deployments should be refused by the lock.
6. On a disposable test branch, break the npm lockfile and confirm installation
   fails while the existing service stays running. Separately test a startup
   failure after installation; confirm the prior release and service return.
7. Test with SELinux enforcing, reboot and confirm the bot starts automatically.

Discord login is the deployment health check; model availability and complete
conversation behavior require the manual reply check. Rollback restores code
and the systemd unit, while preserving current runtime data.

## Combined identity and wallet regression checks

`test/combined-login.test.js` checks same-account renewal, different-account
rejection, Discord confirmation ownership, replaced callbacks, expired proof
cleanup, pending-purchase account pinning, interrupted balance responses and
concurrent login/confirmation. The existing OIDC and payment suites also run in
`npm test`. Legacy device approval ownership is retained as compatibility coverage.

The real-provider/browser integration lives in the sibling omo-trainer checkout
at `tests/combined-login-browser.mjs`. See that project's LIDOLLCOIN_API.md for
tooling settings. It starts temporary identity, wallet and bot callback servers,
approves a synthetic account, simulates a lost exchange response, confirms via
the Discord handler and exercises star access. It also checks consent denial.
It never logs into Discord or spends live currency.


## Web games and Touhou

Run `npm test` for signed game SSO callbacks, replay/unlink behavior, Touhou web ownership and membership, both adoption currencies, shared-state refresh, market forms, gifts, swaps, lost-payment recovery and HTTP origin/CSRF/session checks. Set `PUPPETEER_MODULE` and `CHROME_PATH`, then run `node scripts/check-touhou-browser.mjs` for real Chrome controls, artwork, battles, potions, listing dialogs, mobile layout and logout. `TOUHOU_SCREENSHOT_DIR` optionally captures screenshots. Fixtures use fake accounts and balances. See [GAMES_GUIDE.md](GAMES_GUIDE.md) for the production handoff check.

## Standalone PWA players

Run npm test. The signed OIDC game regression checks wallet consent scopes,
non-Discord sign-in, replay protection, mismatched wallet rejection and stable
web ownership after later Discord linking. game-accounts.test.js covers restart,
renames, issuer/subject isolation, session expiry and legacy unlink behavior.
The Touhou web suite exercises public adoption, gifts and swaps while retaining
private-server checks.

With PUPPETEER_MODULE and CHROME_PATH configured, run
node scripts/check-public-games-browser.mjs for standalone Touhou adoption,
battles, listing, mobile fit and logout. It uses in-memory databases, fake coins
and loopback HTTP; it never contacts Discord or spends a real balance.
