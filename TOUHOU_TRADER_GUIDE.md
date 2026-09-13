# Touhou Trader

MommyBot now includes the collection/trading part of LumiBot's Touhou system,
with its 169 character images, rarity seed, random adoption, server-specific
ownership, gifts, consenting swaps and player listings.

**One random adoption costs either 1 star or 25 LiDollcoins.** Select one currency;
the trader never deducts both or silently switches payment methods. Each
character has one owner per server, and random draws stop at six owned Touhous.
As in LumiBot, gifts and player purchases may take a collection above six.
Momiji Inubashiri stays reserved for Doll (`319254336402358272`).

## Getting started

Run the Fedora updater after these changes are in your upstream branch. It now
includes `assets/` in releases. Restarting the bot registers `/touhou` in each
server without replacing other application commands. The bot needs the
`applications.commands` scope, View Channel, Send Messages, Embed Links and
Attach Files permissions. Trader commands obey the existing `CHANNEL_ID` gate.

Use `/touhou menu` or `!touhou`. The menu shows your wallet and has separate
**Adopt · 1 star** and **Adopt · 25 LiDollcoins** buttons. Each menu can complete
one purchase; open a fresh menu to adopt again. Only the player who opened it can
use its buttons. `!lumi-touhou` and `!2hu` are supported aliases.

MommyBot tracks **local balances per server**, starting at zero. These are not
LumiBot's SGC balances, an external coin service or starboard reaction counts.
To award existing earned currency, a member with **Manage Server** can use:

```text
/touhou award user:@player currency:Stars amount:1
/touhou award user:@player currency:LiDollcoins amount:25
```

You may set `TOUHOU_ADMIN_ROLE_ID` in `.env` to allow an additional role to award
currency. Every award is recorded with the administrator's user ID. Ordinary
players cannot mint their own balance. Automatic earning rules and imports of
old balances are not enabled.

## Commands

| Command | Result |
| --- | --- |
| `/touhou adopt payment:1 star` | Pay one star for a random unowned Touhou |
| `/touhou adopt payment:25 LiDollcoins` | Pay 25 coins for a random unowned Touhou |
| `/touhou wallet [user]` | Show both local balances |
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

Prefix shortcuts: `!touhou adopt star`, `!touhou adopt coins`,
`!touhou collection [page]`, `!touhou market [page]`, `!touhou wallet` and
`!touhou info Full Name`. Gifting, swaps, listings and awards use slash commands.
Full names work everywhere; a first name works when it identifies just one
character. Stock is random: the fixed adoption price does not buy a named
character that another player owns. Player listings have their own asking price.

This port covers the trader and collection system. LumiBot's battles, potions,
SGC bank, trading taxes and SGC buyback payouts are not part of MommyBot's local
economy. Free release supplies a way to open a party slot without creating an
unrequested conversion from stars to coins.

## Persistence and recovery

All balances, ownership, listings, one-minute trade offers, receipts and audit
history live together in `data/touhou-trader.db`. On Fedora this resolves to
`/var/lib/mommybot/data/touhou-trader.db`, which existing deployment backups cover.
Payment and ownership changes use one SQLite transaction; an error rolls back
both. Duplicate delivery of the same command reuses its receipt. Stale offers
cannot trade characters that have changed hands since the offer was created.

Restarting or updating retains wallets and collections. Back up/restore the
entire trader database with the service stopped, including WAL/SHM files if
present. Keep this database separate from LumiBot's live databases. Images and
rarity metadata are copied assets; no LumiBot database or secret is imported.
Set `TOUHOU_ENABLED=false` to disable handler initialization on restart; any
previously registered slash command remains visible until removed in Discord.

Artwork and the seed were copied from `C:\Scripts\LumiBot\touhous` and
`C:\Scripts\LumiBot\data\touhou-rarity-seed.json`. The seed retains its original
source metadata. Do not substitute live account databases for these asset files.
