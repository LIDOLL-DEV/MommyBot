# Touhou Trader

MommyBot includes LumiBot's clickable Touhou trader and PvE battle gameplay,
with 169 character images, rarity and attack seeds, random adoption, per-server
ownership, gifts, consenting swaps, player listings, potions, healing and buybacks.

**One random adoption costs either 1 star or 25 LiDollcoins.** Select one currency;
the trader never deducts both or silently switches payment methods. Each
character has one owner per server, and random draws stop at six owned Touhous.
As in LumiBot, gifts and player purchases may take a collection above six.
Momiji Inubashiri stays reserved for Doll (`319254336402358272`).
That ID is fixed: Momiji cannot be adopted, gifted, sold, swapped or released.
On startup, any older Momiji record with another owner (or no owner) is reassigned
to this ID, and existing Momiji listings and pending swaps are cancelled.
SQLite also prevents assigning her to any other account.

## Getting started

Run the Fedora updater after these changes are in your upstream branch. It now
includes `assets/` in releases. Restarting the bot registers `/touhou` in each
server without replacing other application commands. The bot needs the
`applications.commands` scope, View Channel, Send Messages, Embed Links and
Attach Files permissions. Trader commands obey the existing `CHANNEL_ID` gate.

Use `/touhou menu` or `!touhou`. The menu shows your wallet and has separate
**Adopt · 1 star** and **Adopt · 25 LiDollcoins** buttons. The same message updates
after each action. Fresh buttons allow another adoption; repeated clicks on old
buttons cannot charge twice. Only the player who opened a menu can use it, and it
expires after five idle minutes. `!lumi-touhou` and `!2hu` are supported aliases.

The main buttons lead to **Battle**, **My party**, **Market & items**, and **Heal**.
Use character dropdowns and Previous/Next buttons to browse large collections.
Market & items contains clickable listings, adoption stock, potion purchases,
listing creation, delisting, buyback, gifts and swaps. Sale prices are entered in
a Discord modal. Gifts, swaps, purchases, buybacks and healing have confirmation
screens; swap recipients receive their own Accept/Decline buttons. A listing's
price and seller must still match the confirmed quote when payment commits.

Enable the Little Log wallet integration using [ONLINE_WALLET_GUIDE.md](ONLINE_WALLET_GUIDE.md)
to show and spend existing online stars or LiDollcoins for adoption. Players use
`/lidollid wallet connect` once to approve both currencies. The menu's **Online
balance** button and `/touhou wallet` show fresh balances privately. All adoption
entry points use the online wallet when enabled; they never fall back to local
currency if a connection is missing or a payment fails.

With online wallets disabled, adoption uses **local balances per server**,
starting at zero. Market purchases, items, healing, rewards and buybacks still
use local coins in either mode. Local balances are separate from Little Log and
starboard reactions. A member with **Manage Server** can award local currency:

```text
/touhou award user:@player currency:Stars amount:1
/touhou award user:@player currency:LiDollcoins amount:25
```

You may set `TOUHOU_ADMIN_ROLE_ID` in `.env` to allow an additional role to award
currency. Every award is recorded with the administrator's user ID. Ordinary
players cannot use admin rewards. Players can earn LiDollcoins through battle
victories, sales and trader buybacks. Imports of old balances are not enabled.

## Commands

| Command | Result |
| --- | --- |
| `/touhou adopt payment:1 star` | Pay one star for a random unowned Touhou |
| `/touhou adopt payment:25 LiDollcoins` | Pay 25 coins for a random unowned Touhou |
| `/touhou wallet [user]` | Show your private online balance when enabled; otherwise show local balances |
| `/touhou collection [user] [page]` | Browse a player's collection |
| `/touhou market [page]` | Browse adoption stock and player listings |
| `/touhou info name` | Show artwork, rarity and owner |
| `/touhou send name user` | Give your Touhou to another server member |
| `/touhou trade yours user theirs` | Request a swap; recipient has one minute to accept |
| `/touhou sell name price` | List a character at your LiDollcoin asking price |
| `/touhou delist name` | Remove your listing |
| `/touhou buy name` | Pay the seller the listing's current coin price |
| `/touhou release name confirm:true` | Return a character without a currency refund |
| `/touhou award user currency amount` | Award currency with the required admin permissions |
| `/touhou party` | Open character levels, EXP, attacks and cooldowns |
| `/touhou battle name rarity` | Start a battle with one of your characters |
| `/touhou potions [amount]` | Buy potions for 20 coins each, up to 10 held |
| `/touhou heal name [pay]` | Heal freely after recovery, or explicitly pay 50 coins early |
| `/touhou buyback name confirm:true` | Return a character for coins and reset its battle progression |

Prefix shortcuts: `!touhou adopt star`, `!touhou adopt coins`,
`!touhou collection [page]`, `!touhou market [page]`, `!touhou wallet` and
`!touhou info Full Name`. `!touhou battle`, `!touhou party`, `!touhou heal`,
`!touhou potions` and `!touhou shop` open the matching interactive screens.
The full menu supports gifting, swaps and listings; admin awards use slash commands.
Full names work everywhere; a first name works when it identifies just one
character. Stock is random: the fixed adoption price does not buy a named
character that another player owns. Player listings have their own asking price.

## Battle rules

Choose **Battle**, select a ready party member, then pick Common, Uncommon, Rare,
Epic, Legendary or **Gamble**. Opponents are PvE copies around your character's
level (plus or minus two, bounded to levels 1–50); their real ownership never
changes. If a tier has no candidates, the battle explains that another tier was
used. Momiji can battle and heal for her fixed owner while remaining untradeable.

Each turn offers up to three seeded attacks, **Defend**, **Use potion**, and
**Run**. Speed sets attack order. Accuracy, elemental advantages, attack power
and defense determine damage; defending halves incoming damage and slightly
reduces enemy accuracy. Running succeeds 75% of the time; a failed escape gives
the enemy an attack. A potion restores 50% maximum HP and uses the player's turn.
Full-health or empty-inventory potion requests do not consume a potion or turn.

Wins grant EXP and LiDollcoins based on enemy level and rarity. Gamble adds 20%
to both rewards. Each level needs `20 + currentLevel * 15` EXP, up to level 50;
every five levels also improves rarity and suggested value. Defeat or 90 seconds
without a valid battle action causes a ten-minute recovery period. Healing is
free after that period, or 50 coins early after explicit confirmation. Successful
escape awards nothing and does not cause fainting.

One fight can be active per player per server. Use **Battle** to resume it after
navigating away. Active fighters cannot be gifted, swapped, sold, released or
bought back. Character levels follow gifts and sales. Buyback pays two-thirds
of suggested value, preserves trade-based rarity and clears battle progression.
Free release remains available through its slash command. All rewards and
buybacks use local LiDollcoins; the original external SGC bank and taxes are not
connected.

## Persistence and recovery

All balances, ownership, listings, one-minute trade offers, battle progress,
potions, cooldowns, receipts and audit history live together in
`data/touhou-trader.db`. On Fedora this resolves to
`/var/lib/mommybot/data/touhou-trader.db`, which existing deployment backups cover.
Payment and ownership changes use one SQLite transaction; an error rolls back
both. Duplicate delivery of the same command reuses its receipt. Stale offers
cannot trade characters that have changed hands since the offer was created.

Battle turns, potion consumption, EXP and rewards commit together, and repeated
or stale turns cannot pay out again. Menu sessions expire on restart; open a new
menu to resume the saved fight. Its 90-second deadline continues while the bot
is offline. Idle battles are settled when next accessed, with recovery measured
from the original expiry time rather than the restart time.

Restarting or updating retains wallets and collections. Back up/restore the
entire trader database with the service stopped, including WAL/SHM files if
present. Keep this database separate from LumiBot's live databases. Images and
rarity/attack metadata are copied assets; no LumiBot database or secret is imported.
Set `TOUHOU_ENABLED=false` to disable handler initialization on restart; any
previously registered slash command remains visible until removed in Discord.

Artwork and the seed were copied from `C:\Scripts\LumiBot\touhous` and
`C:\Scripts\LumiBot\data\touhou-rarity-seed.json`. The attack seed comes from
`C:\Scripts\LumiBot\data\touhou-attacks-seed.json`. Seeds retain their original
source metadata. Do not substitute live account databases for these asset files.
