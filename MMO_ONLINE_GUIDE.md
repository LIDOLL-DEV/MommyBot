# LiDollMMO join announcements

MommyBot posts signed-in character arrivals to **#whos-online**
(`1550612967253352528`). Example: **Doll just joined LiDollMMO. Come say hello!**
The message uses the in-game character name and pings the server role named
**lidollmmo**. Other roles, users and everyone/here mentions are suppressed.
Guests, sign-in alone, cloud/companion reads and character creation do not count:
the authenticated character must enter the shared game world.

## Enable on both servers

Deploy both MommyBot and the updated `C:\Scripts\Lidollquest-server` checkout.
No GameMaker client rebuild is needed. Generate a dedicated shared secret:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

On **LiDollQuest server**, add this to its protected environment file:

```dotenv
MOMMYBOT_ONLINE_TOKEN=the-generated-secret
```

On **MommyBot**, add to `/etc/mommybot/mommybot.env`:

```dotenv
LIDOLLMMO_ONLINE_ENABLED=true
LIDOLLMMO_ONLINE_URL=http://127.0.0.1:4191/integrations/mommybot/joins
MOMMYBOT_ONLINE_TOKEN=the-same-generated-secret
LIDOLLMMO_ONLINE_CHANNEL_ID=1550612967253352528
```

The loopback URL works when both services run on the same machine. If the game
server is on `10.1.1.23`, use `http://10.1.1.23:4191/integrations/mommybot/joins`
instead and bind its `HOST` to that LAN interface; allow only MommyBot's host
through the firewall. The address must point to **LiDollQuest server**, not the
tracker gateway or MommyBot's port 4190. Explicit private IPv4 HTTP addresses
work without hairpin NAT; public addresses require HTTPS. Keep the shared secret
out of browsers, client builds and public URLs. Restart both services after setup.

MommyBot needs View Channel, Send Messages, Embed Links and Read Message History
in #whos-online. Posting is automatic once configured; no AI or wallet charge.
Create exactly one role named **lidollmmo** (case-insensitive). Make that role
mentionable, or give MommyBot Mention Everyone permission in #whos-online.
If the role is missing, ambiguous or cannot be pinged, the bot logs the specific
problem and retries; it does not silently send without the requested tag.

## Timing and recovery

- Polls every ten seconds, up to twenty arrivals per poll.
- A two-minute gap in account presence starts a new arrival; heartbeats, portal
  travel, character switches and shorter reconnects stay in the same session.
- First enable and a replaced game database start at future arrivals, avoiding
  an old-login announcement burst. Join **after** the first successful poll.
- Offline arrivals and events older than two minutes are skipped, so an outage
  does not later claim that absent players are online.
- MommyBot saves its progress in `data/mmo-online.db`. It reconciles uncertain
  sends against recent bot messages and retries with the same Discord nonce.
  Keep Read Message History permission for recovery. This reduces duplicates;
  it cannot provide an absolute exactly-once guarantee across Discord outages.
- The game database retains join events for seven days and per-account last-seen
  times. Its protected feed exposes only event IDs, character names, join times
  and online status. Gameplay commits and join records share a transaction.

To test, start both services with matching secrets, wait for the first poll,
then enter a shared zone with a signed-in account. Expect one announcement within
about ten seconds. A heartbeat or quick reconnect should not post another.
Check `[LiDollMMO]` logs for configuration, feed or Discord permission failures.

Automated: `node --test test/mmo-online.test.js` in MommyBot and
`node --test test/online-feed.test.mjs test/service.test.mjs` in LiDollQuest server.
Tests use disposable databases, simulated Discord and local HTTP only.
