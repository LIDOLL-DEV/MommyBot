import { randomUUID } from "node:crypto";
import { ADOPTION_PRICES, PARTY_LIMIT, TraderError } from "../touhou/store.js";
import { WalletError } from "./client.js";

export class OnlineAdoptions {
  constructor(store, wallet) {
    this.store = store; this.db = store.db; this.wallet = wallet;
    wallet.hasPending = user => Boolean(this.pending(user));
    wallet.adoptions = this;
  } // Keep the payment journal and delivered character in the same SQLite transaction.
  pending(user) {
    return this.db.prepare("SELECT * FROM online_adoptions WHERE user_id=? AND state IN ('debit','paid','refund')").get(user);
  }
  async adopt(guild, user, currency, request) {
    if (!Object.hasOwn(ADOPTION_PRICES, currency)) throw new TraderError("Choose stars or LiDollcoins.");
    return this.wallet.exclusive(user, async () => {
      this.store.ensureGuild(guild);
      const connection = this.wallet.requireConnection(user);
      const job = this.db.transaction(() => {
        const old = this.db.prepare("SELECT * FROM online_adoptions WHERE guild_id=? AND request_id=?").get(guild, request);
        if (old) {
          if (old.user_id !== user || old.currency !== currency) throw new TraderError("This action has already been used.");
          return old;
        }
        if (this.wallet.hasPending(user)) throw new TraderError("Finish your earlier adoption or payment with /lidollid wallet retry before buying another.");
        if (this.db.prepare("SELECT 1 FROM receipts WHERE guild_id=? AND request_id=?").get(guild, request)) throw new TraderError("This action has already been used.");
        if (this.store.collection(guild, user).length >= PARTY_LIMIT) throw new TraderError("Your six-Touhou party is full. Gift or release one first.");
        const selected = this.store.market(guild).filter(c => !c.owner_id);
        if (!selected.length) throw new TraderError("No Touhous are available for adoption right now.");
        const character = selected[Math.floor(Math.random() * selected.length)];
        const id = randomUUID();
        this.db.prepare(`INSERT INTO online_adoptions
          (id,guild_id,user_id,request_id,name,revision,currency,price,account_id,base_url,client_id)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, guild, user, request, character.name, character.revision,
          currency, ADOPTION_PRICES[currency], connection.account_id, connection.base_url, connection.client_id);
        return this.db.prepare("SELECT * FROM online_adoptions WHERE id=?").get(id);
      }).immediate();
      return this.settle(job, connection);
    });
  } // Persist and reserve before making a debit; never charge a different currency when retrying.
  async retry(user) {
    return this.wallet.exclusive(user, async () => {
      const job = this.pending(user);
      if (!job) throw new TraderError("No adoption is waiting. Check /touhou collection for completed purchases.");
      return this.settle(job, this.wallet.requireConnection(user));
    });
  }
  async operation(job, connection, kind) {
    const body = { request_id: `${job.id}-${kind}`, kind, asset: job.currency,
      ...(kind === "refund" ? { original_id: `${job.id}-debit` } : { amount: job.price }) };
    const receipt = await this.wallet.client.operation(connection.token, body);
    if (receipt.request_id !== body.request_id || receipt.kind !== kind || receipt.amount !== job.price ||
        receipt.currency !== (job.currency === "stars" ? "Stars" : "LiDollCoin") ||
        (receipt.asset !== undefined && receipt.asset !== job.currency) ||
        !Number.isSafeInteger(receipt.balance) || receipt.balance < 0) {
      throw new WalletError("invalid_response", "Payment confirmation was invalid. Use /lidollid wallet retry; do not start another purchase.");
    }
  } // Confirm the exact amount, currency and saved request before delivering or acknowledging a refund.
  async settle(job, connection) {
    if (job.account_id !== connection.account_id || job.base_url !== connection.base_url || job.client_id !== connection.client_id) {
      throw new WalletError("account_changed", "Reconnect the original Little Log wallet to finish this adoption.");
    }
    if (job.state === "done") return JSON.parse(job.result);
    if (["failed", "refunded"].includes(job.state)) throw new TraderError(job.state === "refunded" ? "This adoption was refunded. You can start a new one." : "This payment was declined. Check your online balance before starting a new adoption.");
    if (job.state === "debit") {
      this.db.prepare("UPDATE online_adoptions SET attempted=1 WHERE id=?").run(job.id);
      try { await this.operation(job, connection, "debit"); }
      catch (error) {
        if (!job.attempted && error instanceof WalletError && [400, 403, 409].includes(error.status)) {
          this.db.prepare("UPDATE online_adoptions SET state='failed' WHERE id=?").run(job.id);
          throw error;
        }
        throw new WalletError("payment_pending", "Payment is not confirmed. Reconnect if needed, then use /lidollid wallet retry to safely finish this same purchase.");
      }
      this.db.prepare("UPDATE online_adoptions SET state='paid' WHERE id=? AND state='debit'").run(job.id);
      job = this.db.prepare("SELECT * FROM online_adoptions WHERE id=?").get(job.id);
      if (job.state === "done") return JSON.parse(job.result);
    } // A lost HTTP response or process restart repeats the same idempotent debit, never a fresh charge.
    if (job.state === "paid") {
      const result = this.db.transaction(() => {
        const current = this.db.prepare("SELECT * FROM online_adoptions WHERE id=?").get(job.id);
        if (current.state === "done") return JSON.parse(current.result);
        if (current.state === "refund") return null;
        const character = this.db.prepare("SELECT * FROM characters WHERE guild_id=? AND name=?").get(job.guild_id, job.name);
        if (!character || !this.store.catalog.some(c => c.name === job.name) || character.owner_id || character.revision !== job.revision || this.store.collection(job.guild_id, job.user_id).length >= PARTY_LIMIT) {
          this.db.prepare("UPDATE online_adoptions SET state='refund' WHERE id=?").run(job.id);
          return null;
        }
        return this.store.mutate(job.guild_id, job.user_id, job.request_id, `adopt:${job.currency}`, () => {
          this.db.prepare("UPDATE characters SET owner_id=?, revision=revision+1 WHERE guild_id=? AND name=?").run(job.user_id, job.guild_id, job.name);
          const delivered = { character: this.store.character(job.guild_id, job.name), currency: job.currency, price: job.price, online: true };
          this.db.prepare("UPDATE online_adoptions SET state='done', result=? WHERE id=?").run(JSON.stringify(delivered), job.id);
          return delivered;
        });
      }).immediate();
      if (result) return result;
      job.state = "refund";
    } // Commit delivery, its Discord receipt and payment completion together; compensate if delivery became impossible.
    try { await this.operation(job, connection, "refund"); }
    catch { throw new WalletError("refund_pending", "Your Touhou could not be delivered. A refund is waiting; use /lidollid wallet retry to finish it safely."); }
    this.db.prepare("UPDATE online_adoptions SET state='refunded' WHERE id=?").run(job.id);
    throw new TraderError("Your Touhou could not be delivered, so the full payment was refunded to Little Log. You can start a new adoption.");
  }
}
