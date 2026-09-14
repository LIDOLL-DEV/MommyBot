# Little Log stars and LiDollcoins

LiDollBot can display your existing Little Log balance and use **either 1 star
or 25 LiDollcoins** for a random Touhou adoption. Each adoption charges only the
selected currency. With online wallets enabled, `/lidollid login` connects the
account and its wallet through one LiD0llID approval and the existing Discord
confirmation. `/lidollid wallet connect` starts that same flow. Identity and
wallet app registrations remain separate operator settings.

With online wallets enabled, **all trader payments and rewards use Little Log**.
Adoption keeps the choice of 1 star or 25 LiDollcoins. Potions, instant healing,
player sales, buybacks, battle rewards and administrator awards use online
LiDollcoins. Gifts, swaps, listing/delisting, browsing and free recovery keep
their existing zero cost. Legacy local balances are not spent or automatically
converted into online currency.

[Diaper Atelier](DIAPER_GACHA_GUIDE.md) uses the same consented coin wallet for
three-coin rolls and its shared bank. Bank quotes decrease as more copies of a
design enter bank inventory, with rarity setting the starting value. Its pending
payments participate in the same reconnect/unlink guards and can be recovered
with `/lidollid wallet retry`. No star balance is spent by this game.

## Administrator gifts

Use these commands in your Discord server after deploying and restarting the bot:

```text
/lidollid wallet gift user:@Someone currency:coins amount:100
/lidollid wallet gift user:@Someone currency:stars amount:5
```

Only members with **Manage Server** (including Administrator) or the role in
`TOUHOU_ADMIN_ROLE_ID` can give rewards. Both commands credit the recipient's
online Little Log wallet; they do not debit the administrator or change a local
game balance. The administrator does not need a connected wallet. The recipient
must finish `/lidollid login` and connect their wallet first. Amounts must be
whole numbers from 1 to 1,000,000; bot recipients are rejected. Command replies
are private and do not show the recipient's total balance or send them a DM.
Recipients can check `/lidollid wallet balance` to see the result.

If confirmation is pending, use:

```text
/lidollid wallet gift-retry user:@Someone
```

An administrator in the original server can retry the saved gift. The recipient
can also use `/lidollid wallet retry`. Recovery keeps the original recipient,
currency, amount and payment ID, including after restarts. Do not issue a new gift
to replace an uncertain one: a new command after completion creates another reward.
Pending gifts block other wallet transactions and unlinking until settled.
Little Log's existing per-recipient app limits apply: `dailyLimit` for coins and
`starDailyLimit` for stars. A capped gift stays pending for retry when permitted.

The bot registers these subcommands at startup; no Discord Developer Portal
changes are needed. Existing `/touhou award` continues to award coins only.

## Operator setup

Deploy the updated **omo-trainer identity and tracker services first**, then
MommyBot. This release requires the identity `/wallet/identity` endpoint and
the tracker `/tracker/api/lidollcoin/v1/exchange` endpoint. Back up both projects
using their stopped-service procedures; market schema 6 adds exchange receipts.
Do not run an older tracker against the upgraded market database.

The existing `lidollbot` PKCE registration needs no secret or callback changes.
With no explicit `scope` override, the updated identity service enables the
four wallet scopes for this client. If `clients.json` already restricts its
`scope`, include `openid profile wallet:read wallet:write stars:read stars:write`.
Restart `lidoll-auth` after deploying the identity update.

For Doll's LAN, set this in `/etc/lidoll/tracker.env` so the tracker can verify
login tokens without routing through the public IP:

```dotenv
LIDOLLCOIN_IDENTITY_URL=http://10.1.1.23:4180/wallet/identity
```

Keep `OIDC_ISSUER` equal to the existing public identity issuer. The setting above
changes only the back-channel transport, not account identity. Without it, the
tracker calls the issuer's public `/wallet/identity` URL.

1. On the **Little Log / omo-trainer backend**, add this entry to the existing
   `LIDOLLCOIN_APPS` JSON array in its service environment:

   ```json
   {"id":"lidollbot","name":"LiDollBot","origins":[],"dailyLimit":1000000,"starDailyLimit":1000000}
   ```

   Preserve all existing entries, especially `lidollquest`. If the setting is
   currently absent and you use Little Log's default registration, the complete
   replacement value preserving that default is:

   ```text
   LIDOLLCOIN_APPS=[{"id":"lidollquest","name":"LiDollQuest","origins":[],"dailyLimit":1000000},{"id":"lidollbot","name":"LiDollBot","origins":[],"dailyLimit":1000000,"starDailyLimit":1000000}]
   ```

   The standard omo-trainer Fedora deployment uses `/etc/lidoll/tracker.env`.
   After editing it, run `sudo systemctl restart lidoll-tracker` and check
   `sudo systemctl status lidoll-tracker --no-pager`. If your installation uses
   custom paths, edit its actual environment file instead. The earlier
   `auth-admin.mjs add-client` command registers identity login only. The empty
   origins list is appropriate for this server-to-server client. Daily limits
   cap issuance, including battle rewards, buybacks, admin awards and seller
   credits. A capped payout remains queued until the limit permits it; retries
   do not bypass the cap. Little Log must run the
   version supporting `stars:read`, `stars:write` and `asset: "stars"`.

2. In `/etc/mommybot/mommybot.env` on Fedora (or `.env` locally), set:

   ```dotenv
   LIDOLLID_ENABLED=true
   LIDOLLID_ISSUER=https://auth.lidoll.dev
   LIDOLLID_CLIENT_ID=lidollbot
   LIDOLLCOIN_ENABLED=true
   LIDOLLCOIN_API_URL=https://lidoll.dev/tracker/api/lidollcoin/v1/
   LIDOLLCOIN_PUBLIC_ORIGIN=https://lidoll.dev
   LIDOLLCOIN_CLIENT_ID=lidollbot
   TOUHOU_ENABLED=true
   ```

   Both client IDs must be `lidollbot`. Keep the existing public issuer, bot
   public origin and callback registration. The wallet
   URL points to Little Log's API, not `auth.lidoll.dev` or `bot.lidoll.dev`.
   It must end with `/`; public API addresses require HTTPS. There is no wallet client
   secret. Existing Nginx callbacks need no additional routes for this feature.

3. Deploy the updated code. Once these changes are committed and pushed to the
   branch your Fedora checkout follows:

   ```bash
   cd ~/MommyBot
   bash scripts/update-fedora.sh
   ```

   For a checkout that already contains the new code, the deployer can stage it
   directly with `sudo bash scripts/deploy-fedora.sh --update`. This command
   does not fetch changes. Startup registers the new `/lidollid wallet` commands.

## Player steps

1. Run `/lidollid login` (or `/lidollid wallet connect`). Open the private
   link and press **Continue with LiD0llID**.
2. Sign in, review the coin and star permissions, and press **Connect account
   and wallet**. Cancel leaves the existing connection unchanged.
3. Return the displayed `/lidollid confirm code:...` command to the same Discord
   account that started login. This connects both; there is no second wallet
   page, device code or Check approval button. The confirmation prevents another
   person from binding their browser account to your Discord account.
4. Use `/lidollid wallet balance`, `/touhou wallet`, or **Online balance** to
   privately see fresh balances. Adoption still costs either 1 star or 25 coins.

Already linked users run login again with **the same LiD0llID account** to add or
renew wallet access, without unlinking. The bot verifies the wallet's issuer and
subject against that exact identity. An older, separately approved wallet on a
different account can be replaced only after its pending purchases are settled.

Wallet grants expire after 30 days or when revoked. Run login again to renew.
`/lidollid wallet disconnect` revokes wallet access; balances stay in Little Log.
`/lidollid unlink` also disconnects the wallet. Little Log's connected-games
settings can revoke access. Old Check approval buttons instruct users to login.
If confirmation is interrupted, retry the same confirmation command while it
is valid; the exchange reuses its grant instead of creating duplicate access.

## Connection troubleshooting

Run this read-only check using the deployed Node runtime and bot configuration:

```bash
cd /opt/mommybot/current
sudo -u mommybot /usr/bin/node scripts/check-wallet.mjs /etc/mommybot/mommybot.env
```

It prints only the configured API URL/client ID and a safe result. It sends no
token and creates no approval codes. `invalid_client` means the running Little
Log backend has not loaded that wallet app registration. A JSON `invalid_token`
response to this token-free probe means the route is reachable and recognizes
the app; player consent is still required.

The updated bot distinguishes DNS/TLS failures, redirects and non-JSON responses.
It also inspects Node's aggregate connection errors: `ECONNREFUSED` indicates a
refused connection, `ETIMEDOUT` an unanswered connection, and `EACCES`/`EPERM` a
permission denial. Compare the checker's printed `api` with the intended LAN
URL. A shell curl success alone does not verify the bot's URL, runtime or service
permissions. If the service-user checker succeeds but Discord still fails,
compare the running service's configuration and restrictions before changing
firewall or SELinux policy.
For the direct backend on port 4173, the API scheme is **http**, not **https**.
Sending TLS to this plain HTTP listener can produce `ERR_SSL_WRONG_VERSION_NUMBER`
or `EPROTO` (shown as `NETWORK_ERROR` by older diagnostics). The browser approval
origin still uses HTTPS; these are separate settings.
HTTP 502 HTML usually comes from a proxy that cannot reach its backend. HTTP 200
HTML suggests a static page or sign-in page intercepted the API route. Ensure
`/tracker/api/` proxies to Little Log while preserving its complete path.

If the endpoint works externally but times out on the bot host, compare
`getent ahosts lidoll.dev` and IPv4/IPv6 connectivity there. Possible causes
include DNS pointing to an unreachable address, outbound firewall rules or a
router unable to route internal requests back through its public address.
Confirm the actual Nginx LAN address before changing DNS. An internal DNS entry
can route `lidoll.dev` to that address while preserving the HTTPS hostname and
certificate checks.

For Doll's direct LAN backend, deploy the updated bot and set these values in
`/etc/mommybot/mommybot.env`:

```dotenv
LIDOLLCOIN_API_URL=http://10.1.1.23:4173/tracker/api/lidollcoin/v1/
LIDOLLCOIN_PUBLIC_ORIGIN=https://lidoll.dev
```

This deliberately uses HTTP on the operator's trusted LAN for server-to-server
wallet requests, including bearer credentials. HTTP is accepted only for literal
private IPv4 or loopback destinations; public endpoints still require HTTPS.
The combined browser approval uses the public LiD0llID issuer; legacy device
approval remains at `https://lidoll.dev/tracker/coins/`. The backend's
`PUBLIC_ORIGIN` in `/etc/lidoll/tracker.env` must also be `https://lidoll.dev` so it
returns that browser URL. Keep the bot's existing LiD0llID issuer and callback
settings. Run the wallet checker after deployment. `invalid_client` still means
the separate wallet app must be added to `LIDOLLCOIN_APPS` and the tracker restarted.

## Interrupted purchases

Use `/lidollid wallet retry` after a timeout, bot restart or pending-payment
message. A saved request reserves a Touhou and pins the account, price and
currency before sending the debit. Recovery repeats that exact request and
delivers only after confirmation. If delivery became impossible (for example,
a gift filled the party), the bot refunds the full original payment. A lost
refund response is also safe to retry. The retry command reports the server
where the original purchase began; it never moves it to a different server.

A pending purchase blocks new adoptions and disconnecting. If your token
expired, reconnect **the same Little Log wallet**, then retry. A different
account cannot settle that payment. A definitive initial payment refusal
releases the reservation; a payment whose earlier outcome is uncertain stays
pending until its original operation can be confirmed. Do not change API URL
or client ID while payments are pending. Run one bot process per data directory.

Potions and paid healing use the same confirmation rule: no item or healing
is delivered on an uncertain debit. Price, inventory and ownership changes
that prevent delivery cause an idempotent full refund. A database write failure
keeps the confirmed payment for later delivery rather than guessing a result.

Battle victories commit the turn, EXP and a saved coin payout together. A wallet
outage cannot reroll the winning turn. Buybacks commit character removal and
the owed payout together. If a credit is delayed, the bot says the game action
completed and the payout is waiting. The battle screen shows whether its payout
is waiting or paid. Use `/lidollid wallet retry` or **Retry pending payment** in
the trader menu; the original request ID prevents duplicate credits.

Player sales require both players to have a connected wallet when the purchase
starts. The buyer is debited first; confirmed delivery atomically transfers the
Touhou and records the seller's owed credit. Little Log provides separate debit
and credit operations, so seller payment can be delayed by a token expiry,
revocation, outage or credit limit. Either participant can retry settlement; an
expired seller grant must be renewed by that seller using the same account.
Both accounts remain pinned while payment is pending. The seller cannot gift,
reprice or battle the reserved Touhou during the buyer's debit. Once delivered,
the bot retries the owed seller credit rather than refunding a delivered item.

## Currency storage and upgrades

The existing online-wallet configuration enables the whole trader economy;
no additional environment flag, scope or backend endpoint is needed for this
change. Existing connected accounts can use it after the bot update. Admin
awards retain Manage Server / configured-role checks and now award coins only.
Old menus or commands requesting a star award are rejected.

Disabling `LIDOLLCOIN_ENABLED` retains the legacy local economy for standalone
installations. Pending online transactions and reserved characters remain
blocked until the online integration is re-enabled and payments are settled.
This mode does not migrate, merge or convert balances in either direction.

`data/online-wallet.db` stores sensitive wallet grants and approval attempts;
`data/touhou-trader.db` stores adoption payments and the new `online_economy`,
`online_economy_payments` and `online_economy_locks` tables alongside ownership.
The new tables are added automatically without rewriting old receipts. Fedora's
existing protected data directory and stopped-state backups cover both. Keep
backups private, and never delete a payment journal or restore only one database.
An external wallet cannot roll back with a local backup; restoring older game
state after a completed purchase requires operator reconciliation against the
Little Log ledger. Do not downgrade to code without reservation support while
payments are pending. Revocation through Little Log remains available if the
bot integration is disabled.

The offline test suite exercises API-shaped fixtures. Live registration,
consent, balances and Fedora deployment require the operator setup above.
