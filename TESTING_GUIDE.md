# Testing MommyBot

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
private even from a public prefix menu. Local market and battle balances must
remain separate. Do not test failures by deleting journals or restoring one DB.

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

For live trader acceptance, use a test server: award one star and 25 LiDollcoins
to a test user, adopt once with each method, and check `/touhou wallet` and
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
