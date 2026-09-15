# Prism Drop

Prism Drop is a colorful ball-drop game at `/balldrop/`. Open it from the private
**/menu → Prism Drop** button, run **/balldrop**, or send **!balldrop** for a private
DM handoff. Browser players can sign in at `/balldrop/login` using LiD0llID without
Discord membership. Signing in or replaying a saved drop costs nothing.

## How to play

Choose one of ten numbered landing pockets and bet **1, 5, 10, 25, 50 or 100
LiDollcoins**. Press **Drop the rainbow** to commit that bet. The server randomly
selects entry pin **4, 5, 6 or 7**, each equally likely, then chooses a left/right
bounce at each of the twenty pin rows. At a wall the ball reflects inward. The
field is ten pins wide and twenty rows high, with ten pockets numbered left to
right. Payout distance is the absolute difference between your guess and the
landing pocket; the edges do not wrap around.

| Distance from your guess | Total return | Example on a 25-coin bet |
| --- | --- | --- |
| Exact | 2× bet | 50 coins |
| One pocket either way | 1.5× bet, rounded up | 38 coins |
| Two pockets either way | 1× bet | 25 coins |
| Three or more pockets away | 0 | Lose the 25-coin bet |

Returns **include the original stake**. LiDollcoins are whole numbers: one-away
payouts on 1-, 5-, and 25-coin bets are 2, 8, and 38 coins, as requested. The game
shows the exact coin returns for the selected wager before purchase.

The canvas replays the saved path with colorful ball trails, pin-impact rings,
glowing pins and rainbow pockets. A system preference for reduced motion shows
the result immediately. Controls are keyboard accessible and results have text
announcements. Free **Replay** and recent-drop buttons never charge or reroll.
The most recent eight settled drops are visible only to their owner.

## Payments and recovery

The server owns the random path and payout. No outcome is exposed until the
entry debit has a verified receipt. A single `balldrop_rounds` row pins the bet,
guess, path, landing, payout, user and wallet account/API configuration before
network calls. The debit and credit have distinct stable provider IDs.

A lost debit or credit response remains pending; **Retry payment**, the private
menu's retry button, and `/lidollid wallet retry` settle that same saved round.
The browser also preserves an unresolved wager ID in its tab's session storage,
bound to its player ID. A refresh or retry cannot reroll or spend twice. Saved
outcomes may be shown with **payout pending**; they are not reported as credited
until the receipt is verified. Provider earning limits can delay a winning
payout; retry the original payment later. There are no local wallet balances.

Pending drops prevent new wallet actions and unlink/disconnect until settled.
A first definitively rejected debit cancels its entry without exposing the path.
A later rejection cannot erase a previous uncertain payment. Do not delete the
journal or start replacement bets to repair a pending payment.

## Deployment and editing

The game enables automatically with existing LiD0llID and online wallet support.
Set `BALLDROP_ENABLED=false` to pause new bets while keeping recovery available.
No new OIDC client or callback registration is needed. Proxy `/balldrop/` and the
existing `/auth/` routes to the bot's HTTP listener; the public entry is
`https://bot.lidoll.dev/balldrop/`. The tracker site's game list is managed by the
separate tracker repository; this change adds the bot's own page and launchers.

Deploy `src/balldrop/` with the normal MommyBot release. Back up
`data/balldrop.db` alongside the other game and wallet databases, including WAL
files in a consistent backup. The additive table is created at startup. Load
its reservation guard before HTTP opens and close it only after wallet actions
drain. Settle pending drops before rolling back to code without this guard.

Rules live in `src/balldrop/rules.js`, durable settlement in `store.js`, private
Discord launchers in `index.js`, and authenticated HTTP routes in `web.js`.
The HTML/CSS/canvas assets are in `src/balldrop/web/`. This repository has no
`game_editor_gui.py`; these files are the editing surface. Future editors should
reuse the authored rules and preview without performing real wallet operations.
Never recalculate already-saved payouts after changing rules.

## Verification

Run `node --test test/balldrop.test.js` and `npm test`. Tests use fake online
coins with actual disposable SQLite journals. They cover all bet amounts and
distance payouts, rounding, pin bounds, invalid inputs, duplicate requests,
restart recovery, wallet pinning, lost receipts, malformed receipts, storage
failures, locking, paused recovery, private commands, CSRF and session isolation.
Shared SSO tests also cover standalone ball-drop login and consent.

Set `PUPPETEER_MODULE` and `CHROME_PATH` to local tools, then run
`node scripts/check-balldrop-browser.mjs`. `BALLDROP_SCREENSHOT_DIR` optionally
saves desktop/mobile screenshots. This exercises the real browser handoff,
animation, rounded returns, replay, reload, reduced motion, payment recovery,
low funds, wallet outages, request preparation failures and logout using only
synthetic coins. Production login, proxy routing and provider limits still need
a deployment check with the operator's own test account.
