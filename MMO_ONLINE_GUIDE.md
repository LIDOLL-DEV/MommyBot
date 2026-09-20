# LiDollMMO join announcements

MommyBot posts signed-in character arrivals to **#whos-online**
(`1550612967253352528`). Example: **Doll just joined LiDollMMO. Come say hello!**
The message uses the in-game character name and pings the server role named
**lidollmmo**. Other roles, users and everyone/here mentions are suppressed.
Every announcement includes a **Play LiDollMMO** link to https://lidoll.dev/.
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

## Character showcase (`/lidollmmo`)

Members run **`/lidollmmo`** to post their LiDollQuest character into a channel
the server has chosen. MommyBot posts three separate messages, in this order:

1. **Paperdoll** - the character's appearance, with the game's rendered image
   attached when the game server supplies one.
2. **Stats** - level, class, online state, embarrassment and accident state.
3. **Equipment** - all sixteen gear slots, empty ones included.

The command's own reply is private; only the three character messages are public,
so other people can see the character without the member's lookup being visible.
`/lidollmmo character:<name or id>` picks a specific character; the reply lists a
member's other characters. Each member may showcase once a minute.

Character IDs are tried directly. Names are resolved from the linked account's
returned character list (up to 25 entries), preferring an exact match and then a
unique case-insensitive match. Duplicate names require an ID; private showcase
replies include IDs alongside the available characters.

If a character is unavailable, run `/lidollmmo` without a selection and check
that the game uses the same LiD0llID as `/lidollid login`. An unavailable character
does not necessarily mean you need to create another: account access can also
prevent lookup. A generic HTTP 404 instead reports an endpoint problem; check
`LIDOLLMMO_CHARACTER_URL` and deploy the game server's character route.

Members need a LiD0llID account connected with `/lidollid login`: MommyBot maps
the Discord user to their wallet `account_id`, which is the key LiDollQuest owns
characters by. Nothing is posted for an unlinked member.

### Enable it

On **LiDollQuest server**, no new setting is needed: the character endpoint
reuses the existing `MOMMYBOT_ONLINE_TOKEN`. Deploy a build that includes
`server/mommybot-profile.mjs`.

On **MommyBot**, add:

```
LIDOLLMMO_CHARACTERS_ENABLED=true
```

The endpoint URL is derived from `LIDOLLMMO_ONLINE_URL` by replacing the trailing
`/joins` with `/character`. Override it with `LIDOLLMMO_CHARACTER_URL` only if the
two endpoints are served from different addresses.

Then, in the admin panel, enable **Character showcase** and choose its channel.
MommyBot needs Send Messages, Embed Links and Attach Files there.

### What the endpoint exposes

`GET /integrations/mommybot/character?account_id=...` returns the same public
inspection sheet another player can already see in-world: name, level, class,
appearance fields and equipped item names, plus that owner's character list and
online state. It never returns the account ID, wallet grants, coins, inventory,
cloud saves or care history, and every lookup is scoped to the requested owner,
so no other account's character is reachable. Suspended accounts return 404.

MommyBot validates and sanitizes every field before posting, stripping control
and bidirectional-override characters so a character name cannot reorder or
impersonate part of a Discord message.

### When it says it cannot find your character

Run the diagnostic as the bot account, with the member's Discord user ID:

```
sudo -u mommybot node /opt/mommybot/current/scripts/check-mmo-character.mjs <discord-user-id> /etc/mommybot/mommybot.env
```

It is read-only, sends no Discord messages, and prints a masked account ID rather
than the real one or the bridge token. Each stage says what to fix:

- **wallet link** - that member has never run `/lidollid login`, so MommyBot has
  no account to ask about.
- **wallet origin** - their wallet was connected against a different tracker than
  `LIDOLLCOIN_API_URL` names now. A different tracker issues a different
  `account_id`, so the game will not recognize it. They must run `/lidollid login`
  again.
- **character** - the game server has no character owned by that `account_id`.
  This is the usual cause. Compare the masked ID against `quest_characters.owner`
  on the game server: almost always the character was created under a different
  LiD0llID than the one linked to Discord. Signing into the game with the linked
  account and creating or selecting a character fixes it.
- **game server** returning 404 without the expected body - the deployed
  LiDollQuest predates `/integrations/mommybot/character`. Deploy the update.
- **endpoint path** - `LIDOLLMMO_ONLINE_URL` does not end in `/joins`, so the
  character URL could not be derived from it. Set `LIDOLLMMO_CHARACTER_URL`
  explicitly.

MommyBot identifies a player only by the `account_id` on their connected wallet,
which is the same field LiDollQuest stores as `quest_characters.owner`. It never
matches on Discord name, character name or LiD0llID username, so the two accounts
must genuinely be the same one.

### The paperdoll image

The endpoint may include a rendered `portrait_png`; MommyBot attaches it and
otherwise posts the appearance fields with an `image unavailable` footer.

**The game server does not render this image yet.** LiDollQuest server is
headless: it holds no sprites, and `server/profile-items.json` maps item IDs to
display names only. The item-to-sprite mapping and the paperdoll compositor live
in the browser client, which is hosted separately. Until a server-side renderer
exists, the paperdoll message shows appearance fields rather than a picture; no
MommyBot change is needed once `portrait_png` starts arriving.

## Joins versus returns

MommyBot tells a real arrival apart from someone coming back to the keyboard.

A **join** is announced as *just joined*, in pink, and pings the `lidollmmo` role.
It means the game saw a genuine arrival: the player had explicitly left the world,
had never entered before, or signed in again and was issued a new grant.

A **return** is announced as *back at the keyboard*, in muted violet, and **never
pings the role**. It means the same signed-in session came back after its
heartbeats lapsed: a slept tab, a closed laptop lid, a dropped connection. Nothing
was left and nobody signed in again.

The game decides this at the moment of entry, where it can still see whether a
presence row survived and which grant owns it. Leaving deletes that row and a
fresh sign-in issues a new grant, so either reads as a join; the same grant
returning to a row it never removed reads as a return.

Heartbeats and movement never announce anything by themselves, and a gap under two
minutes is still treated as one continuous session, so brief reconnects stay quiet.
A game server too old to report arrival kinds has every arrival announced as a
join, exactly as before.

## Diagnose missing announcements

The game server's `GET /health` is only a liveness check. A 200 response does
not prove that its join feed is enabled, the shared secrets match, or the bot
can send/tag the destination channel.

After deploying MommyBot's diagnostic update, run:

```sh
sudo -u mommybot node /opt/mommybot/current/scripts/check-mmo-online.mjs /etc/mommybot/mommybot.env
sudo journalctl -u mommybot -n 200 --no-pager | grep LiDollMMO
```

The check makes only GET requests and opens saved progress read-only. It reports
feature enablement, feed access, cursor/baseline state, newest event age/online
status, channel permissions and role mentionability. It prints no secrets,
character names or remote error bodies and never posts a Discord message.
It reads the environment file; restart the running services after editing their
settings. A passing check does not prove an older process loaded the same file.

Without the new script, this unauthenticated request distinguishes basic cases:

```sh
curl -i http://127.0.0.1:4191/integrations/mommybot/joins
```

Use the game server's LAN address if it is on another host. **401 is expected
without the secret** and proves the protected route exists. **404** means wrong
URL or an older game-server deployment. **503** means the feed is disabled or
unavailable; verify `MOMMYBOT_ONLINE_TOKEN` on the game server and restart it.
The read-only script checks with MommyBot's configured secret: an authenticated
**401** indicates mismatched credentials.

New runtime logs distinguish disabled configuration, successful first baseline,
HTTP status, network errors such as `ECONNREFUSED`, missing/unmentionable roles,
Discord error codes, skipped offline/stale joins and successful delivery IDs.
If the feed works but has no arrivals, leave the MMO for over two minutes, wait
for the bot's first successful poll, then rejoin a shared zone while signed in.

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
