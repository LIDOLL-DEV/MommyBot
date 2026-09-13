import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export const ADOPTION_PRICES = Object.freeze({ stars: 1, coins: 25 });
export const PARTY_LIMIT = 6;
const MAX_BALANCE = 1_000_000_000;

export class TraderError extends Error {}

function currencyColumn(currency) {
  if (!Object.hasOwn(ADOPTION_PRICES, currency)) throw new TraderError("Choose stars or LiDollcoins.");
  return currency;
} // Whitelist currency names before inserting a column name into SQL.

export class TouhouStore {
  constructor(databasePath, catalog, { reservedOwner = "319254336402358272", now = Date.now } = {}) {
    this.db = new Database(databasePath);
    this.catalog = catalog;
    this.reservedOwner = reservedOwner;
    this.now = now;
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS wallets (
        guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
        stars INTEGER NOT NULL DEFAULT 0 CHECK(stars BETWEEN 0 AND ${MAX_BALANCE}),
        coins INTEGER NOT NULL DEFAULT 0 CHECK(coins BETWEEN 0 AND ${MAX_BALANCE}),
        PRIMARY KEY(guild_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS characters (
        guild_id TEXT NOT NULL, name TEXT NOT NULL, filename TEXT NOT NULL,
        base_rarity REAL NOT NULL DEFAULT 0, owner_id TEXT,
        trade_count INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(guild_id, name)
      );
      CREATE TABLE IF NOT EXISTS listings (
        guild_id TEXT NOT NULL, name TEXT NOT NULL, seller_id TEXT NOT NULL,
        price INTEGER NOT NULL CHECK(price > 0), PRIMARY KEY(guild_id, name)
      );
      CREATE TABLE IF NOT EXISTS trade_offers (
        id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, from_id TEXT NOT NULL, to_id TEXT NOT NULL,
        offered TEXT NOT NULL, requested TEXT NOT NULL, offered_revision INTEGER NOT NULL,
        requested_revision INTEGER NOT NULL, expires_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending'
      );
      CREATE TABLE IF NOT EXISTS receipts (
        guild_id TEXT NOT NULL, request_id TEXT NOT NULL, actor_id TEXT NOT NULL,
        operation TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(guild_id, request_id)
      );
      CREATE TABLE IF NOT EXISTS trader_history (
        id INTEGER PRIMARY KEY, guild_id TEXT NOT NULL, actor_id TEXT NOT NULL,
        operation TEXT NOT NULL, details TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS characters_owner ON characters(guild_id, owner_id);
    `);
  } // Keep balances, characters and receipts in one database so purchases can commit atomically.

  close() { this.db.close(); } // Release the SQLite connection during shutdown and test cleanup.

  ensureGuild(guildId) {
    if (!guildId) throw new TraderError("Use the Touhou trader in a server.");
    const insert = this.db.prepare(`INSERT OR IGNORE INTO characters
      (guild_id, name, filename, base_rarity, owner_id) VALUES (?, ?, ?, ?, ?)`);
    this.db.transaction(() => {
      for (const entry of this.catalog) {
        insert.run(guildId, entry.name, entry.filename, entry.baseRarity,
          entry.name === "Momiji Inubashiri" ? this.reservedOwner : null);
      }
    })();
  } // Seed each server independently without resetting balances or existing ownership on restart.

  wallet(guildId, userId) {
    this.ensureGuild(guildId);
    return this.db.prepare("SELECT stars, coins FROM wallets WHERE guild_id = ? AND user_id = ?").get(guildId, userId)
      || { stars: 0, coins: 0 };
  } // New players start with zero of both currencies.

  changeBalance(guildId, userId, currency, delta) {
    const column = currencyColumn(currency);
    if (!Number.isSafeInteger(delta) || Math.abs(delta) > MAX_BALANCE) throw new TraderError("Invalid currency amount.");
    this.db.prepare("INSERT OR IGNORE INTO wallets(guild_id, user_id) VALUES (?, ?)").run(guildId, userId);
    const result = this.db.prepare(`UPDATE wallets SET ${column} = ${column} + ?
      WHERE guild_id = ? AND user_id = ? AND ${column} + ? BETWEEN 0 AND ${MAX_BALANCE}`)
      .run(delta, guildId, userId, delta);
    if (!result.changes) throw new TraderError(delta < 0 ? `You do not have enough ${currency === "stars" ? "stars" : "LiDollcoins"}.` : "That wallet would exceed the balance limit.");
  } // Apply a bounded debit or credit; the caller's transaction rolls back all related changes on failure.

  mutate(guildId, actorId, requestId, operation, action) {
    this.ensureGuild(guildId);
    if (!actorId || !requestId) throw new TraderError("Missing transaction identity.");
    return this.db.transaction(() => {
      const old = this.db.prepare("SELECT * FROM receipts WHERE guild_id = ? AND request_id = ?").get(guildId, requestId);
      if (old) {
        if (old.actor_id !== actorId || old.operation !== operation) throw new TraderError("This action has already been used.");
        return JSON.parse(old.result);
      }
      const result = action();
      const encoded = JSON.stringify(result);
      this.db.prepare("INSERT INTO receipts VALUES (?, ?, ?, ?, ?)").run(guildId, requestId, actorId, operation, encoded);
      this.db.prepare("INSERT INTO trader_history(guild_id, actor_id, operation, details) VALUES (?, ?, ?, ?)")
        .run(guildId, actorId, operation, encoded);
      return result;
    }).immediate();
  } // Serialize competing writes and replay the original receipt instead of charging a repeated Discord interaction twice.

  award(guildId, actorId, recipientId, currency, amount, requestId) {
    currencyColumn(currency);
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1_000_000) throw new TraderError("Award between 1 and 1,000,000 units.");
    return this.mutate(guildId, actorId, requestId, `award:${recipientId}:${currency}:${amount}`, () => {
      this.changeBalance(guildId, recipientId, currency, amount);
      return { recipientId, currency, amount, wallet: this.wallet(guildId, recipientId) };
    });
  } // Record an administrator-authorized reward and its actor in the same transaction as the credit.

  resolveName(input) {
    const query = String(input || "").trim().toLowerCase();
    const exact = this.catalog.find((entry) => entry.name.toLowerCase() === query);
    if (exact) return exact.name;
    const short = this.catalog.filter((entry) => entry.name.split(/[\s_]/)[0].toLowerCase() === query);
    if (short.length === 1) return short[0].name;
    throw new TraderError("Unknown or ambiguous Touhou name. Use the full name from the market.");
  } // Preserve full-name lookup and unambiguous first-name shortcuts from LumiBot.

  character(guildId, name) {
    this.ensureGuild(guildId);
    const row = this.db.prepare("SELECT * FROM characters WHERE guild_id = ? AND name = ?").get(guildId, this.resolveName(name));
    if (!row) throw new TraderError("That Touhou is unavailable.");
    return row;
  } // Retrieve canonical character data scoped to the invoking server.

  collection(guildId, userId) {
    this.ensureGuild(guildId);
    return this.db.prepare("SELECT * FROM characters WHERE guild_id = ? AND owner_id = ? ORDER BY name").all(guildId, userId);
  } // List a player's collection without affecting balances.

  market(guildId) {
    this.ensureGuild(guildId);
    return this.db.prepare(`SELECT c.*, l.price, l.seller_id FROM characters c
      LEFT JOIN listings l ON l.guild_id = c.guild_id AND l.name = c.name
      WHERE c.guild_id = ? AND (c.owner_id IS NULL OR l.seller_id = c.owner_id) ORDER BY c.name`).all(guildId);
  } // Show both random-adoption stock and player listings.

  adopt(guildId, userId, currency, requestId) {
    currencyColumn(currency);
    return this.mutate(guildId, userId, requestId, `adopt:${currency}`, () => {
      if (this.collection(guildId, userId).length >= PARTY_LIMIT) throw new TraderError("Your six-Touhou party is full. Gift or release one first.");
      const selected = this.db.prepare("SELECT * FROM characters WHERE guild_id = ? AND owner_id IS NULL ORDER BY RANDOM() LIMIT 1").get(guildId);
      if (!selected) throw new TraderError("No Touhous are available for adoption right now.");
      const price = ADOPTION_PRICES[currency];
      this.changeBalance(guildId, userId, currency, -price);
      this.db.prepare("UPDATE characters SET owner_id = ?, revision = revision + 1 WHERE guild_id = ? AND name = ?")
        .run(userId, guildId, selected.name);
      return { character: this.character(guildId, selected.name), currency, price, wallet: this.wallet(guildId, userId) };
    });
  } // Charge exactly one chosen currency and assign one random unowned character in an indivisible transaction.

  owned(guildId, userId, name) {
    const character = this.character(guildId, name);
    if (character.owner_id !== userId) throw new TraderError("You no longer own that Touhou.");
    if (character.name === "Momiji Inubashiri" && userId === this.reservedOwner) throw new TraderError("Momiji stays in Doll's collection.");
    return character;
  } // Recheck ownership and LumiBot's reserved-character rule at the moment of every transfer.

  transfer(guildId, character, recipientId) {
    this.db.prepare("DELETE FROM listings WHERE guild_id = ? AND name = ?").run(guildId, character.name);
    this.db.prepare(`UPDATE characters SET owner_id = ?, trade_count = trade_count + 1,
      revision = revision + 1 WHERE guild_id = ? AND name = ?`).run(recipientId, guildId, character.name);
    return this.character(guildId, character.name);
  } // Move ownership, advance rarity and invalidate offers/listings based on older ownership.

  send(guildId, fromId, toId, name, requestId) {
    return this.mutate(guildId, fromId, requestId, `send:${toId}:${name}`, () => {
      if (fromId === toId) throw new TraderError("Choose someone other than yourself.");
      return { character: this.transfer(guildId, this.owned(guildId, fromId, name), toId) };
    });
  } // Gift an owned Touhou without charging either player.

  release(guildId, userId, name, requestId) {
    return this.mutate(guildId, userId, requestId, `release:${name}`, () => {
      const character = this.owned(guildId, userId, name);
      this.db.prepare("DELETE FROM listings WHERE guild_id = ? AND name = ?").run(guildId, character.name);
      this.db.prepare("UPDATE characters SET owner_id = NULL, revision = revision + 1 WHERE guild_id = ? AND name = ?")
        .run(guildId, character.name);
      return { name: character.name };
    });
  } // Return a character to adoption stock without minting currency or lowering its earned rarity.

  offer(guildId, fromId, toId, yours, theirs, requestId) {
    return this.mutate(guildId, fromId, requestId, `offer:${toId}:${yours}:${theirs}`, () => {
      if (fromId === toId) throw new TraderError("You cannot trade with yourself.");
      const a = this.owned(guildId, fromId, yours);
      const b = this.owned(guildId, toId, theirs);
      const id = randomUUID();
      this.db.prepare(`INSERT INTO trade_offers
        (id, guild_id, from_id, to_id, offered, requested, offered_revision, requested_revision, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, guildId, fromId, toId, a.name, b.name, a.revision, b.revision, this.now() + 60_000);
      return { id, offered: a.name, requested: b.name, toId };
    });
  } // Store a one-minute offer; creating the offer does not transfer either character.

  resolveOffer(guildId, actorId, id, accept, requestId) {
    return this.mutate(guildId, actorId, requestId, `offer-response:${id}:${accept}`, () => {
      const offer = this.db.prepare("SELECT * FROM trade_offers WHERE guild_id = ? AND id = ?").get(guildId, id);
      if (!offer || offer.to_id !== actorId) throw new TraderError("Only the invited player can respond to this trade.");
      if (offer.status !== "pending" || offer.expires_at <= this.now()) throw new TraderError("This trade has expired or is already resolved.");
      if (accept) {
        const a = this.owned(guildId, offer.from_id, offer.offered);
        const b = this.owned(guildId, offer.to_id, offer.requested);
        if (a.revision !== offer.offered_revision || b.revision !== offer.requested_revision) throw new TraderError("Ownership changed since this offer. Create a new trade.");
        this.transfer(guildId, a, offer.to_id);
        this.transfer(guildId, b, offer.from_id);
      }
      this.db.prepare("UPDATE trade_offers SET status = ? WHERE id = ?").run(accept ? "accepted" : "declined", id);
      return { accepted: accept, offered: offer.offered, requested: offer.requested };
    });
  } // Require the recipient's consent and swap both characters atomically after fresh ownership checks.

  list(guildId, userId, name, price, requestId) {
    if (!Number.isSafeInteger(price) || price < 1 || price > 1_000_000) throw new TraderError("Choose a price from 1 to 1,000,000 LiDollcoins.");
    return this.mutate(guildId, userId, requestId, `list:${name}:${price}`, () => {
      const character = this.owned(guildId, userId, name);
      this.db.prepare("INSERT OR REPLACE INTO listings VALUES (?, ?, ?, ?)").run(guildId, character.name, userId, price);
      return { name: character.name, price };
    });
  } // List a player-owned character at the seller's LiDollcoin price, separately from fixed-price adoption.

  delist(guildId, userId, name, requestId) {
    return this.mutate(guildId, userId, requestId, `delist:${name}`, () => {
      const character = this.owned(guildId, userId, name);
      this.db.prepare("DELETE FROM listings WHERE guild_id = ? AND name = ? AND seller_id = ?").run(guildId, character.name, userId);
      return { name: character.name };
    });
  } // Remove only a listing whose character still belongs to the requesting seller.

  buy(guildId, buyerId, name, requestId) {
    return this.mutate(guildId, buyerId, requestId, `buy:${name}`, () => {
      const character = this.character(guildId, name);
      const listing = this.db.prepare("SELECT * FROM listings WHERE guild_id = ? AND name = ?").get(guildId, character.name);
      if (!listing || listing.seller_id !== character.owner_id) throw new TraderError("That listing is no longer available.");
      if (listing.seller_id === buyerId) throw new TraderError("You cannot buy your own listing.");
      this.owned(guildId, listing.seller_id, character.name);
      this.changeBalance(guildId, buyerId, "coins", -listing.price);
      this.changeBalance(guildId, listing.seller_id, "coins", listing.price);
      return { character: this.transfer(guildId, character, buyerId), price: listing.price, sellerId: listing.seller_id };
    });
  } // Debit the buyer, pay the seller and transfer ownership together, or roll back everything.
}
