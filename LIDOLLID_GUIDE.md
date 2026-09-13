# LiDollBot sign-in with LiD0llID

LiDollBot uses the same LiD0llID issuer and OpenID Connect contract as
`C:\Scripts\omo-trainer\server\login.mjs`. omo-trainer's documented default issuer
is `https://auth.sadgirlsclub.wtf`; existing deployments may still use
`https://auth.lidoll.dev`. Configure the actual deployed issuer rather than
assuming either hostname. Each application needs its own registered client
and exact callback URL. LiDollBot's default client ID is `lidollbot`.

## Player flow

1. Run `/lidollid login` in a server with the bot. Open the private sign-in link.
2. Sign in with LiD0llID. An existing LiD0llID browser session can complete SSO
   without another password prompt.
3. Check the username on the returned page. Copy its `/lidollid confirm code:…`
   command into Discord using the same Discord account that started sign-in.
4. Run `/lidollid status` to see the linked username and verification time.
   `/lidollid unlink` removes the link and cancels pending sign-ins.

All command replies are ephemeral. Links and codes expire ten minutes after
starting sign-in; opening a newer login invalidates the older attempt. If a link
is already used, cookies were blocked, the bot was unavailable, or the provider
denied sign-in, start again. The browser page never completes an account link by
itself. Do not share links or enter a confirmation code from another person.

One Discord account can link one LiD0llID; one LiD0llID can link one Discord
account in this bot, across all guilds. Unlink the original account before
switching. Usernames are display labels; the verified issuer and subject identify
the account. Existing Discord IDs continue to own memories, collections and
wallets. SSO does not grant Discord roles or administrator permissions.

This is account linking for a Discord application: Discord authenticates each
command, and LiD0llID authenticates the identity being linked. There is no public
account API or logged-in web dashboard. Links persist until unlinked; they are
not fresh proof that the identity-provider account is still enabled. Do not use
a stored link as authorization for sensitive provider operations without fresh
authentication. Unlinking does not log out the shared LiD0llID browser session
or other apps. There are no provider access/refresh tokens stored in the bot.

The trader's local stars and LiDollcoins remain local. omo-trainer's LiDollCoin
device-flow API is a separate wallet permission contract; SSO does not consent
to that API, migrate balances or connect the remote wallet.

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
