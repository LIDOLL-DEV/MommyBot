# Go Fish

Open **`/gofish`** or choose **Go Fish** in `/menu`. `!gofish` sends the same
private link by DM; if DMs are closed, use the slash command. Finish
`/lidollid login` first so your account and online wallet are connected.

The page matches the other games' pastel theme: your hand is grouped into ranks
you can tap, the pond and your opponent's hand show only as counts, and every
ask is written into a shared log both players can read.

## Two ways to play

**Against the computer** costs **1 online LiDollcoin** and pays **1 coin for
every book of four** you complete. A typical game finishes with six books, so a
good game pays for itself several times over. The computer is beatable: it wins
a little over half of evenly played games.

**Against a friend** is completely free and never touches either wallet. There
are three ways to reach one:

- **Get an invite code.** Your table gets a code like `ABCD-2345`. Anyone you
  give it to can type it on their own Go Fish page within thirty minutes.
- **`/gofish friend:@name` in Discord.** That member gets a DM with their own
  private sign-in link, already carrying the code. The challenge expires after
  ten minutes and **only** the challenged member can take that seat.
- **Open a table anyone can join.** Your table is listed on every signed-in
  player's page until someone sits down, for thirty minutes.

## Rules

- Ask for a rank you are **holding**. The game will not let you ask otherwise.
- If your opponent has any, they hand over **all** of them and you ask again.
- If they have none, **go fish**: you draw from the pond. Draw the very rank you
  asked for and your turn continues; otherwise it passes.
- Four of a kind is a **book**, laid down automatically as soon as it forms.
- An empty hand draws back from the pond, so you are never stuck while cards
  remain. The game ends when all thirteen books are made.
- Thirteen books cannot split evenly, so a finished game always has a winner.

Your opponent never learns which card you drew — only that you fished, and
whether you got your wish. The pond order and the other hand stay on the server
and are never sent to either browser.

## Coins, payments and leaving

Only the computer game touches coins, and only for books **you** complete. The
computer's books pay nothing, and four of a kind dealt into your opening hand is
laid down for score but pays nothing.

If a payment cannot be confirmed, press **Retry payment**. This resumes the
saved entry or book reward with its original payment ID. You can also use
`/lidollid wallet retry` or **Retry payment** in `/menu`. Do not start a
replacement game for an uncertain payment. Little Log's existing coin earning
cap applies; a capped reward stays saved for retry when the limit permits it.

Pending payments block other wallet transactions and unlinking. A game's rewards
stay bound to the wallet account used to start it. If you relink a different
wallet mid-game, reconnect the original account to continue.

**Leave this game** asks for confirmation. Earned coins stay yours and the entry
coin is not refunded. Leaving a friend game hands your friend the win. Closing a
table nobody joined costs nothing.

One game at a time per account, in either seat. Reloading resumes it. Stars are
never spent or awarded by Go Fish.

## Sessions

Private handoffs expire after ten minutes. Opening one creates an eight-hour
browser session and revokes older Go Fish browser sessions. Logout and account
unlink remove browser access but keep your game and earned coins. Go Fish has
its own browser session, separate from the other games.

While you are waiting for a friend to move, the page quietly checks for their
ask every few seconds. Those checks never call the wallet, so a waiting table
costs nothing.

## Fedora deployment

Go Fish starts automatically when LiD0llID and online wallets are enabled.
After committing and pushing this update to your deployment branch, run:

```bash
cd ~/MommyBot
bash scripts/update-fedora.sh
```

Proxy `/gofish/` to the bot's auth listener alongside `/hangman/` and the other
games. Back up `data/gofish.db` with the other game databases; it holds tables,
hands and the payment journal. Set `GOFISH_ENABLED=false` to pause new games
while letting games in progress and payment recovery finish.

Run `node --test test/gofish.test.js` before deploying.
