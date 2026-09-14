# Cozy Hangman

Open **`/hangman`** or choose **Cozy Hangman** in `/menu`. `!hangman` sends
the same private link by DM; if DMs are closed, use the slash command. Finish
`/lidollid login` first so your account and online wallet are connected.

The page matches Diaper Atelier's pastel theme, with a smiling flower, a clue,
large letter buttons and support for your physical keyboard. Opening the page
is free. Press **Play for 1 LiDollcoin** to start a word.

## Rules and rewards

- Each round costs **1 online LiDollcoin**, charged once before the word opens.
- Each newly revealed letter position pays **1 LiDollcoin** immediately. Guess
  A in BANANA and reveal three As to earn **3 coins**.
- Wrong guesses and repeated guesses earn nothing and cost nothing extra.
- You have **six wrong guesses**. Each one fades a flower petal. Find the word
  before they run out to win. There is no timer or extra completion bonus.
- Keep your earned coins when you lose or leave a round. **Leave this word**
  asks for confirmation, reveals the answer, and does not refund the entry coin.
- One active round per Discord account. Reloading resumes that same round.
  Stars are never spent or awarded by Hangman.

## Payments and account access

If a payment cannot be confirmed, press **Retry payment**. This resumes the
saved entry or letter reward with its original payment ID. You can also use
`/lidollid wallet retry` or **Retry payment** in `/menu`. Do not start a
replacement game for an uncertain payment. Little Log's existing coin earning
cap applies; a capped reward remains saved for retry when the limit permits it.

Pending payments block other wallet transactions and unlinking. A round's
rewards stay bound to the wallet account used to start it. If you relink a
different wallet between guesses, reconnect the original account to continue,
or leave the round when no payment is pending.

Private handoffs expire after ten minutes. Opening one creates an eight-hour
browser session and revokes older Hangman browser sessions. Logout and account
unlink remove browser access, but keep your saved round and earned coins.
Hangman and Diaper Atelier have separate browser sessions.

## Fedora deployment

Hangman starts automatically when LiD0llID and online wallets are enabled.
After committing and pushing this update to your deployment branch, run:

```bash
cd ~/MommyBot
bash scripts/update-fedora.sh
```

The existing deployment copies all `src/` files and backs up persistent `data/`.
Hangman uses `data/hangman.db`. Restarting the bot registers `/hangman`; no
Discord Developer Portal or additional OAuth client changes are needed.

The existing Nginx `location /` proxy to the bot also serves `/hangman/`. If
your configuration proxies only specific paths, add `/hangman/` to that same
bot listener (normally `http://127.0.0.1:4190`) and disable access logging there
so private handoff query strings are not recorded. Use the same public bot
HTTPS origin configured for account linking and Diaper Atelier.

Set `HANGMAN_ENABLED=false` in the bot environment and restart to pause new
rounds. Existing rounds and saved payments can still finish. Entry price and
per-position rewards are fixed at one coin.

## Words and implementation

The reviewed words and hints live in `src/hangman/words.js`. Use uppercase
English words of 3–10 letters with a short helpful clue. They are selected on
the server with cryptographic randomness. Do not put the word list or hidden
answers in static browser assets. The API sends only revealed letters while
a round is active. There is no public leaderboard or access to other players'
rounds.

`hangman_rounds` saves the answer, clue, guesses and original wallet binding.
`hangman_jobs` saves entry charges, guesses, rewards and forfeits. Each correct
guess and its reward reservation commit together before any external credit.
Retries reuse the saved currency, amount and request ID, including after a
process restart or storage failure.

## Verification

Run `npm test` for economic, session, HTTP and Discord tests. The optional
`scripts/check-hangman-browser.mjs` uses local fake accounts and a fake wallet
to check Chrome at desktop and mobile sizes. Set `PUPPETEER_MODULE` to your
installed `puppeteer-core` entry module and `CHROME_PATH` to your Chrome binary.
Set `HANGMAN_SCREENSHOT_DIR` to a temporary directory to save screenshots.
It never uses production coins or browser profiles.


## Play through Little Log

[Games in Little Log](GAMES_GUIDE.md) documents the new PWA Games page, direct LiD0llID sign-in for all three games, Touhou browser controls, session behavior and deployment order. Existing Discord commands and saved collections remain available.
