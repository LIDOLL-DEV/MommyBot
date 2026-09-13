# Little Log stars and LiDollcoins

LiDollBot can display your existing Little Log balance and use **either 1 star
or 25 LiDollcoins** for a random Touhou adoption. Each adoption charges only the
selected currency. Signing in with LiD0llID links an identity; wallet permission
is a separate approval and app registration.

## Operator setup

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
   cap issuance; this bot uses only debits and refunds. Little Log must run the
   version supporting `stars:read`, `stars:write` and `asset: "stars"`.

2. In `/etc/mommybot/mommybot.env` on Fedora (or `.env` locally), set:

   ```dotenv
   LIDOLLID_ENABLED=true
   LIDOLLID_ISSUER=https://auth.lidoll.dev
   LIDOLLCOIN_ENABLED=true
   LIDOLLCOIN_API_URL=https://lidoll.dev/tracker/api/lidollcoin/v1/
   LIDOLLCOIN_CLIENT_ID=lidollbot
   TOUHOU_ENABLED=true
   ```

   Keep the existing bot public origin and callback registration. The wallet
   URL points to Little Log's API, not `auth.lidoll.dev` or `bot.lidoll.dev`.
   It must end with `/`; production requires HTTPS. There is no wallet client
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

1. Link your identity with `/lidollid login` and finish `/lidollid confirm` if
   you have not already done so.
2. Run `/lidollid wallet connect`. Open the Little Log page in the private reply,
   enter the displayed code, and approve **LiDollBot** to read and spend both
   stars and coins. Sign into the Little Log account whose balance you want to
   use. This API returns an opaque wallet ID, so the bot cannot compare the
   approved wallet's username with your identity profile.
3. Return to Discord and press **Check approval**. Wait a few seconds between
   checks. Approval codes expire after ten minutes.
4. Use `/lidollid wallet balance`, `/touhou wallet`, or the menu's **Online
   balance** button. Both balances are fetched fresh and shown only to you.
5. Open `/touhou menu` and choose **Adopt · 1 star** or **Adopt · 25 LiDollcoins**.
   Slash adoption and `!touhou adopt star` / `!touhou adopt coins` use the same
   wallet. An unavailable wallet never falls back to local funds.

Wallet grants expire after 30 days or when revoked. Use connect again to renew.
`/lidollid wallet disconnect` revokes wallet access; balances stay in Little Log.
With the integration enabled, `/lidollid unlink` also disconnects the wallet.
You can revoke access through Little Log's connected-games settings as well.

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

## Local economy and storage

Online adoption does not migrate or duplicate local currency. Market listings,
potions, healing, administrator awards, battle rewards and buybacks continue
using the per-server local wallet. Menus label this distinction. Turning off
`LIDOLLCOIN_ENABLED` restores local adoption, but keeps pending reservations
blocked until the online integration is re-enabled and payments are settled.

`data/online-wallet.db` stores sensitive wallet grants and approval attempts;
`data/touhou-trader.db` stores the payment journal alongside ownership. Fedora's
existing protected data directory and stopped-state backups cover both. Keep
backups private, and never delete a payment journal or restore only one database.
An external wallet cannot roll back with a local backup; restoring older game
state after a completed purchase requires operator reconciliation against the
Little Log ledger. Do not downgrade to code without reservation support while
payments are pending. Revocation through Little Log remains available if the
bot integration is disabled.

The offline test suite exercises API-shaped fixtures. Live registration,
consent, balances and Fedora deployment require the operator setup above.
