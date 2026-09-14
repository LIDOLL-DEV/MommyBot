# MommyBot's swear jar

MommyBot takes **1 online LiDollcoin per message containing a listed swear word**
and replies asking the author to put a coin in the swear jar. Several swear words
in one message still cost one coin. Every server has its own jar.

The rule covers new human messages in all server channels MommyBot can read,
including messages outside `CHANNEL_ID`. Direct messages, bots and webhooks are
ignored. Message edits and historical messages missed while the bot was offline
are not scanned. The jar reply consumes the message before ordinary AI chat.

Unlinked users are told to create a LiD0llID account if needed and register it
using `/lidollid login`. Linked users without working wallet access get a login
reminder. These warnings create no debt and never charge retroactively. If the
wallet definitively refuses a charge, including insufficient funds, nothing is
added to the jar. Public replies never show a member's total balance.

## Weekly lottery

The week ends **Monday at 00:00 UTC**, checked once per minute after Discord is
ready. This is Sunday at 5 p.m. Pacific during daylight time and 4 p.m. during
standard time. All current human members of that server with a confirmed Discord
LiD0llID link get one equal chance, including quiet members and people who have
never paid into the jar. Standalone browser game accounts, bots, departed members
and unconfirmed logins do not enter.

The winner receives the entire available pot of confirmed coins from messages
before that week's boundary. The winner and their prize are saved together before
any wallet request. Wallet consent expiring, daily earning limits, a network
failure or a missing wallet cannot cause a redraw: the prize stays reserved for
that winner. They can reconnect the same account with `/lidollid login` and use
`/lidollid wallet retry`. Automatic retries also run once per minute. A pending
prize is announced as reserved; a later announcement confirms successful payment.

If no linked members are eligible, the coins roll into the following week. Empty
jars make no payment. Temporary Discord membership lookup errors defer the draw
without excluding members. After downtime, an overdue draw runs on startup;
the next scheduled draw is the following Monday. Coins from later weeks and
charges confirmed after a completed draw roll forward into the next lottery.

## Configuration

The feature starts automatically when `LIDOLLID_ENABLED=true` and
`LIDOLLCOIN_ENABLED=true`, using the existing online wallet registration and
permissions. Restart MommyBot after changing settings.

Startup now prints `[Swear jar] ON`, `OFF`, `PAUSED` or `NO MATCHES`, including
the relevant configuration reason. If a listed swear reaches normal AI chat,
check that status and the deployed source revision before changing the matcher.
An older deployed release may not include the feature at all. See
[DEPLOYMENT_FEDORA.md](DEPLOYMENT_FEDORA.md) for diagnostics and update commands.

| Setting | Behavior |
| --- | --- |
| `SWEAR_JAR_ENABLED=false` | Pause new fines; saved payments, notices and weekly distribution still recover. |
| `SWEAR_JAR_CHANNEL_ID` | Optional lottery announcement channel. It must belong to the jar's server; otherwise the last channel with a swear jar message is used. Fines always reply in their original channel. |
| `SWEAR_JAR_WORDS` | Optional comma-separated replacement list. An explicitly empty value matches nothing. Omit it for the built-in list. |

The built-in list lives in `src/swearJar.js`. It uses whole-word matching,
case folding and Unicode normalization, with explicitly listed inflections.
For example, `shit` matches but `class`, `hello` and `Scunthorpe` do not. The list
includes mild terms such as `damn`, `hell` and `crap`, and words that can also have
innocent meanings such as `ass` and `cock`; customize it to your server's rules.
This is a word-list rule and does not infer context or catch every obfuscation.

MommyBot needs its existing Message Content intent and permission to view and
send messages in participating channels and threads. Linked members are checked
individually through Discord; a privileged full member-list intent is not needed.

## Persistence and recovery

`src/wallet/swearJar.js` keeps the guild schedule, one-coin debit entries, prize
reservations and notice flags in `data/online-wallet.db`. A Discord message ID
deduplicates fines. Every debit and credit has its own permanent provider request
ID and original account/API binding. Only verified coin receipts complete jobs.
Pending jobs compose with existing wallet guards and prevent unlinking until
settled. Pausing new fines does not discard these reservations.

Back up this database together with identity and other bot state. Never manually
clear a pending job or resend a prize with a new payment ID to recover a timeout.
Private `/lidollid wallet retry` recovers the caller's oldest swear jar payment
before trying other pending games; repeat if multiple payments need recovery.
Automatic retries continue even if sending a Discord notice fails. A crash after
Discord accepts a notice but before its flag is saved can repeat that notice;
the wallet operation remains idempotent.

Run `node --test test/swear-jar.test.js` for targeted checks or `npm test` for the
whole project. Tests use disposable databases and fake accounts; no live coins
or Discord messages are used.
