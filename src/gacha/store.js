import Database from "better-sqlite3";
import { randomInt, randomUUID } from "node:crypto";
import { WalletError } from "../wallet/client.js";
import { tiers } from "./catalog.js";

export class GachaError extends Error {}

export class DiaperStore {
  constructor(filename, catalog, wallet, config, draw = randomInt) {
    this.db = new Database(filename);
    this.db.pragma("journal_mode = WAL");
    this.wallet = wallet; this.config = config; this.draw = draw; this.catalog = catalog;
    this.db.exec(`CREATE TABLE IF NOT EXISTS diaper_designs(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS diaper_items(id TEXT PRIMARY KEY,design TEXT NOT NULL,owner TEXT,lock_id TEXT,created INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS diaper_owner ON diaper_items(owner,design);
      CREATE TABLE IF NOT EXISTS diaper_jobs(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,request_id TEXT NOT NULL,
        action TEXT NOT NULL,design TEXT NOT NULL,item_id TEXT NOT NULL,amount INTEGER NOT NULL,
        account_id TEXT NOT NULL,base_url TEXT NOT NULL,client_id TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'pending',attempted INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL,
        UNIQUE(user_id,request_id));
      CREATE INDEX IF NOT EXISTS diaper_pending ON diaper_jobs(user_id,state);`);
    const seed = this.db.prepare("INSERT INTO diaper_designs VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data");
    this.db.transaction(() => { for (const item of catalog) seed.run(item.id, JSON.stringify(item)); })();
    const previous = wallet.hasPending;
    wallet.hasPending = user => previous(user) || Boolean(this.pending(user));
    wallet[config.walletKey === "clothes" ? "clothes" : "gacha"] = this; // Separate journals share the existing wallet lock and recovery guard.
  } // Keep reservations, payment receipts and ownership together; compose with every other game's pending-payment guard.

  pending(user) { return this.db.prepare("SELECT * FROM diaper_jobs WHERE user_id=? AND state IN ('pending','paid') ORDER BY created LIMIT 1").get(user); }
  job(id) { return this.db.prepare("SELECT * FROM diaper_jobs WHERE id=?").get(id); }
  design(id) { const row = this.db.prepare("SELECT data FROM diaper_designs WHERE id=?").get(id); return row ? JSON.parse(row.data) : null; }
  availableDesign(id) { return this.config.walletKey !== "clothes" || this.catalog.some(item => item.id === id); } // Retired clothing stays in payment history but cannot re-enter the live shop.
  prices(item) {
    const stock = this.db.prepare("SELECT COUNT(*) quantity FROM diaper_items WHERE design=? AND owner IS NULL").get(item.id).quantity;
    const startingPrice = Math.max(3, Math.floor(this.config.price * tiers[item.rarity].buy));
    const buyAt = quantity => Math.max(2, Math.floor(startingPrice * 8 / (8 + Math.max(1, quantity) - 1)));
    return { stock, buy: buyAt(stock), sell: Math.max(1, Math.floor(buyAt(stock + 1) / 2)) };
  } // More bank copies reduce the quote. Sell at half the post-deposit buy quote so a buy/sell cycle cannot create coins.
  pick() {
    let value = this.draw(100), rarity;
    for (const [key, tier] of Object.entries(tiers)) { value -= tier.chance; if (value < 0) { rarity = key; break; } }
    const choices = this.catalog.filter(item => item.rarity === rarity);
    return choices[this.draw(choices.length)];
  } // Use cryptographic randomness, with injectable bounded draws for deterministic economic tests.
  snapshot(user) {
    const owned = this.db.prepare("SELECT design,COUNT(*) quantity,SUM(lock_id IS NULL) available FROM diaper_items WHERE owner=? GROUP BY design").all(user).filter(row => this.availableDesign(row.design));
    const bank = this.db.prepare("SELECT design,COUNT(*) quantity FROM diaper_items WHERE owner IS NULL AND lock_id IS NULL GROUP BY design").all().filter(row => this.availableDesign(row.design));
    const catalog = this.db.prepare("SELECT data FROM diaper_designs ORDER BY id").all().map(row => JSON.parse(row.data)).filter(item => this.availableDesign(item.id)).map(item => {
      const tier = tiers[item.rarity];
      const count = this.catalog.filter(entry => entry.rarity === item.rarity).length;
      return { ...item, ...this.prices(item), chance: this.catalog.some(entry => entry.id === item.id) ? tier.chance / count : 0 };
    });
    const pending = this.pending(user);
    const history = this.db.prepare("SELECT id,action,design,amount,created FROM diaper_jobs WHERE user_id=? AND state='done' ORDER BY rowid DESC LIMIT 12").all(user);
    return { catalog, owned, bank, history, tiers, rollPrice: this.config.price, enabled: this.config.enabled,
      pending: pending ? { action: pending.action, amount: pending.amount } : null };
  } // Return only this player's collection/history; reserve stock and unrevealed rolls stay private until payment is confirmed.

  async act(user, action, design, request, quotedAmount = null) {
    if (!["roll", "sell", "buy"].includes(action) || !/^[\w-]{16,80}$/.test(request || "") ||
        (action !== "roll" && !/^[a-z0-9-]{1,80}$/.test(design || ""))) throw new GachaError("Invalid game action. Refresh the page and try again.");
    return this.wallet.exclusive(user, async () => {
      const existing = this.db.prepare("SELECT * FROM diaper_jobs WHERE user_id=? AND request_id=?").get(user, request);
      if (existing) {
        if (existing.action !== action || (action !== "roll" && existing.design !== design)) throw new GachaError("This request already belongs to another action.");
        return this.settle(existing);
      }
      if (!this.config.enabled) throw new GachaError("New rolls and bank trades are paused. Your collection and payment recovery remain available.");
      if (this.wallet.hasPending(user)) throw new GachaError("Finish your pending payment first. Use Retry payment here or /lidollid wallet retry in Discord.");
      const account = this.wallet.requireConnection(user);
      const job = this.db.transaction(() => {
        const item = action === "roll" ? this.pick() : this.design(design);
        if (!item || !this.availableDesign(item.id)) throw new GachaError("That design is not available.");
        const stock = action === "roll" ? null : action === "sell"
          ? this.db.prepare("SELECT * FROM diaper_items WHERE owner=? AND design=? AND lock_id IS NULL ORDER BY created LIMIT 1").get(user, item.id)
          : this.db.prepare("SELECT * FROM diaper_items WHERE owner IS NULL AND design=? AND lock_id IS NULL ORDER BY created LIMIT 1").get(item.id);
        if (action !== "roll" && !stock) throw new GachaError(action === "sell" ? "You have no available copy to sell." : "Someone bought the last available copy. Refresh the bank.");
        const id = randomUUID(), itemId = stock?.id || randomUUID();
        const amount = action === "roll" ? this.config.price : this.prices(item)[action];
        if (quotedAmount !== null && quotedAmount !== amount) throw new GachaError("The price changed. Refresh and review the new price before trying again.");
        this.db.prepare(`INSERT INTO diaper_jobs(id,user_id,request_id,action,design,item_id,amount,account_id,base_url,client_id,created)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, user, request, action, item.id, itemId, amount, account.account_id, account.base_url, account.client_id, Date.now());
        if (stock) this.db.prepare("UPDATE diaper_items SET lock_id=? WHERE id=?").run(id, stock.id);
        return this.job(id);
      }).immediate();
      return this.settle(job);
    });
  } // Reserve a specific bank/owned copy and pin its price/account before making any external wallet request.

  async retry(user) {
    return this.wallet.exclusive(user, async () => {
      const job = this.pending(user);
      if (!job) throw new GachaError("No diaper payment is waiting.");
      return this.settle(job);
    });
  } // Recovery always resumes the original job and never draws a replacement prize.

  result(job) { return { action: job.action, amount: job.amount, item: this.design(job.design), id: job.id }; }
  async settle(saved) {
    let job = this.job(saved.id);
    if (job.state === "done") return this.result(job);
    if (job.state === "failed") throw new GachaError("This payment was declined. Check your balance, then start a new action.");
    if (job.state === "pending") {
      const account = this.wallet.requireConnection(job.user_id);
      if (account.account_id !== job.account_id || account.base_url !== job.base_url || account.client_id !== job.client_id) {
        throw new GachaError("Reconnect the original wallet account to finish this diaper payment.");
      }
      const wasAttempted = Boolean(job.attempted), kind = job.action === "sell" ? "credit" : "debit";
      this.db.prepare("UPDATE diaper_jobs SET attempted=1 WHERE id=?").run(job.id);
      try {
        const receipt = await this.wallet.client.operation(account.token, { request_id: job.id, kind, asset: "coins", amount: job.amount });
        if (receipt.request_id !== job.id || receipt.kind !== kind || receipt.amount !== job.amount || receipt.currency !== "LiDollCoin" ||
            (receipt.asset !== undefined && receipt.asset !== "coins") || !Number.isSafeInteger(receipt.balance) || receipt.balance < 0) {
          throw new GachaError("The wallet receipt could not be verified. Retry this payment before doing anything else.");
        }
      } catch (error) {
        if (!wasAttempted && error instanceof WalletError && [400, 403, 409].includes(error.status)) {
          this.db.transaction(() => {
            this.db.prepare("UPDATE diaper_jobs SET state='failed' WHERE id=?").run(job.id);
            this.db.prepare("UPDATE diaper_items SET lock_id=NULL WHERE lock_id=?").run(job.id);
          }).immediate();
        }
        throw error;
      } // Uncertain responses retain the reservation; a first definitive rejection releases it without giving items or coins.
      this.db.prepare("UPDATE diaper_jobs SET state='paid' WHERE id=?").run(job.id);
    }
    this.db.transaction(() => {
      job = this.job(job.id);
      if (job.state === "done") return;
      if (job.state !== "paid") throw new GachaError("This payment must finish before delivery.");
      if (job.action === "roll") {
        this.db.prepare("INSERT INTO diaper_items VALUES (?,?,?,NULL,?)").run(job.item_id, job.design, job.user_id, Date.now());
      } else {
        const result = this.db.prepare("UPDATE diaper_items SET owner=?,lock_id=NULL WHERE id=? AND lock_id=? AND owner IS ?")
          .run(job.action === "sell" ? null : job.user_id, job.item_id, job.id, job.action === "sell" ? job.user_id : null);
        if (result.changes !== 1) throw new GachaError("The reserved diaper needs operator recovery. Your payment remains recorded.");
      }
      this.db.prepare("UPDATE diaper_jobs SET state='done' WHERE id=?").run(job.id);
    }).immediate();
    return this.result(job);
  } // Apply ownership and mark delivery atomically after payment; storage failures retain the paid job for safe retry.
  close() { this.db.close(); }
}
