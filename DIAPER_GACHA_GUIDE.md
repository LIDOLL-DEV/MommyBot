# Diaper Atelier

Owned designs now also dress your doll in **Littlepottchi** (`/littlepottchi/`).
**Clothes Emporium** (`/clothes/`) supplies individually rolled clothing pieces.
All three share the Atelier login session. The equipped diaper automatically
chooses the regular or wide-legged base; clothing fit and care are explained in
[DRESSUP_GUIDE.md](DRESSUP_GUIDE.md).

A web-based diaper collection game for LiDollBot, inspired by LumiBot's cigarette
gacha: weighted random discoveries, collectible copies and rarity tiers. The
atelier uses Little Tracker's pastel theme and the supplied `diaper-gacha/` art.
All purchases and sales use the connected **online LiDollcoin wallet**.

## Playing

**Baby wipes:** visit the supply section in the Atelier to buy individual wipes
for 1 LiDollcoin by default (`BABYWIPES_PRICE`). One wipe cleans any number of
Littlepottchi diaper-free accidents and leaks before a fresh diaper. Purchases
are saved for retry across reloads, and use the same wallet and identity. Wipes
are consumed only by the pet's **Use 1 baby wipe** button when cleanup is needed.

1. Link your identity and wallet with `/lidollid login`, finish browser consent,
   and send the returned `/lidollid confirm code:…` command in Discord.
2. Run `/diaper` (or `/diapers`). Open the private link and press **Open my atelier**.
   You can also type `!diapers`: the bot DMs your private link. If your DMs are
   closed, use either slash command for an ephemeral reply instead.
3. Visit **The capsule machine** to roll for **3 LiDollcoins**. Every successful
   roll delivers one copy; a reveal shows the design and rarity.
   For a quick roll without the website, type `!diaper` in Discord. It spends the
   same roll price, adds the copy to your collection, and posts the design's art,
   rarity and price as a reply in that channel. Everyone there can see it.
4. Open **My collection** to see all your copies, search names/descriptions,
   filter by rarity, or show only duplicates. Collections have no capacity limit.
5. Use **Sell 1** to sell one copy to the diaper bank. The displayed quote is
   credited to your online wallet.
6. Open **Diaper bank** to buy any available copy. The bank is shared across
   all players and servers, and starts empty. You can buy back a copy you sold,
   provided another player has not bought it already.
7. **Design book** shows all 58 designs, exact per-design odds and current bank
   quotes. **Refresh** updates stock, prices and your wallet balance.

Your collection belongs to your Discord account. Unlinking LiD0llID does not
delete it. A private game link lasts ten minutes; its browser session lasts
eight hours. A newer game link replaces older unused links, and opening a new
session signs out older game sessions. **Sign out** closes game access without
unlinking your identity or disconnecting the wallet. `/lidollid unlink` also
invalidates game sessions. Never share your private `/diapers` link.

The game runs at `LIDOLLID_PUBLIC_ORIGIN/diapers/`. Discord issues the private
handoff link; the website handles rolls, reveals, collections and bank trades.
This is an ordinary browser game, not an embedded Discord Activity or a native
Discord Rich Presence client.

## Rarity and stock-based bank prices

| Rarity | Chance per roll | Buy when only one is in stock | Sell when none are in stock |
| --- | ---: | ---: | ---: |
| Common | 55% | 3 coins | 1 coin |
| Uncommon | 25% | 3 coins | 1 coin |
| Rare | 14% | 4 coins | 2 coins |
| Epic | 5% | 12 coins | 6 coins |
| Legendary | 1% | 24 coins | 12 coins |

**Prices change with the bank's inventory of each design.** Fewer copies mean
higher prices; more copies lower both buy and sell quotes. Rarity sets the
starting value. Counts include reserved bank copies until their purchases
finish, while only unreserved copies can be bought. A pending sale does not
enter bank stock until its credit is confirmed.

For operators, the price rule is:

```text
base = max(3, floor(roll price × rarity multiplier))
buy(stock) = max(2, floor(base × 8 / (8 + max(1, stock) - 1)))
sell(stock) = max(1, floor(buy(stock + 1) / 2))
rarity multipliers: Common 0.4, Uncommon 0.8, Rare 1.6, Epic 4, Legendary 8
```

The sell quote uses the inventory after depositing the copy. That keeps a
buy-then-sell cycle from generating coins. Whole-coin floors keep buy prices at
least two and sale credits at least one. A stale browser quote is rejected before
payment; once a trade is journaled, retries retain that exact price despite later
stock changes. Other designs' inventory does not affect this design's price.

The server draws a rarity first, then chooses uniformly among that rarity's
designs. Adding designs does not change the tier odds. There are no hidden
pity counters or boosts. Exact per-design odds are shown to three decimal places.

Cuteness is an editorial judgment: simple solid-color staples are common;
patterns and soft colors add interest; animal prints, elaborate ribbons and
layered ruffles are rarer. Princess Ribbon, Ribbon Bouquet and Royal Rose are
the three initial legendary designs. Names are descriptive game names, not
claims about commercial brands.

`diaper-gacha/catalog.json` defines stable IDs, image filenames, names,
descriptions, rarity and optional sprite framing. The 58 designs use 45 full
illustrations and 13 additional sprite designs. Faded copies and thumbnails of
the same illustrations remain in the source folder but do not get separate
chances in the roll pool. Original PNGs are unchanged.

To rebalance, edit the manifest and `src/gacha/catalog.js`. Keep all five tiers
populated. Never reuse a design ID for different artwork, or remove image files
that existing collections reference. Catalog records persist in the game DB so
removing a design from new rolls does not delete owned copies. Retired art must
also remain available in the web asset allowlist before retiring a design.

## Fedora deployment

Both `/diaper` and `/diapers` register as server commands on startup. If a command
is missing, try it inside the server with the bot, check that the latest release
is deployed and that identity/wallet services are enabled. The service journal
logs each successful registration or a numeric Discord error code. Existing
deployments need an update to gain the singular `/diaper` alias.

With `LIDOLLID_ENABLED=true` and `LIDOLLCOIN_ENABLED=true`, the game enables
automatically after deploying this code. It reuses the bot's HTTPS hostname,
port 4190 listener, confirmed identity and existing wallet consent. No new OIDC
client, wallet app or callback URL is needed.

Optional settings in `/etc/mommybot/mommybot.env`:

```dotenv
DIAPER_GACHA_ENABLED=true
DIAPER_GACHA_ROLL_PRICE=3
```

After committing and pushing the changes, update on doll-chan:

```bash
cd ~/MommyBot
bash scripts/update-fedora.sh
```

The deployer includes `diaper-gacha/`, validates the catalog and configuration,
and runs tests before switching releases. The existing nginx `location /`
proxy to the bot covers `/diapers/`. If your bot vhost only proxies `/auth/`, add
this location alongside it, retaining your existing public TLS configuration:

```nginx
location /diapers/ {
    proxy_pass http://127.0.0.1:4190;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_read_timeout 60s;
    access_log off;
}
```

Use the bot's private address instead of loopback when nginx is on another
machine. Do not cache HTML or API responses, log ticket query strings, or replace
the landing page's `Referrer-Policy: origin` header. Ordinary game/API pages use
`no-referrer`. Keep the existing wallet API URL and token verification settings;
see [ONLINE_WALLET_GUIDE.md](ONLINE_WALLET_GUIDE.md).

Changing the roll price scales the bank's starting prices too. Valid roll prices
are integers from 3 to 10000. Already-created payments retain their original
amount. Set `DIAPER_GACHA_ENABLED=false` to pause new rolls and trades while
retaining collection access and payment recovery. Keep identity and wallet
services enabled during recovery.

## Payments, persistence and recovery

If Roll looks disabled, read the message directly below it. The game shows the
reason: fewer than three LiDollcoins, an unavailable wallet balance, a pending
payment, or paused rolls. A waiting cursor is used only while a request is
running. Stars do not fund diaper rolls. After earning coins or selling a copy,
press **Refresh** to load the current online balance.

Confirmed prizes appear immediately after payment delivery, before the balance
refresh finishes. If the refresh fails, the completed purchase remains saved;
refresh the collection instead of purchasing a replacement.

`data/diaper-gacha.db` holds designs, collectible copies, payment jobs, hashed
handoff tickets and hashed sessions. Fedora keeps it in
`/var/lib/mommybot/data/diaper-gacha.db`, included in existing stopped-state backups.
The game DB never stores wallet bearer tokens. A single bot process must own the
data directory; sharing these DBs across concurrent bot workers is unsupported.

Every action journals a stable operation ID, fixed quote, chosen design and
original wallet account/API before contacting Little Log. Roll results stay
hidden until delivery. Sales reserve one owned copy; purchases reserve one bank
copy. A second buyer cannot reserve the same copy while a payment is in flight.
After the wallet confirms the exact coin receipt, ownership and completion commit
together. A restart or lost response reuses the original wallet operation ID.

If a payment is pending, press **Retry payment** or run `/lidollid wallet retry`.
New purchases and unlink/disconnect are blocked until it finishes. An initial,
definitive rejection releases the reservation; uncertain outcomes keep it.
Wallet credit limits also apply to bank sales. Renew an expired wallet through
`/lidollid login` using the same LiD0llID; pending payments cannot switch to
another wallet account.

After a confirmed payment, a local storage failure retains the paid job so it
can deliver after storage is repaired. Do not delete jobs, manually clear locks,
or reroll to recover. Back up the game and wallet databases together using the
normal stopped-service backup. Restoring an old local snapshot does not reverse
online wallet operations, so do not restore an old snapshot as a payment undo.

## Verification

Run `node --test test/diaper-gacha.test.js` for isolated economic, identity,
HTTP and recovery tests, and `npm test` for the full application suite.

For browser checks with local puppeteer-core and Chrome installed:

```bash
PUPPETEER_MODULE=/path/to/puppeteer-core/lib/puppeteer/puppeteer-core.js \
CHROME_PATH=/path/to/chrome \
DIAPER_SCREENSHOT_DIR=/tmp/diaper-preview \
node scripts/check-diaper-browser.mjs
```

This uses temporary browser profiles, in-memory databases and simulated coins.
It checks opening the private link, rolling, revealing, selling, buying back,
filtering, logout, mobile overflow and CSP errors. Optional screenshots contain
fixture data only. A live Discord/HTTPS deployment still needs an operator check
with a linked test account after deployment.


## Play through Little Log

[Games in Little Log](GAMES_GUIDE.md) documents the new PWA Games page, direct LiD0llID sign-in for all three games, Touhou browser controls, session behavior and deployment order. Existing Discord commands and saved collections remain available.
