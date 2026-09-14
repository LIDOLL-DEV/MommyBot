import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { FAINT_DURATION_MS } from "./battleRules.js";

export const ADOPTION_PRICES = Object.freeze({ stars: 1, coins: 25 });
export const PARTY_LIMIT = 6;
export const MOMIJI_OWNER_ID = "319254336402358272";
const MOMIJI_NAME = "Momiji Inubashiri";
const MAX_BALANCE = 1_000_000_000;

export class TraderError extends Error {}

function currencyColumn(currency) {
  if (!Object.hasOwn(ADOPTION_PRICES, currency)) throw new TraderError("Choose stars or LiDollcoins.");
  return currency;
} // Whitelist currency names before inserting a column name into SQL.

export class TouhouStore {
  constructor(databasePath, catalog, { now = Date.now } = {}) {
    this.db = new Database(databasePath);
    this.catalog = catalog;
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
      CREATE TABLE IF NOT EXISTS online_adoptions (
        id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, request_id TEXT NOT NULL,
        name TEXT NOT NULL, revision INTEGER NOT NULL, currency TEXT NOT NULL, price INTEGER NOT NULL,
        account_id TEXT NOT NULL, base_url TEXT NOT NULL, client_id TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'debit', result TEXT, attempted INTEGER NOT NULL DEFAULT 0,
        UNIQUE(guild_id, request_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS online_reserved_character ON online_adoptions(guild_id,name)
        WHERE state IN ('debit','paid','refund');
      CREATE UNIQUE INDEX IF NOT EXISTS online_pending_user ON online_adoptions(user_id)
        WHERE state IN ('debit','paid','refund');
      CREATE TABLE IF NOT EXISTS online_economy (
        id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, request_id TEXT NOT NULL,
        operation TEXT NOT NULL, args TEXT NOT NULL, state TEXT NOT NULL, result TEXT, guard TEXT,
        UNIQUE(guild_id, request_id)
      );
      CREATE TABLE IF NOT EXISTS online_economy_payments (
        id TEXT PRIMARY KEY, job_id TEXT NOT NULL, user_id TEXT NOT NULL,
        account_id TEXT NOT NULL, base_url TEXT NOT NULL, client_id TEXT NOT NULL,
        kind TEXT NOT NULL, amount INTEGER NOT NULL, attempted INTEGER NOT NULL DEFAULT 0,
        confirmed INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS online_payment_user ON online_economy_payments(user_id,job_id);
      CREATE TABLE IF NOT EXISTS online_economy_locks (
        guild_id TEXT NOT NULL, name TEXT NOT NULL, job_id TEXT NOT NULL, PRIMARY KEY(guild_id,name)
      );
      CREATE TABLE IF NOT EXISTS trader_history (
        id INTEGER PRIMARY KEY, guild_id TEXT NOT NULL, actor_id TEXT NOT NULL,
        operation TEXT NOT NULL, details TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS characters_owner ON characters(guild_id, owner_id);
      CREATE TABLE IF NOT EXISTS battle_profiles (
        guild_id TEXT NOT NULL, name TEXT NOT NULL, level INTEGER NOT NULL DEFAULT 1,
        exp INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0,
        fainted_until INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(guild_id, name)
      );
      CREATE TABLE IF NOT EXISTS battle_inventory (
        guild_id TEXT NOT NULL, user_id TEXT NOT NULL, potions INTEGER NOT NULL DEFAULT 0 CHECK(potions BETWEEN 0 AND 10),
        PRIMARY KEY(guild_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS battles (
        id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, name TEXT NOT NULL,
        character_revision INTEGER NOT NULL, state TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
        turn INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS one_battle_per_player ON battles(guild_id, user_id) WHERE status = 'active';
      CREATE UNIQUE INDEX IF NOT EXISTS one_battle_per_character ON battles(guild_id, name) WHERE status = 'active';
    `);
    this.db.transaction(() => {
      this.db.prepare(`UPDATE characters SET owner_id = ?, revision = revision + 1
        WHERE name = ? AND owner_id IS NOT ?`).run(MOMIJI_OWNER_ID, MOMIJI_NAME, MOMIJI_OWNER_ID);
      this.db.prepare("DELETE FROM listings WHERE name = ?").run(MOMIJI_NAME);
      this.db.prepare(`UPDATE trade_offers SET status = 'cancelled'
        WHERE status = 'pending' AND (offered = ? OR requested = ?)`).run(MOMIJI_NAME, MOMIJI_NAME);
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS momiji_owner_insert BEFORE INSERT ON characters
        WHEN NEW.name = '${MOMIJI_NAME}' AND NEW.owner_id IS NOT '${MOMIJI_OWNER_ID}'
        BEGIN SELECT RAISE(ABORT, 'Momiji is reserved for ${MOMIJI_OWNER_ID}'); END;
        CREATE TRIGGER IF NOT EXISTS momiji_owner_update BEFORE UPDATE ON characters
        WHEN (OLD.name = '${MOMIJI_NAME}' OR NEW.name = '${MOMIJI_NAME}')
          AND (NEW.name != '${MOMIJI_NAME}' OR NEW.owner_id IS NOT '${MOMIJI_OWNER_ID}')
        BEGIN SELECT RAISE(ABORT, 'Momiji is reserved for ${MOMIJI_OWNER_ID}'); END;
      `); // Enforce the fixed owner in SQLite as well as in command handlers.
    }).immediate(); // Repair legacy ownership and cancel old Momiji listings/offers before accepting requests.
  } // Keep balances, characters and receipts in one database so purchases can commit atomically.

  close() { this.db.close(); } // Release the SQLite connection during shutdown and test cleanup.

  expireBattles() {
    this.db.transaction(() => {
      const expired = this.db.prepare("SELECT * FROM battles WHERE status = 'active' AND expires_at <= ?").all(this.now());
      for (const battle of expired) {
        const state = JSON.parse(battle.state);
        state.outcome = "timeout";
        state.log.push("Battle expired after 90 seconds without an action. Your Touhou needs a ten-minute rest.");
        this.db.prepare("UPDATE battles SET status = 'timeout', state = ? WHERE id = ?").run(JSON.stringify(state), battle.id);
        this.db.prepare(`UPDATE battle_profiles SET losses = losses + 1, fainted_until = ?
          WHERE guild_id = ? AND name = ?`).run(battle.expires_at + FAINT_DURATION_MS, battle.guild_id, battle.name);
      }
    }).immediate();
  } // Settle idle fights once, measuring recovery from the actual expiry even after a restart.

  assertNotBattling(guildId, name) {
    this.assertNotPaying(guildId, name);
    this.expireBattles();
    if (this.db.prepare("SELECT id FROM battles WHERE guild_id = ? AND name = ? AND status = 'active'").get(guildId, name)) {
      throw new TraderError("Finish or run from this Touhou's battle before trading, selling or releasing it.");
    }
  } // Prevent ownership changes or buybacks while a fight still controls the character.

  assertNotPaying(guildId, name) {
    const lock = this.db.prepare("SELECT job_id FROM online_economy_locks WHERE guild_id=? AND name=?").get(guildId, name);
    if (lock && lock.job_id !== this.paymentJob) throw new TraderError("This Touhou has a pending wallet payment. Finish it with /lidollid wallet retry first.");
  } // Reserve a character through a purchase so gifts, repricing and battles cannot race its debit.

  ensureGuild(guildId) {
    if (!guildId) throw new TraderError("Use the Touhou trader in a server.");
    const insert = this.db.prepare(`INSERT OR IGNORE INTO characters
      (guild_id, name, filename, base_rarity, owner_id) VALUES (?, ?, ?, ?, ?)`);
    this.db.transaction(() => {
      for (const entry of this.catalog) {
        insert.run(guildId, entry.name, entry.filename, entry.baseRarity,
          entry.name === MOMIJI_NAME ? MOMIJI_OWNER_ID : null);
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
    if (this.balanceHandler) return this.balanceHandler(guildId, userId, currency, delta);
    if (this.onlineEconomy) throw new TraderError("This action must use the online LiDollcoin payment service.");
    if (this.db.prepare(`SELECT 1 FROM online_economy j LEFT JOIN online_economy_payments p ON p.job_id=j.id
      WHERE (j.user_id=? OR p.user_id=?) AND j.state IN ('debit','paid','credit','refund')`).get(userId, userId)) {
      throw new TraderError("Finish the pending online payment before changing this wallet.");
    } // A disabled integration must not let local transactions bypass an unsettled online payment.
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
      WHERE c.guild_id = ? AND (c.owner_id IS NULL OR l.seller_id = c.owner_id)
      AND NOT EXISTS (SELECT 1 FROM online_adoptions a WHERE a.guild_id=c.guild_id AND a.name=c.name
        AND a.state IN ('debit','paid','refund')) ORDER BY c.name`).all(guildId);
  } // Show both random-adoption stock and player listings.

  adopt(guildId, userId, currency, requestId) {
    currencyColumn(currency);
    return this.mutate(guildId, userId, requestId, `adopt:${currency}`, () => {
      if (this.db.prepare("SELECT 1 FROM online_adoptions WHERE (user_id=? AND state IN ('debit','paid','refund')) OR (guild_id=? AND request_id=?)").get(userId, guildId, requestId)) {
        throw new TraderError("This adoption uses the online wallet. Enable it and use /lidollid wallet retry to finish pending payments.");
      } // Keep online reservations protected even if the operator temporarily disables the wallet feature.
      if (this.collection(guildId, userId).length >= PARTY_LIMIT) throw new TraderError("Your six-Touhou party is full. Gift or release one first.");
      const selected = this.db.prepare(`SELECT * FROM characters c WHERE guild_id = ? AND owner_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM online_adoptions a WHERE a.guild_id=c.guild_id AND a.name=c.name
          AND a.state IN ('debit','paid','refund')) ORDER BY RANDOM() LIMIT 1`).get(guildId);
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
    if (character.name === MOMIJI_NAME) throw new TraderError("Momiji stays in Doll's collection (319254336402358272).");
    this.assertNotBattling(guildId, character.name);
    return character;
  } // Recheck ownership and LumiBot's reserved-character rule at the moment of every transfer.

  transfer(guildId, character, recipientId) {
    this.assertNotBattling(guildId, character.name);
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
      this.db.prepare("DELETE FROM battle_profiles WHERE guild_id = ? AND name = ?").run(guildId, character.name);
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

  buy(guildId, buyerId, name, requestId, expectedListing) {
    return this.mutate(guildId, buyerId, requestId, `buy:${name}`, () => {
      const character = this.character(guildId, name);
      const listing = this.db.prepare("SELECT * FROM listings WHERE guild_id = ? AND name = ?").get(guildId, character.name);
      if (!listing || listing.seller_id !== character.owner_id) throw new TraderError("That listing is no longer available.");
      if (expectedListing && (listing.price !== expectedListing.price || listing.seller_id !== expectedListing.sellerId)) {
        throw new TraderError("This listing changed. Review its new price before buying.");
      } // Validate the confirmed quote inside the transaction, including when another bot process updates a listing.
      if (listing.seller_id === buyerId) throw new TraderError("You cannot buy your own listing.");
      this.owned(guildId, listing.seller_id, character.name);
      this.changeBalance(guildId, buyerId, "coins", -listing.price);
      this.changeBalance(guildId, listing.seller_id, "coins", listing.price);
      return { character: this.transfer(guildId, character, buyerId), price: listing.price, sellerId: listing.seller_id };
    });
  } // Debit the buyer, pay the seller and transfer ownership together, or roll back everything.
}
