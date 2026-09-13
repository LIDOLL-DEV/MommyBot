# LiDollBot sign-in with LiD0llID

LiDollBot uses the same LiD0llID issuer and OpenID Connect contract as
`C:\Scripts\omo-trainer\server\login.mjs`. The production issuer is
`https://auth.sadgirlsclub.wtf`. Each application needs its own registered client
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
callback is always `/auth/callback`. Production requires HTTPS for both public
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
