import { randomUUID } from "node:crypto";
import { WalletError } from "./client.js";

const active = "('debit','credit','refund')";

export class WalletTransfers {
  constructor(wallet) {
    this.wallet = wallet; this.db = wallet.db;
    this.db.exec(`CREATE TABLE IF NOT EXISTS wallet_transfers (
      id TEXT PRIMARY KEY, interaction_id TEXT NOT NULL UNIQUE, guild_id TEXT NOT NULL,
      sender_id TEXT NOT NULL, recipient_id TEXT NOT NULL, asset TEXT NOT NULL CHECK(asset IN ('coins','diamonds')),
      amount INTEGER NOT NULL CHECK(amount BETWEEN 1 AND 1000000),
      sender_account TEXT NOT NULL, recipient_account TEXT NOT NULL,
      base_url TEXT NOT NULL, client_id TEXT NOT NULL, created INTEGER NOT NULL,
      state TEXT NOT NULL DEFAULT 'debit', debit_attempted INTEGER NOT NULL DEFAULT 0,
      credit_attempted INTEGER NOT NULL DEFAULT 0);`);
    const previous = wallet.hasPending;
    wallet.hasPending = user => previous(user) || Boolean(this.pending(user));
  } // Restore both participants' durable reservations before exposing any game or account actions.

  pending(user) {
    return this.db.prepare(`SELECT * FROM wallet_transfers WHERE (sender_id=? OR recipient_id=?) AND state IN ${active} ORDER BY created LIMIT 1`).get(user, user);
  } // Either participant may recover an authorized transfer; neither may unlink until settlement finishes.

  async send(guild, sender, recipient, asset, amount, interactionId) {
    if (!guild || !sender || !recipient || sender === recipient || !["coins", "diamonds"].includes(asset) ||
        !Number.isSafeInteger(amount) || amount < 1 || amount > 1_000_000 || !/^[0-9]{1,32}$/.test(interactionId ?? "")) {
      throw new WalletError("invalid_transfer", "Choose another player and 1–1,000,000 coins or diamonds in a server. Stars cannot be sent.");
    }
    return this.wallet.exclusiveMany([sender, recipient], async () => {
      let job = this.db.prepare("SELECT * FROM wallet_transfers WHERE interaction_id=?").get(interactionId);
      if (job) {
        if (job.guild_id !== guild || job.sender_id !== sender || job.recipient_id !== recipient || job.asset !== asset || job.amount !== amount) {
          throw new WalletError("invalid_transfer", "This interaction already belongs to a different transfer.");
        }
      } else {
        if (this.wallet.hasPending(sender) || this.wallet.hasPending(recipient)) {
          throw new WalletError("transfer_pending", "A participant has a pending wallet payment. Finish it with /lidollid wallet retry first.");
        }
        const from = this.wallet.requireConnection(sender), to = this.wallet.requireConnection(recipient);
        if (from.account_id === to.account_id) throw new WalletError("invalid_transfer", "Choose someone with a different wallet account.");
        const reads = await Promise.allSettled([this.wallet.readBalance(sender), this.wallet.readBalance(recipient)]);
        for (const read of reads) if (read.status === "rejected") throw read.reason;
        const [senderBalance, recipientBalance] = reads.map(read => read.value); // Drain both reads before releasing locks, even if one wallet is unavailable.
        if (asset === "diamonds" && (!senderBalance.diamondsEnabled || !recipientBalance.diamondsEnabled)) {
          throw new WalletError("insufficient_scope", "Both players need to Connect / renew and approve diamond access before sending diamonds.");
        }
        if (senderBalance[asset] < amount) throw new WalletError("insufficient_funds", `You do not have enough ${asset} for this transfer.`);
        const id = randomUUID();
        this.db.prepare(`INSERT INTO wallet_transfers
          (id,interaction_id,guild_id,sender_id,recipient_id,asset,amount,sender_account,recipient_account,base_url,client_id,created)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, interactionId, guild, sender, recipient, asset, amount,
          from.account_id, to.account_id, from.base_url, from.client_id, this.wallet.now());
        job = this.pending(sender);
      }
      return this.settle(job.id);
    });
  } // Reserve a sender-funded payment only after validating both wallets; duplicate Discord interactions reuse it.

  async retry(user) {
    const job = this.pending(user);
    if (!job) throw new WalletError("no_transfer", "You have no pending transfer.");
    return this.wallet.exclusiveMany([job.sender_id, job.recipient_id], () => this.settle(job.id));
  } // Recovery cannot change the authorized sender, destination, asset or amount.

  connection(job, recipient = false) {
    this.wallet.assertServer(job);
    const connection = this.wallet.requireConnection(recipient ? job.recipient_id : job.sender_id);
    if (connection.account_id !== (recipient ? job.recipient_account : job.sender_account)) {
      throw new WalletError("account_changed", "Reconnect the original wallet account before retrying this transfer.");
    }
    return connection;
  } // Never redirect a saved payment to a replacement account or API registration.

  async pay(job, kind) {
    const connection = this.connection(job, kind === "credit");
    const requestId = `${job.id}-${kind}`;
    const receipt = await this.wallet.client.operation(connection.token, {
      request_id: requestId, kind, asset: job.asset,
      ...(kind === "refund" ? { original_id: `${job.id}-debit` } : { amount: job.amount }),
    });
    if (receipt?.request_id !== requestId || receipt.kind !== kind || receipt.amount !== job.amount ||
        receipt.currency !== (job.asset === "diamonds" ? "Diamonds" : "LiDollCoin") ||
        (receipt.asset !== undefined && receipt.asset !== job.asset) || !Number.isSafeInteger(receipt.balance) || receipt.balance < 0) {
      throw new WalletError("invalid_receipt", "The transfer receipt could not be confirmed.");
    }
  } // Give each leg a stable provider request ID and validate its exact receipt before advancing the journal.

  async settle(id) {
    let job = this.db.prepare("SELECT * FROM wallet_transfers WHERE id=?").get(id);
    if (["done", "refunded"].includes(job.state)) return job;
    if (job.state === "failed") throw new WalletError("transfer_rejected", "This transfer was declined without sending currency. Check your balance before starting another.");
    if (job.state === "debit") {
      this.connection(job); this.connection(job, true);
      this.db.prepare("UPDATE wallet_transfers SET debit_attempted=1 WHERE id=?").run(id);
      try { await this.pay(job, "debit"); }
      catch (error) {
        if (!job.debit_attempted && error instanceof WalletError && [400, 403, 409, 429].includes(error.status)) {
          this.db.prepare("UPDATE wallet_transfers SET state='failed' WHERE id=?").run(id);
          throw error;
        }
        throw new WalletError("transfer_pending", "The sender's payment is unconfirmed. Use Retry payment; do not send a replacement transfer.");
      }
      this.db.prepare("UPDATE wallet_transfers SET state='credit' WHERE id=?").run(id);
      job = this.db.prepare("SELECT * FROM wallet_transfers WHERE id=?").get(id);
    }
    if (job.state === "credit") {
      this.connection(job, true);
      this.db.prepare("UPDATE wallet_transfers SET credit_attempted=1 WHERE id=?").run(id);
      try { await this.pay(job, "credit"); }
      catch (error) {
        if (!job.credit_attempted && error instanceof WalletError && [400, 403, 409, 429].includes(error.status)) {
          this.db.prepare("UPDATE wallet_transfers SET state='refund' WHERE id=?").run(id);
        } else throw new WalletError("transfer_pending", "The sender has paid; the recipient's credit is unconfirmed. Either player can use Retry payment. Do not send a replacement transfer.");
      }
      job = this.db.prepare("SELECT * FROM wallet_transfers WHERE id=?").get(id);
      if (job.state === "credit") {
        this.db.prepare("UPDATE wallet_transfers SET state='done' WHERE id=?").run(id);
        return { ...job, state: "done" };
      }
    }
    if (job.state === "refund") {
      try { await this.pay(job, "refund"); }
      catch { throw new WalletError("transfer_pending", "The recipient could not receive this transfer. The sender's full refund is pending; use Retry payment."); }
      this.db.prepare("UPDATE wallet_transfers SET state='refunded' WHERE id=?").run(id);
      return { ...job, state: "refunded" };
    }
  } // Credit only after confirmed payment; refund only a definitively rejected first credit, never an uncertain credit.
}
