# LiDollBot sign-in with LiD0llID

LiDollBot uses the same LiD0llID issuer and OpenID Connect contract as
`C:\Scripts\omo-trainer\server\login.mjs`. omo-trainer's documented default issuer
is `https://auth.sadgirlsclub.wtf`; existing deployments may still use
`https://auth.lidoll.dev`. Configure the actual deployed issuer rather than
assuming either hostname. Each application needs its own registered client
and exact callback URL. LiDollBot's default client ID is `lidollbot`.

## Player flow

The bot's landing, confirmation and error pages use the default pastel Little
Tracker theme from `lidoll.dev/tracker/`. Styles ship with the bot and require
no third-party asset requests or browser scripts. The separate LiD0llID
provider's password and consent screens are managed by the identity service.

Share [ACCOUNT_LINKING_GUIDE.md](ACCOUNT_LINKING_GUIDE.md) with Discord members
for the step-by-step login, unlink and testing walkthrough.

1. Run `/lidollid login` in a server with the bot. Open the private sign-in link
   and press **Continue with LiD0llID** in the browser.
2. Sign in with LiD0llID. An existing browser session avoids another password
   prompt. With online wallets enabled, review the coin/star permissions and
   press **Connect account and wallet** once.
3. Check the username on the returned page. Copy its `/lidollid confirm code:…`
   command into Discord using the same Discord account that started sign-in.
4. Successful confirmation awards role `1548848979754614857` in its server.
   Run `/lidollid status` to see the linked username and verification time and
   retry role delivery if needed. Already-linked members can use status too.
   `/lidollid unlink` or the **Unlink account** button on `/lidollid status`
   immediately removes the link and cancels pending sign-ins. Wallet access is
   revoked first; pending trader payments or a revocation failure keep the
   link intact for recovery. Both options operate only on the requesting user.

All command replies are ephemeral. Links and codes expire ten minutes after
starting sign-in; generating a newer `/lidollid login` invalidates the older
attempt. Opening or previewing the link does not consume it. The Continue form
requires a matching browser cookie and consumes the ticket once when starting
authorization. If a link
is already used, cookies were blocked, the bot was unavailable, or the provider
denied sign-in, start again. The browser page never completes an account link by
itself. Do not share links or enter a confirmation code from another person.

One Discord account can link one LiD0llID; one LiD0llID can link one Discord
account in this bot, across all guilds. Unlink the original account before
switching. Usernames are display labels; the verified issuer and subject identify
the account. Existing Discord IDs continue to own memories, collections and
wallets. The bot awards only the operator-configured linked-account role; OIDC
profile claims cannot select additional roles or grant administrator permissions.

`LIDOLLID_LINKED_ROLE_ID` defaults to `1548848979754614857`. Give the bot **Manage
Roles** and place its highest role above that role in Server Settings. Role
assignment runs after the identity (and wallet, when enabled) is committed.
Missing permissions or Discord outages leave the account linked and provide a
`/lidollid status` retry instruction. No role is granted for starting login or
an invalid confirmation. A DM confirmation can locate the role in a server the
bot belongs to; the user must also be a member there. This is an award on linking,
not continuous membership verification: unlinking does not remove an awarded role.

This is account linking for a Discord application: Discord authenticates each
command, and LiD0llID authenticates the identity being linked. There is no public
account API or logged-in web dashboard. Links persist until unlinked; they are
not fresh proof that the identity-provider account is still enabled. Do not use
a stored link as authorization for sensitive provider operations without fresh
authentication. Unlinking does not log out the shared LiD0llID browser session
or other apps. Identity-only login discards provider tokens. Combined login
briefly stages its access token in the protected wallet database for exchange.
No refresh tokens are requested.

Enable the Little Log integration using [ONLINE_WALLET_GUIDE.md](ONLINE_WALLET_GUIDE.md).
Then login requests explicit wallet consent in the same LiD0llID interaction.
The existing Discord confirmation activates both the identity and matching wallet.
Already linked users can login again to add/renew wallet access on that same
account. `/lidollid wallet connect` is an alias for the combined flow.

The OIDC access token is stored only until exchange or the ten-minute attempt
expires, in `data/online-wallet.db`. The wallet server verifies it directly with
LiD0llID and issues a separate revocable 30-day grant. Wallet tokens and exchange
recovery state remain in that protected database. Identity and wallet bindings
use the verified issuer/subject; usernames cannot select a wallet. Unlink revokes
wallet access first and requires pending purchases and payouts to finish.
The connected wallet funds the whole Touhou trader: adoption accepts one star
or 25 LiDollcoins, and all other currency payments and rewards use online
LiDollcoins. Use `/lidollid wallet retry` for delayed rewards, sales or refunds.

## Register and enable

Choose a dedicated HTTPS hostname for this bot, for example `bot.example.com`.
The following hostname is a placeholder, not an already provisioned service.

On the identity host, from the deployed omo-trainer directory, run its existing
administrator tool as the identity service user with access to its environment:

```bash
node --env-file=/etc/lidoll/auth.env scripts/auth-admin.mjs add-client lidollbot https://bot.example.com/auth/callback
```

Restart the LiD0llID identity service to load the registration. If `lidollbot`
already exists, update its existing `redirect_uris` instead of adding a duplicate.
The required registration has `response_types: ["code"]`,
`grant_types: ["authorization_code"]`, and `token_endpoint_auth_method: "none"`.
No client secret is needed. Do not reuse Little Log's client ID.

Set these values in `/etc/mommybot/mommybot.env` on Fedora, or `.env` locally:

```dotenv
LIDOLLID_ENABLED=true
LIDOLLID_ISSUER=https://auth.sadgirlsclub.wtf
LIDOLLID_CLIENT_ID=lidollbot
LIDOLLID_PUBLIC_ORIGIN=https://bot.example.com
LIDOLLID_HOST=127.0.0.1
LIDOLLID_PORT=4190
```

The public origin must contain no path, query, credentials or fragment. The
public origin must also differ from the issuer origin: these are separate
services with overlapping `/auth` routes. The callback is always `/auth/callback`.
Production requires HTTPS for both public
origin and issuer. Local development permits HTTP only on loopback hostnames;
register the corresponding exact local callback as a separate development
client. Use Node.js 22 or newer, as required by the existing Fedora deployer.

Run the existing deployment/update script after the registration and proxy are
ready. Existing deployments keep their environment file, so add the settings
explicitly; updating code does not enable SSO by itself. Invalid production SSO
settings fail deployment before the current service stops. Listener bind errors
fail startup before the Discord-ready message. Discovery is lazy and retries
after an outage, allowing ordinary bot commands to keep working when LiD0llID
is unavailable.

## Reverse proxy

On an existing nginx HTTPS virtual host for the dedicated bot hostname, with
your certificate configured, add:

```nginx
location / {
    proxy_pass http://127.0.0.1:4190;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_read_timeout 60s;
    access_log off;
}
```

This upstream assumes nginx runs on the bot host. For a separate proxy machine,
bind `LIDOLLID_HOST` to the bot's private LAN address, point `proxy_pass` at that
address, and permit port 4190 only from the proxy through the host firewall.
Do not expose the plain HTTP listener directly to the internet. Fedora SELinux
must allow the nginx proxy's upstream connection under your existing policy.
DNS, TLS certificates, firewall rules and nginx configuration are operator setup;
the bot deployment script does not alter them.

Disable or redact query strings in any proxy/CDN logs for these routes: login
URLs carry short-lived private tickets and callbacks carry authorization codes.
Do not cache responses. The app uses the configured public origin rather than
untrusted Host/forwarded headers. HTTPS login cookies are host-only,
`__Host-` prefixed, Secure, HttpOnly and SameSite=Lax. Use a top-level browser tab;
embedding sign-in in an iframe is blocked.

## Storage and maintenance

### Provider reports "authorization request has expired"

If the error appears immediately at `https://auth.lidoll.dev/auth/login?ticket=…`,
the bot's link has reached the identity service instead of the bot. The identity
provider interprets `/auth/login` as its `/auth/:uid` resume route, with `login`
as the identifier, and expects a provider resume cookie that this bot link never
created. This is an origin/proxy routing error, not a slow sign-in.

Keep the deployed issuer in `LIDOLLID_ISSUER` (for this example,
`https://auth.lidoll.dev`). Give LiDollBot its own HTTPS hostname, such as
`bot.example.com`, set `LIDOLLID_PUBLIC_ORIGIN=https://bot.example.com`, and
proxy that hostname to the bot's port 4190 listener using the configuration above.
Register `https://bot.example.com/auth/callback` on the `lidollbot` client,
restart the affected services, then run a fresh `/lidollid login`. Existing
Discord messages retain the incorrect URL. Do not send the bot's routes to the
identity service on port 4180. The app now rejects identical public/issuer
origins at startup and during Fedora deployment; proxy aliases that route two
different hostnames to the same service still require operator verification.

Opening the bot origin's `/` should show **LiDollBot · LiD0llID** and instructions
to run `/lidollid login`. Confirm this before retrying Discord. A provider error
page there means the proxy still reaches the wrong service. The bot hostname is
a placeholder until DNS, TLS and the proxy are provisioned.

In oidc-provider 9.12.2 this exact message means the authorization resume route
could not read a valid signed resume cookie. It does not by itself establish
that the interaction timer expired. The cookie may be absent, expired, blocked,
already cleared by a completed flow, or have a missing/invalid signature. See
the provider's [resume handler](https://github.com/panva/node-oidc-provider/blob/v9.12.2/lib/actions/authorization/resume.js).

Close the failed tab, run a new `/lidollid login`, and complete the entire flow
in one browser. If moving from Discord's embedded browser to another browser,
start again there with a fresh login link; do not copy an in-progress interaction
or resume URL. Reloading a completed resume URL cannot restart authorization.

If a fresh attempt fails immediately, compare the hostname on the password page
and the hostname after submission. Changing between `auth.lidoll.dev` and
`auth.sadgirlsclub.wtf` can lose host-only cookies. The bot's `LIDOLLID_ISSUER`,
the identity service's `AUTH_ISSUER`, public discovery metadata and proxy routing
must describe the intended deployment consistently. An `iss` field in an error
is a diagnostic clue, not authorization to trust a new issuer or migrate links.
Do not switch issuers automatically or widen cookies to a shared parent domain.

Check the identity proxy forwards both Cookie requests and all Set-Cookie
responses, preserves URL paths, does not cache authorization responses, and
uses the correct public Host and HTTPS scheme. If requests reach multiple
identity workers, their persistent cookie-signing keys and identity storage must
be consistent. Inspect cookie names/attributes in browser developer tools without
sharing values, full sign-in URLs, passwords or tokens. Increasing the bot's
ten-minute lifetime does not restore a missing provider cookie.

### A newly generated link is invalid on its first click

Older code consumed a login ticket on the first GET request, so a preview or
automatic link check could use it before the user's browser. Updated code first
renders a **Continue with LiD0llID** form. GET/HEAD cannot start authorization;
the same-origin POST requires its matching HttpOnly cookie before consuming the
ticket. A missing cookie produces a specific browser message and leaves the
ticket usable. Reopening the landing page allows another attempt while the
ticket is valid; generating a newer Discord link replaces the old attempt.

Deploy the updated bot, then use a fresh `/lidollid login`. If a new link still
fails before the Continue button appears, check that the Discord command and
nginx reach the same bot installation and persistent `data/lidollid.db`.
Two bot instances with separate databases can issue a ticket on one instance
while the browser reaches the other. Verify the bot hostname's nginx upstream
and stop unintended duplicate bot instances. Normal Fedora restarts preserve
unexpired tickets in the shared data directory; tickets are not held only in RAM.

### Continue is rejected before reaching LiD0llID

The original Continue page inherited `Referrer-Policy: no-referrer`, which can
make a browser's form submission send `Origin: null`. The strict origin check
then rejected the bot's own form with "Open your Discord sign-in link and use
its Continue button." This was an application bug, reproduced in headless Chrome.

The landing page now uses `Referrer-Policy: origin`, preserving the POST Origin
while stripping the private ticket path/query from Referer. Redirects and
callback pages still use `no-referrer`. Null, missing and foreign origins remain
rejected, as do missing or mismatched CSRF cookies. Do not remove those checks
or make nginx manufacture an Origin header.

Deploy the fix, reopen the latest unused login link to load the corrected page,
and press Continue. If it persists, the page/journal now identifies `ORIGIN_NULL`,
`ORIGIN_MISSING` or `ORIGIN_MISMATCH` without logging header values. Ensure nginx
or another proxy is not overriding the landing page's policy with `no-referrer`,
and verify the browser origin matches `LIDOLLID_PUBLIC_ORIGIN` exactly. This
behavior follows the [Fetch Standard's Origin-header rules](https://fetch.spec.whatwg.org/#append-a-request-origin-header).

### Bot displays "Sign-in could not be completed"

The bot page means the browser has reached LiDollBot. A failure on `/auth/login`
after pressing Continue occurs before redirecting to the provider: investigate
discovery/authorization URL construction and local attempt storage first.
Client callback registration
is checked later by the provider. A failure on `/auth/callback` instead concerns
callback processing, code exchange, profile retrieval or staging the account link.

Updated releases include a read-only discovery checker. On the Fedora bot host:

```bash
sudo -u mommybot env NODE_ENV=production /usr/bin/node \
  /opt/mommybot/current/scripts/check-lidollid.mjs \
  /etc/mommybot/mommybot.env
```

Run this after deploying a release that includes the checker. In a development
checkout, use `node scripts/check-lidollid.mjs PATH_TO_ENV`. It prints only the
Node version, public issuer/origin, client ID, callback and allowlisted failure
codes. It uses the bot's OIDC library to retrieve and validate public discovery
metadata. It does not open account databases, start a login, validate client
registration or exchange a code. A successful check leaves those later steps
for normal browser acceptance.

Both the browser error page and service journal now identify the failed stage:
`discovery`, `authorization`, `token`, `userinfo` or local `storage` (with
`login`/`callback` as fallbacks). Error output contains only allowlisted codes and
numeric HTTP statuses; raw exception messages, URLs, cookies, provider response
bodies and tokens are excluded. Share the displayed reference or checker output.

* `discovery: ISSUER_MISMATCH`: metadata reports an issuer different from
  `LIDOLLID_ISSUER`. Confirm the intended live provider and correct its routing or
  configuration; do not migrate account links automatically.
* `ENOTFOUND` / `EAI_AGAIN`: hostname resolution failed on the bot host.
* `ECONNREFUSED`, `ETIMEDOUT` or `REQUEST_TIMEOUT`: check the provider proxy,
  outbound reachability and any LAN/router loopback routing.
* Certificate codes such as `CERT_HAS_EXPIRED` or
  `UNABLE_TO_VERIFY_LEAF_SIGNATURE`: correct the certificate chain/trust setup.
* `OAUTH_RESPONSE_IS_NOT_JSON` / `OAUTH_RESPONSE_IS_NOT_CONFORM`: inspect the public
  discovery endpoint; nginx may be returning HTML, a redirect or an error.

For initial diagnosis on an older release, check only the public issuer setting
and its discovery response; do not paste the entire environment file:

```bash
sudo grep '^LIDOLLID_ISSUER=' /etc/mommybot/mommybot.env
curl --max-time 15 --fail --show-error https://auth.lidoll.dev/.well-known/openid-configuration
```

The URL above matches the issuer reported during this deployment's troubleshooting;
use the intended configured issuer if it differs. Check that discovery's `issuer`
matches exactly. Do not add `-k` or disable issuer/signature validation.

### Backups and lifecycle

`data/lidollid.db` stores links and temporary login attempts, separately from
conversation memory and trading data. In Fedora this resolves to
`/var/lib/mommybot/data/lidollid.db` and is included in existing stopped-state
backups. Protect backups as private account data. Tickets, browser cookies and
confirmation codes are stored hashed. PKCE verifier/state/nonce live server-side
only until callback consumption or expiry. Expired attempts are pruned every
minute and on use.

Schema creation is additive in a new database. Rolling back to pre-SSO code leaves
this file unused; no memory or trader schema restore is needed for this change.
Restoring an old identity database restores its historical links, including links
subsequently removed, so use the normal stopped-service backup procedure.
Set `LIDOLLID_ENABLED=false` and restart to disable the listener. Previously
registered Discord commands may remain visible but will no longer be handled.

Implementation uses pinned `openid-client` 6.8.8, matching omo-trainer, with
authorization code + PKCE S256, state, nonce, ID-token signature checks and
subject-checked UserInfo. See the library's
[API reference](https://github.com/panva/openid-client/blob/main/docs/README.md)
and omo-trainer's `AUTH_GUIDE.md` for the underlying contract.
