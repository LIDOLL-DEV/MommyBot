# 🌸 Link your LiD0llID with Sakura

Hi sweetpeas! Linking lets Sakura recognize your LiD0llID and connect your
Little Log stars and LiDollcoins for Touhou Trader. Here's our little walkthrough. 💕

## Prefer buttons?

Open `/menu` for Sakura's little account-and-wallet panel! Press **Connect /
renew**, open your private browser link, and approve your account connection.
Back in Discord, press **Enter sign-in code** and paste just the 32-character
code from the browser page. The confirmation finishes linking and awards your
linked-account role when Sakura has permission.

Use **Account status** or **Online balance** to check everything. **Touhou
Trader** opens the trader in its channel, and **Diaper Atelier** gives you your
private game link. **Unlink account** has a confirmation screen for testing.
Only you can use your buttons; reopen `/menu` if they expire after five minutes.
`/lidollid menu` and `/lidollid wallet menu` open this same panel.

**Coin leaderboard** opens the public Coin Garden page, listing registered
MommyBot usernames and online coin balances. It includes Discord and browser
players once per account. If your balance says **Unavailable**, use **Connect /
renew** to restore wallet access, then refresh after a minute. See
[COIN_LEADERBOARD_GUIDE.md](COIN_LEADERBOARD_GUIDE.md).

## Link your account

1. In Discord, type `/lidollid login` and send the command.
   Sakura gives you a private sign-in link that only you can see.
2. Open that link in your browser and press **Continue with LiD0llID**.
3. Sign in to **your own LiD0llID**. If you're already signed in, check that
   it's the account you want! Review the wallet permissions and press
   **Connect account and wallet** when shown.
4. On the page you return to, check your username and copy the
   `/lidollid confirm code:…` command. Send it in Discord using the **same
   Discord account** that started the login.
5. Wait for Sakura's connected message. All linked up! 🌷 Run `/lidollid status`
   to check your account and `/lidollid wallet balance` to see your online
   stars and LiDollcoins.

**Don't stop at the browser page!** Sending the confirmation command in Discord
is the step that finishes linking. Keep your sign-in link and code to yourself.
They expire ten minutes after starting; a new login replaces the previous attempt.

Successful linking also gives you the server's linked-account role. If you're
already linked or the role didn't arrive, run `/lidollid status` in the server.
If Sakura reports a permissions problem, ask Doll to check her role permissions.

Ready to adopt? Visit <#1548647250543251507> for Touhou Trader. Random adoption
costs **1 star OR 25 LiDollcoins**. Other trader payments and rewards use your
online LiDollcoins.

## Visit the Diaper Atelier

Want a little collectible surprise? Once linked, use `/diapers` to open the
[Diaper Atelier](DIAPER_GACHA_GUIDE.md). Rolls cost **3 LiDollcoins**, and its
shared bank lets you sell and buy collectible diapers at prices based on stock.

## Unlink or start a fresh test

Run `/lidollid unlink`, or run `/lidollid status` and press **Unlink account**.
Both options unlink immediately. Wait for Sakura to confirm it worked.

This removes your bot account link, revokes its wallet connection, and cancels
unfinished sign-ins. **Your stars, LiDollcoins and Touhou collection stay safe.**
Your LiD0llID account and already-awarded Discord role also stay.

For a fresh test:

1. Unlink, then run `/lidollid status` to check it says no LiD0llID is linked.
2. Run `/lidollid login` to get a **new** link and follow the steps above.
3. To test a different LiD0llID, sign out of LiD0llID in your browser first,
   or open the new link in a private browser window and finish the browser
   steps there. Unlinking the bot does not sign you out of your browser.

Each person can unlink their own account. A LiD0llID can only be linked to one
Discord account in this bot, so unlink it from the original Discord account
before moving it to another.

## Tiny troubleshooting corner 🧸

- **Expired or already-used link/code:** Start a new `/lidollid login` and use
  its link and code. Don't reopen an older attempt.
- **Unlink says a payment is pending:** Run `/lidollid wallet retry` to finish
  the pending payment, reward or refund, then try unlinking again.
- **The wallet is unavailable:** Ask Doll for help and retry when it is back.
  Unlink keeps your connection saved until wallet access can be revoked.
- **Testing the role award again:** Doll can manually remove the linked-account
  role first. Successful linking or `/lidollid status` adds it back.
- **Only want to disconnect the wallet?** Use `/lidollid wallet disconnect`.
  Your identity stays linked. `/lidollid login` reconnects them together.


## Play through Little Log

[Games in Little Log](GAMES_GUIDE.md) documents the new PWA Games page, direct LiD0llID sign-in for all three games, Touhou browser controls, session behavior and deployment order. Existing Discord commands and saved collections remain available.


## Diamonds

New login approvals request coin, star and diamond read/write permissions. Already connected players can renew through /lidollid login to add diamonds. Their existing coin/star connection remains usable until renewed; the wallet display marks diamonds as needing reconnection.
