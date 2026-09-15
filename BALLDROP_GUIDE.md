# Prism Drop

Prism Drop is a colorful ball-drop game at `/balldrop/`. Open it from the private
**/menu → Prism Drop** button, run **/balldrop**, or send **!balldrop** for a private
DM handoff. Browser players can sign in at `/balldrop/login` using LiD0llID without
Discord membership. Signing in or replaying a saved drop costs nothing.

## How to play

Choose one of ten numbered landing pockets and bet **1, 5, 10, 25, 50 or 100
LiDollcoins**. Press **Drop the rainbow** to commit that bet. The server randomly
selects entry pin **4, 5, 6 or 7**, each equally likely, then chooses a left/right
bounce at ordinary pegs. Special pegs can change the route or add rewards.
At a wall the ball reflects inward. The
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
shows the exact landing returns for the selected wager before purchase. Collected
coin-peg bonuses are added to those returns, including on missed guesses.

The canvas replays the saved path with colorful ball trails, pin-impact rings,
glowing pins and rainbow pockets. A system preference for reduced motion shows
the result immediately. Controls are keyboard accessible and results have text
announcements. Free **Replay** and recent-drop buttons never charge or reroll.
The most recent eight settled drops are visible only to their owner.

## Sound

Prism Drop plays a drop swoop, musical peg taps, block knocks, bomb booms,
coin chimes and landing melodies. **Sound: on/off** above the field remembers
your preference in this browser and stays available during animation. Sound
starts only after a click or tap; loading or refreshing the page is silent.
Replays include sound without spending or earning coins. Reduced motion uses
only the final landing cue. Hidden tabs stop existing sounds and skip hits.

`src/balldrop/web/sound.js` synthesizes the effects with Web Audio; it needs no
audio downloads or new service settings. Tune notes and envelopes there, and
keep effects quiet, short and tied to saved collisions. Audio/device or storage
failures must never stop a wager or interfere with payment recovery.

## Payments and recovery

The board contains 11 striped blocked pegs, nine orange bombs and eight gold
coin pegs. Every new paid wager randomly places all 28 special pegs in unique
cells across rows 1-19, keeping the entry row clear. The entry pin, bounces,
bomb directions and coin amounts also get fresh server rolls. Before the first
bet the board shows ordinary pins; afterward it shows the labeled saved field,
not a preview of the next wager.

- Blocks push the ball two columns left or right while descending one row.
- Bombs launch it two or three grid spaces in one of eight equally likely
  compass directions, including upward and sideways. The flight clears
  intervening pegs; collisions resume at its destination. Walls and ceiling
  reflect the blast; reaching the bottom finishes the drop. Each bomb fires
  once per drop, preventing endless upward loops. Explosions add spark bursts.
- Coin pegs award a uniformly random **1-5 extra coins**, once per peg per drop.
  Returning to a collected peg cannot award again. They pay even when the
  pocket guess misses. Gold `+N` effects and the tally show collected bonuses.

Blocks, bombs and coins shuffle for every new paid drop. Replays only repeat
the saved field and effects; reloads and payment retries never reshuffle.
The final result separates the landing return from the peg bonus, then confirms
their combined credit. Reduced motion shows that final tally immediately.

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
The HTML/CSS/canvas assets are in `src/balldrop/web/`. Their soft pink, lilac,
mint and cream palette, rounded cards, paper shadows and display font follow
the default Little Tracker appearance from `lidoll.dev/tracker`. The theme is
self-contained; no tracker scripts, stylesheets or session storage are required. This repository has no
`game_editor_gui.py`; these files are the editing surface. Future editors should
reuse the authored rules and preview without performing real wallet operations.
Never recalculate already-saved payouts after changing rules.

`obstacles`, `trajectory` and `bonus` are additive columns on `balldrop_rounds`.
Old rows default to no obstacles, their original row-by-row path and zero bonus;
migration and retries never reroll them. Edit `OBSTACLE_COUNTS`, `BLAST_DIRECTIONS` and
`COIN_REWARD` in `rules.js` for future drops, updating descriptions alongside them.

## Verification

Run `node --test test/balldrop.test.js` and `npm test`. Tests use fake online
coins with actual disposable SQLite journals. They cover all bet amounts and
distance payouts, rounding, pin bounds, invalid inputs, duplicate requests,
restart recovery, wallet pinning, lost receipts, malformed receipts, storage
failures, locking, paused recovery, private commands, CSRF and session isolation.
Shared SSO tests also cover standalone ball-drop login and consent.

Obstacle tests cover all eight blast directions, upward revisits, bottom exits,
bounded termination, block deflection, 1-5 coin rolls, single collection, bonuses
on misses, hidden unpaid outcomes and migration of pending legacy rounds. The
Chrome fixture also verifies coin tallies, the landing/bonus breakdown, pastel
styles and successive shuffled fields. Fixed collision scenarios live only in
`scripts/fixtures/balldrop-layout.mjs`. Seeded tests cover layout counts, unique
cells, all four entry pins and persistence through retries and restart.

Set `PUPPETEER_MODULE` and `CHROME_PATH` to local tools, then run
`node scripts/check-balldrop-browser.mjs`. `BALLDROP_SCREENSHOT_DIR` optionally
saves desktop/mobile screenshots. This exercises the real browser handoff,
animation, rounded returns, replay, reload, reduced motion, payment recovery,
low funds, wallet outages, request preparation failures and logout using only
synthetic coins. Production login, proxy routing and provider limits still need
a deployment check with the operator's own test account.
