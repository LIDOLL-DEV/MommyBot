# MommyBot player checklist

## Friends online

- Use `/lidollmmo` to show your character in the configured showcase channel.
  Select another with `character:<name or id>`; duplicate names need an ID from
  the private reply. If lookup fails, retry without a selection and make sure
  the game uses the same LiD0llID as `/lidollid login`. Endpoint errors need an
  administrator's help, not a new character.

- Signed-in LiDollMMO characters entering the shared world appear in #whos-online
  after the integration is enabled. Announcements use character names and ping
  the **lidollmmo** role. Brief reconnects do not post again.

## Server administration

- Choose **She/Her**, **He/Him** or **It's Complicated** for Sakura's pronouns
  and forms of address. It's Complicated uses they/them. Conflicting or missing
  selections use neutral wording. Remove old pronoun reactions when switching.

- Server Administrators can sign into `/admin/` with their Discord-linked
  LiD0llID to manage chat/welcome/swear-jar switches, starboard and reaction roles.
- Admins can add several emoji/role choices to one message in the panel using
  **Add another emoji / role**, then **Save choices & add emojis**.
- React to several choices to receive several roles; removing a reaction removes
  a role granted by that mapping. A role you already held is kept.
- Starboard excludes self-stars and bots. Server admins choose the emoji,
  threshold and public source channels. See [ADMIN_GUIDE.md](ADMIN_GUIDE.md).

## Chat and games

- To address Sakura directly, mention her, begin with **Sakura, ...**, or use
  Discord **Reply** on her message. Reply works even with the reply ping off.
  Short answers can continue a recent exchange; you do not need to tag every
  turn. She should leave conversations addressed to other members alone and
  let closing remarks end an exchange. The configured chat-channel gate still
  applies, including to DMs.

- Open **/menu → Prism Drop**, `/balldrop`, or `/balldrop/login` in your browser.
  Pick pocket 1-10 and bet 1, 5, 10, 25, 50 or 100 coins. The ball starts at a
  random pin from 4-7 on the 10-by-20 field. Exact guesses return 2x, one away
  returns 1.5x rounded up, two away returns your bet, and larger misses lose it.
  Returns include your stake. Replay is free; use **Retry payment** for a pending
  debit or payout instead of placing a replacement bet.
  Striped blocks shove the ball sideways; orange bombs can launch it in any
  direction. Gold coin pegs give 1-5 extra coins each, once per drop, even on a
  missed guess. Every new wager shuffles blocks, bombs and coins and rolls a new
  drop. The pastel board shows your saved field after playing; the next field
  is revealed when you drop. Replay earns nothing and preserves that field.

- Use **Sound: on/off** above the Prism Drop field to mute or enable effects.
  Your browser remembers the setting. Sounds begin after a click or tap; free
  replays play sounds too. Reduced motion keeps only the landing cue.

- Nightly Little Log reports appear in the configured reports channel after
  generation completes. Open the `.md` attachment for the full report; its caption
  warns if generation reached its output limit. Manual analyses are not posted.
  Initial setup may also deliver older nightly reports.

- When you join, read MommyBot's welcome in the welcome channel and open its
  **server rules** link. Complete LiD0llID registration and the Discord sign-in
  code confirmation to receive the linked-account role for full server access.

- Create a LiD0llID account if needed, then run `/lidollid login` in Discord.
- Finish browser sign-in, approve wallet access and confirm the code in Discord.
- Use `/lidollid status` to check your link and `/lidollid wallet balance` to
  check your online currency privately. `/menu` opens the account and game tools.
- Press **Coin leaderboard** in `/menu` to open the public Coin Garden webpage.
  Search all registered MommyBot players and compare their online coin balances.
  Missing or expired wallet access appears as **Unavailable**, not zero. Balances
  refresh at most once per minute; use **Refresh** to check again.
- To send your own currency, open `/menu` in a server and choose **Send coins**
  or **Send diamonds**, select another player, enter the amount, then review
  **Confirm & send**. Stars cannot be sent. Both players need connected wallets
  and diamond permission for diamonds. Cancel before confirming to spend nothing.
- If a transfer is pending, either participant can use **Retry payment**. Do not
  send a replacement. A definitively refused recipient credit refunds the sender;
  uncertain payments and refunds retain their original IDs for recovery.
- A server message containing listed swearing costs **1 coin**, even with several
  swear words. MommyBot replies to explain the charge or account problem.
- After swearing, say **sorry mommy**, **sorry mommy Sakura**, or **sorry mommybot**
  in the same channel within fifteen minutes. Cute apologies get a thank-you;
  a plain "sorry", "my bad", or skipping the apology gets one **act your age**
  reminder on your next message. The original fine still applies.
- Apology thanks and manners reminders use Sakura's chat-generated wording,
  with standard replies available if the AI is offline.
- The three suggested apology phrases are recognized directly, including bold
  formatting and capitalization changes. Other wording is checked by the AI.
- **Sorry momma** and **sorry momma Sakura** also get direct recognition.
- Each swear-jar notice includes an AI-written reminder or celebration and the
  current server jar balance. Reserved lottery prizes are shown separately.
  Standard wording and the balance still appear if the AI server is unavailable.
- Need a breather? `/swearjar optout` costs **5 LiDollcoins** and pauses fines
  for you, in that server, for **three hours**. The reply is private, the three
  hours start once your wallet confirms the payment, and asking again during a
  break just tells you the time left. Those 5 coins are spent, not added to the
  jar, and they do not refund fines you already paid.
- Every linked human member currently in the server enters its weekly swear jar
  lottery automatically. You do not need to swear or buy a ticket.
- Look for the winner announcement after **Monday 00:00 UTC**. One winner receives
  that server's collected coins. An empty jar or no eligible members rolls forward.
- If payment is pending, reconnect your original account with `/lidollid login`
  if needed, then run `/lidollid wallet retry`. A reserved lottery prize remains
  yours while wallet access is restored; MommyBot also retries automatically.

See [SWEAR_JAR_GUIDE.md](SWEAR_JAR_GUIDE.md) for the word list and full rules,
[ACCOUNT_LINKING_GUIDE.md](ACCOUNT_LINKING_GUIDE.md) for sign-in help, and
[GAMES_GUIDE.md](GAMES_GUIDE.md) for available games.
