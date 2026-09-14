# Games in Little Log

Open **Games** beside Stickers at `https://lidoll.dev/tracker/#games`. Diaper
Atelier, Cozy Hangman and Touhou Trader open in a separate browser tab. Press
**Sign in with LiD0llID** using the account you linked to Discord. An existing
LiD0llID browser session can be reused; a fresh private Discord game link is no
longer necessary.

For a first visit, run `/lidollid login` in Discord, finish browser consent and
submit the returned confirmation command in Discord. Then return to Games.
Signing in to a game cannot create or switch that Discord link. If the game says
your account is unlinked, check `/lidollid status` and the LiD0llID account you
used in the browser.

| Game | Direct sign-in | Price |
| --- | --- | --- |
| Diaper Atelier | `https://bot.lidoll.dev/diapers/login` | 3 LiDollcoins per roll |
| Cozy Hangman | `https://bot.lidoll.dev/hangman/login` | 1 coin to start; 1 coin per newly revealed letter position |
| Touhou Trader | `https://bot.lidoll.dev/touhou/login` | Random adoption: 1 star **or** 25 LiDollcoins; other payments/rewards use coins |

## Touhou in the browser

Choose a Discord server first. Only servers you and the bot currently belong to
are available. Your collection, market, potions and battles belong to that server,
exactly as in Discord. Membership is checked before each selected-server request;
a Discord outage can temporarily prevent access.

The buttons offer adoption, your party, battles and difficulty selection, attacks,
defense, potions, healing, player listings, buyback, gifts and swaps. Market prices
and battle rewards use the existing online wallet rules. Momiji Inubashiri remains
reserved for Discord ID `319254336402358272`.

To gift or propose a swap, enter the recipient's **Discord user ID** (enable
Discord Developer Mode, then use Copy User ID). For swaps, choose your Touhou and
theirs, then confirm the offer. The recipient selects the same server and presses
**Refresh** to see their trade inbox. They must accept within one minute. Web
offers do not send Discord notifications; tell your friend to check their inbox.
Pending Discord offers can also be accepted in this inbox. Expired or already
resolved offers cannot be accepted twice.

Menus expire after five idle minutes. Use **Back to trader home** to reopen one.
Battles keep their existing 90-second idle limit. Browser and Discord play share
the same saved state; avoid playing the same battle in two tabs at once.

If a payment response is lost, press Refresh, return to trader home, then use
**Retry pending payment**. It resumes the saved receipt rather than buying again.
Do not start another adoption to recover a missing result. An expired/disconnected
wallet still needs `/lidollid login` (or wallet connect) in Discord; game sign-in
does not replace wallet consent.

## Sessions and deployment

Games have separate eight-hour cookies. A new sign-in replaces that game's older
browser sessions. Signing out of Little Log does not sign out of an open game;
use each game's Sign out button on shared devices. Discord unlink invalidates
game sessions without deleting collections or balances. These pages require an
internet connection and are opened directly, without an iframe.

The bot keeps the game data and payment journals. No collection migration or
duplicate PWA payment implementation is needed. New login/session tables are
created automatically in the existing databases and included in normal backups.

After both repositories' changes have been committed and pushed, update the bot
first on Fedora:

```bash
cd ~/MommyBot
bash scripts/update-fedora.sh
```

Then update omo-trainer:

```bash
sudo bash /opt/lidoll/current/deploy/fedora-update.sh
```

The PWA defaults to `https://bot.lidoll.dev`. For another deployment, set
`LIDOLLBOT_PUBLIC_ORIGIN` in the tracker service environment to the bot's HTTPS
origin, with no path. This is separate from the bot's existing
`LIDOLLID_PUBLIC_ORIGIN`. The bot still uses its registered `/auth/callback`,
client ID and issuer: **no new OIDC client or callback registration is required**.
Its existing wallet and identity features must be enabled.

Nginx must proxy `/diapers/`, `/hangman/`, `/touhou/` and `/auth/` to the bot's
existing auth HTTP listener, preserving the paths. If the bot virtual host already
proxies `location /`, nothing extra is needed. For a proxy restricted to individual
paths, add `/touhou/` alongside the other game locations using the same upstream
and proxy headers. Preserve the existing callback logging protections. The PWA
`/tracker/games/` routes go to the tracker Node service, not a static-file alias.

After updating, reload the PWA and open each game from Games. Check the expected
account, Touhou server and balance. Local tests use fake accounts; live SSO,
Discord membership and Fedora/Nginx routing still need this deployment check.

## Implementation notes

`src/games/login.js` namespaces OIDC state with `game.`, stores one-use
cookie-bound attempts and reuses verified OIDC token/UserInfo checks. It resolves
the exact issuer/subject against `identity_links`; no browser-supplied Discord
account is trusted. Game login requests only identity scopes, not wallet grants.
The original Discord ticket flow keeps its own cookies and callback handling.

`src/touhou/web-game.js` adapts authenticated web controls to the existing
`TouhouMenus` and shared rule/payment services. Displayed controls, menu revisions,
ownership, recipient consent and current server membership are enforced by the
server. `src/touhou/web.js` exposes only display data and same-origin, CSRF-checked
actions; wallet tokens and database objects never reach the page.
