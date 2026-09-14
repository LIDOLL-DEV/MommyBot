import { randomUUID } from "node:crypto";
import { TraderError } from "../touhou/store.js";
import { WalletError } from "./client.js";

const active = "('debit','paid','credit','refund')";
const methods = Object.freeze({ buyPotions: ["game", 3], heal: ["game", 4], buyback: ["game", 3],
  act: ["game", 5], buy: ["store", 3], award: ["store", 5] });

export class OnlineEconomy {
  constructor(store, game, wallet) {
    this.store = store; this.game = game; this.wallet = wallet; this.db = store.db;
    const previousPending = wallet.hasPending;
    wallet.hasPending = user => previousPending(user) || Boolean(this.pending(user));
    wallet.economy = this;
    store.onlineEconomy = true;
  } // Keep game state, reservations and the durable payout queue in the same database.
  pending(user) {
    return this.db.prepare(`SELECT DISTINCT j.* FROM online_economy j LEFT JOIN online_economy_payments p ON p.job_id=j.id
      WHERE (j.user_id=? OR p.user_id=?) AND j.state IN ${active} ORDER BY j.rowid LIMIT 1`).get(user, user);
  }
  legs(job) { return this.db.prepare("SELECT * FROM online_economy_payments WHERE job_id=? ORDER BY rowid").all(job.id); }
  users(job) { return [job.user_id, ...this.legs(job).map(p => p.user_id)]; }
  call(method, args) { return this[methods[method][0]][method](...args); }
  idle(users) {
    for (const user of users) if (this.wallet.hasPending(user)) throw new TraderError("A participant has a pending wallet payment. Use /lidollid wallet retry before another transaction.");
  }
  capture(method, args, jobId = null) {
    const legs = [], oldHandler = this.store.balanceHandler, oldJob = this.store.paymentJob;
    this.store.balanceHandler = (guild, user, currency, delta) => {
      if (guild !== args[0] || currency !== "coins") throw new TraderError("Trader payments and rewards use online LiDollcoins. Stars are available for adoption only.");
      if (delta) legs.push({ user, kind: delta < 0 ? "debit" : "credit", amount: Math.abs(delta) });
    };
    this.store.paymentJob = jobId;
    try { return { result: this.call(method, args), legs }; }
    finally { this.store.balanceHandler = oldHandler; this.store.paymentJob = oldJob; }
  } // Reuse the existing ownership, pricing and inventory rules while replacing only their synchronous currency writes.
  preview(method, args) {
    const rollback = new Error("Preview rollback");
    let preview;
    try { this.db.transaction(() => { preview = this.capture(method, args); throw rollback; }).immediate(); }
    catch (error) { if (error !== rollback) throw error; }
    return preview;
  } // Validate a purchase without leaving a receipt, changing inventory or spending any currency.
  save(method, args, captured, state) {
    const id = randomUUID(), guild = args[0], actor = args[1], request = args[methods[method][1]];
    const name = state === "debit" ? captured.result.character?.name || (method === "heal" ? captured.result.name : null) : null;
    const character = name ? this.store.character(guild, name) : null;
    this.db.prepare("INSERT INTO online_economy VALUES (?,?,?,?,?,?,?,?,?)").run(id, guild, actor, request, method, JSON.stringify(args), state,
      state === "credit" ? JSON.stringify(captured.result) : null,
      character ? JSON.stringify({ name, owner: character.owner_id, revision: character.revision }) : null);
    for (const [index, leg] of captured.legs.entries()) {
      const connection = this.wallet.requireConnection(leg.user);
      this.db.prepare(`INSERT INTO online_economy_payments
        (id,job_id,user_id,account_id,base_url,client_id,kind,amount) VALUES (?,?,?,?,?,?,?,?)`)
        .run(`${id}-${index}`, id, leg.user, connection.account_id, connection.base_url, connection.client_id, leg.kind, leg.amount);
    }
    if (character) this.db.prepare("INSERT INTO online_economy_locks VALUES (?,?,?)").run(guild, name, id);
    return this.db.prepare("SELECT * FROM online_economy WHERE id=?").get(id);
  } // Persist app/account-bound operation IDs before network writes; never store bearer tokens in the game journal.
  async run(method, input, creditOnly = false) {
    const args = [...input];
    while (args.at(-1) === undefined) args.pop();
    const [guild, actor] = args, request = args[methods[method][1]];
    this.store.ensureGuild(guild);
    const old = this.db.prepare("SELECT * FROM online_economy WHERE guild_id=? AND request_id=?").get(guild, request);
    if (old) {
      if (old.user_id !== actor || old.operation !== method || old.args !== JSON.stringify(args)) throw new TraderError("This action has already been used.");
      return this.wallet.exclusiveMany(this.users(old), () => this.settle(old));
    }
    // A market preview identifies the seller so both connections can be locked before payment begins.
    const preview = creditOnly ? null : this.preview(method, args);
    const users = [...new Set([actor, ...(preview?.legs.map(p => p.user) || []), ...(method === "award" ? [args[2]] : [])])];
    return this.wallet.exclusiveMany(users, async () => {
      this.idle(users);
      const prepared = this.db.transaction(() => {
        if (creditOnly) {
          const captured = this.capture(method, args);
          if (captured.legs.some(p => p.kind !== "credit")) throw new Error("Unexpected debit in payout action.");
          return captured.legs.length ? { job: this.save(method, args, captured, "credit") } : captured;
        }
        const captured = this.preview(method, args);
        if (!captured.legs.length) return this.capture(method, args);
        if (captured.legs.filter(p => p.kind === "debit").length !== 1 || captured.legs.find(p => p.kind === "debit").user !== actor) throw new Error("Unexpected purchase ledger.");
        if (captured.legs.some(p => !users.includes(p.user))) throw new TraderError("The seller changed. Review the listing again.");
        return { job: this.save(method, args, captured, "debit") };
      }).immediate();
      return prepared.job ? this.settle(prepared.job) : prepared.result;
    });
  } // Purchases reserve before debiting; earned payouts commit with the game event and can settle later without replaying it.
  async retry(user) {
    const job = this.pending(user);
    if (!job) throw new TraderError("No trader payment is waiting.");
    return this.wallet.exclusiveMany(this.users(job), async () => {
      await this.settle(job);
      return { content: `LiDollcoin payment completed for ${job.operation} in server ${job.guild_id}. Check your wallet and party there.` };
    });
  }
  async pay(leg, refund = false) {
    const connection = this.wallet.requireConnection(leg.user_id);
    if (connection.account_id !== leg.account_id || connection.base_url !== leg.base_url || connection.client_id !== leg.client_id) {
      throw new WalletError("account_changed", "A participant must reconnect the original Little Log account before this payment can finish.");
    }
    const kind = refund ? "refund" : leg.kind, requestId = refund ? `${leg.id}-refund` : leg.id;
    const receipt = await this.wallet.client.operation(connection.token, { request_id: requestId, kind, asset: "coins",
      ...(refund ? { original_id: leg.id } : { amount: leg.amount }) });
    if (receipt.request_id !== requestId || receipt.kind !== kind || receipt.amount !== leg.amount || receipt.currency !== "LiDollCoin" ||
        receipt.asset !== undefined && receipt.asset !== "coins" || !Number.isSafeInteger(receipt.balance) || receipt.balance < 0) {
      throw new WalletError("invalid_response", "The payment receipt could not be confirmed. Use /lidollid wallet retry.");
    }
  } // Retry the same debit, credit or refund against its original account and verify the exact receipt before advancing.
  terminal(job, state, result = null) {
    this.db.transaction(() => {
      this.db.prepare("UPDATE online_economy SET state=?,result=COALESCE(?,result) WHERE id=?").run(state, result ? JSON.stringify(result) : null, job.id);
      this.db.prepare("DELETE FROM online_economy_locks WHERE job_id=?").run(job.id);
    }).immediate();
  }
  async settle(saved) {
    let job = this.db.prepare("SELECT * FROM online_economy WHERE id=?").get(saved.id);
    if (job.state === "done") return JSON.parse(job.result);
    if (job.state === "failed") throw new TraderError("This payment was declined. Check your online balance before trying a new action.");
    if (job.state === "refunded") throw new TraderError("This purchase was refunded. You can start a new action.");
    const payments = this.legs(job), debit = payments.find(p => p.kind === "debit");
    if (job.state === "debit") {
      this.db.prepare("UPDATE online_economy_payments SET attempted=1 WHERE id=?").run(debit.id);
      try { await this.pay(debit); }
      catch (error) {
        if (!debit.attempted && error instanceof WalletError && [400, 403, 409].includes(error.status)) { this.terminal(job, "failed"); throw error; }
        throw new WalletError("payment_pending", "Payment is not confirmed. Reconnect if needed, then use /lidollid wallet retry. No item has been delivered yet.");
      }
      this.db.transaction(() => {
        this.db.prepare("UPDATE online_economy_payments SET confirmed=1 WHERE id=?").run(debit.id);
        this.db.prepare("UPDATE online_economy SET state='paid' WHERE id=? AND state='debit'").run(job.id);
      }).immediate();
      job = this.db.prepare("SELECT * FROM online_economy WHERE id=?").get(job.id);
    }
    if (job.state === "paid") {
      try {
        this.db.transaction(() => {
          const currentJob = this.db.prepare("SELECT state FROM online_economy WHERE id=?").get(job.id);
          if (currentJob.state !== "paid") return; // A replay must not reinterpret an already committed delivery as a failed purchase.
          if (job.guard) {
            const guard = JSON.parse(job.guard), current = this.store.character(job.guild_id, guard.name);
            if (current.owner_id !== guard.owner || current.revision !== guard.revision) throw new TraderError("The character changed during payment.");
          }
          const captured = this.capture(job.operation, JSON.parse(job.args), job.id);
          const expected = payments.map(p => ({ user: p.user_id, kind: p.kind, amount: p.amount }));
          if (JSON.stringify(captured.legs) !== JSON.stringify(expected)) throw new TraderError("The confirmed price or recipient changed.");
          this.db.prepare("UPDATE online_economy SET state='credit',result=? WHERE id=?").run(JSON.stringify(captured.result), job.id);
        }).immediate();
      } catch (error) {
        if (!(error instanceof TraderError)) throw error; // A storage failure retains the paid job for recovery instead of guessing that delivery is impossible.
        this.db.prepare("UPDATE online_economy SET state='refund' WHERE id=?").run(job.id);
      }
      job = this.db.prepare("SELECT * FROM online_economy WHERE id=?").get(job.id);
    } // Delivery, its receipt and the seller's queued credit commit together after the buyer's debit is confirmed.
    if (job.state === "refund") {
      try { await this.pay(debit, true); }
      catch { throw new WalletError("refund_pending", "Delivery could not finish. Your full refund is waiting; use /lidollid wallet retry."); }
      this.terminal(job, "refunded");
      throw new TraderError("Delivery could not finish, so your full LiDollcoin payment was refunded.");
    }
    if (job.state === "credit") {
      for (const leg of payments.filter(p => p.kind === "credit" && !p.confirmed)) {
        try { await this.pay(leg); }
        catch (error) {
          const reason = error instanceof WalletError ? ` ${error.message}` : "";
          throw new WalletError("payout_pending", `The game action completed; its LiDollcoin payout is saved and waiting. Use /lidollid wallet retry.${reason}`);
        }
        this.db.prepare("UPDATE online_economy_payments SET confirmed=1 WHERE id=?").run(leg.id);
      }
      const result = JSON.parse(job.result);
      this.db.transaction(() => {
        if (job.operation === "act" && result.reward) {
          result.reward.payment = "paid";
          const battle = this.db.prepare("SELECT state FROM battles WHERE id=?").get(result.id);
          if (battle) {
            const state = JSON.parse(battle.state); state.reward.payment = "paid";
            this.db.prepare("UPDATE battles SET state=? WHERE id=?").run(JSON.stringify(state), result.id);
          }
          this.db.prepare("UPDATE receipts SET result=? WHERE guild_id=? AND request_id=?").run(JSON.stringify(result), job.guild_id, job.request_id);
        }
        this.terminal(job, "done", result);
      }).immediate();
      return result;
    }
    if (job.state === "done") return JSON.parse(job.result);
    throw new Error("Unexpected payment state.");
  }
  facade() {
    const facade = Object.create(this.game);
    for (const method of ["buyPotions", "heal", "buyback", "act"]) facade[method] = (...args) => this.run(method, args, ["buyback", "act"].includes(method));
    facade.start = (...args) => { this.idle([args[1]]); this.wallet.requireConnection(args[1]); return this.game.start(...args); };
    return facade;
  } // Keep synchronous battle reads while routing every money-changing action through the online journal.
  buy(...args) { return this.run("buy", args); }
  award(...args) { return this.run("award", args, true); }
  list(...args) { this.idle([args[1]]); this.wallet.requireConnection(args[1]); return this.store.list(...args); }
}
