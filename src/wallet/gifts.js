import { randomUUID } from "node:crypto";
import { WalletError } from "./client.js";

export class WalletGifts {
  constructor(wallet) {
    this.wallet = wallet;
    this.db = wallet.db;
    this.db.exec(`CREATE TABLE IF NOT EXISTS wallet_gifts (
      id TEXT PRIMARY KEY, interaction_id TEXT NOT NULL UNIQUE,
      guild_id TEXT NOT NULL, actor_id TEXT NOT NULL, user_id TEXT NOT NULL,
      asset TEXT NOT NULL, amount INTEGER NOT NULL, account_id TEXT NOT NULL,
      base_url TEXT NOT NULL, client_id TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'pending', attempted INTEGER NOT NULL DEFAULT 0,
      created INTEGER NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS wallet_gifts_pending
      ON wallet_gifts(user_id) WHERE state = 'pending';`);
    const previous = wallet.hasPending;
    wallet.hasPending = user => previous(user) || Boolean(this.pending(user));
  } // Keep each administrator, recipient and payment ID in the protected wallet database for audit and recovery.

  pending(user) {
    return this.db.prepare("SELECT * FROM wallet_gifts WHERE user_id=? AND state='pending'").get(user);
  } // A pending gift reserves its recipient's wallet across bot restarts and account relinking.

  async gift(guild, actor, user, asset, amount, interactionId) {
    if (!guild || !actor || !user || !/^[0-9]{1,32}$/.test(interactionId ?? "") ||
        !["coins", "stars", "diamonds"].includes(asset) || !Number.isSafeInteger(amount) || amount < 1 || amount > 1_000_000) {
      throw new WalletError("invalid_gift", "Choose coins, stars or diamonds and a whole-number amount from 1 to 1,000,000 in a server.");
    }
    return this.wallet.exclusive(user, async () => {
      let job = this.db.prepare("SELECT * FROM wallet_gifts WHERE interaction_id=?").get(interactionId);
      if (job) {
        if (job.guild_id !== guild || job.actor_id !== actor || job.user_id !== user || job.asset !== asset || job.amount !== amount) {
          throw new WalletError("invalid_gift", "This interaction already belongs to another gift.");
        }
      } else {
        if (this.wallet.hasPending(user)) throw new WalletError("pending_purchase", "The recipient has a pending wallet action. They can use /lidollid wallet retry; an admin can use /lidollid wallet gift-retry for a pending gift.");
        const connection = this.wallet.requireConnection(user);
        const id = randomUUID();
        this.db.prepare(`INSERT INTO wallet_gifts
          (id,interaction_id,guild_id,actor_id,user_id,asset,amount,account_id,base_url,client_id,created)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, interactionId, guild, actor, user, asset, amount,
          connection.account_id, connection.base_url, connection.client_id, this.wallet.now());
        job = this.pending(user);
      }
      return this.settle(job);
    });
  } // Save the exact credit before contacting Little Log; replayed Discord interactions reuse the same gift.

  async retry(user, guild = null) {
    return this.wallet.exclusive(user, async () => {
      const job = this.pending(user);
      if (!job || (guild && job.guild_id !== guild)) throw new WalletError("no_gift", "There is no pending gift for this recipient in this server.");
      return this.settle(job);
    });
  } // Recipients resume their own approved gift; administrators may resume gifts from their current server.

  async settle(job) {
    if (job.state === "done") return job;
    if (job.state === "failed") throw new WalletError("gift_rejected", "This gift was rejected without crediting the wallet. Correct the wallet problem before creating a new gift.");
    const connection = this.wallet.requireConnection(job.user_id);
    this.wallet.assertServer(job);
    if (connection.account_id !== job.account_id) throw new WalletError("account_changed", "Reconnect the recipient's original wallet account before retrying this gift.");
    const firstAttempt = !job.attempted;
    this.db.prepare("UPDATE wallet_gifts SET attempted=1 WHERE id=?").run(job.id);
    try {
      const receipt = await this.wallet.client.operation(connection.token, {
        request_id: job.id, kind: "credit", asset: job.asset, amount: job.amount,
      });
      if (receipt?.request_id !== job.id || receipt.kind !== "credit" || receipt.amount !== job.amount ||
          receipt.currency !== (job.asset === "diamonds" ? "Diamonds" : job.asset === "stars" ? "Stars" : "LiDollCoin") ||
          (receipt.asset !== undefined && receipt.asset !== job.asset) ||
          !Number.isSafeInteger(receipt.balance) || receipt.balance < 0) {
        throw new WalletError("invalid_receipt", "The wallet returned an unconfirmed gift receipt.");
      }
      this.db.prepare("UPDATE wallet_gifts SET state='done' WHERE id=?").run(job.id);
      return { ...job, state: "done" };
    } catch (error) {
      if (firstAttempt && error instanceof WalletError && [400, 403, 409].includes(error.status)) {
        this.db.prepare("UPDATE wallet_gifts SET state='failed' WHERE id=?").run(job.id);
        throw error;
      }
      const reason = error instanceof WalletError ? ` ${error.message}` : "";
      throw new WalletError("gift_pending", `Gift confirmation is pending.${reason} Use /lidollid wallet gift-retry for this recipient, or ask them to use /lidollid wallet retry. Do not create a replacement gift.`);
    }
  } // Only a matching receipt completes a gift; uncertain responses and daily limits retain the original payment ID.
}
