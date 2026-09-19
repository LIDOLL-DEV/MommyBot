import { randomInt, randomUUID } from "node:crypto";
import { WalletError } from "./client.js";

const DAY = 86_400_000;
export const SWEAR_APOLOGY_WINDOW_MS = 15 * 60_000;
export const SWEAR_OPTOUT_COST = 5;
export const SWEAR_OPTOUT_MS = 3 * 3_600_000;
export function nextSwearJarDraw(now) {
  const date = new Date(now);
  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return midnight + ((8 - date.getUTCDay()) % 7 || 7) * DAY;
} // Close each week at Monday 00:00 UTC, including across daylight-saving changes.

export class SwearJar {
  constructor(wallet, { draw = randomInt } = {}) {
    this.wallet = wallet; this.db = wallet.db; this.draw = draw;
    this.db.exec(`CREATE TABLE IF NOT EXISTS swear_jar_guilds (
      guild_id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, next_draw INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS swear_jar_jobs (
      id TEXT PRIMARY KEY, message_id TEXT UNIQUE, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL,
      user_id TEXT NOT NULL, kind TEXT NOT NULL, amount INTEGER NOT NULL,
      issuer TEXT, subject TEXT, account_id TEXT, base_url TEXT NOT NULL, client_id TEXT NOT NULL,
      state TEXT NOT NULL, reason TEXT, attempted INTEGER NOT NULL DEFAULT 0,
      created INTEGER NOT NULL, draw_at INTEGER, allocation TEXT,
      notified INTEGER NOT NULL DEFAULT 0, paid_notified INTEGER NOT NULL DEFAULT 0,
      UNIQUE(guild_id, draw_at));
      CREATE INDEX IF NOT EXISTS swear_jar_pending ON swear_jar_jobs(state, user_id);
      CREATE INDEX IF NOT EXISTS swear_jar_pool ON swear_jar_jobs(guild_id, kind, state, allocation, created);
      CREATE INDEX IF NOT EXISTS swear_jar_recent ON swear_jar_jobs(guild_id, channel_id, user_id, kind, created);
      CREATE TABLE IF NOT EXISTS swear_jar_apologies (
      job_id TEXT PRIMARY KEY REFERENCES swear_jar_jobs(id), message_id TEXT NOT NULL UNIQUE,
      created INTEGER NOT NULL, notified INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS swear_jar_reminders (
      job_id TEXT PRIMARY KEY REFERENCES swear_jar_jobs(id), message_id TEXT NOT NULL UNIQUE,
      notified INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS swear_jar_optouts (
      id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, amount INTEGER NOT NULL,
      issuer TEXT NOT NULL, subject TEXT NOT NULL, account_id TEXT NOT NULL, base_url TEXT NOT NULL, client_id TEXT NOT NULL,
      state TEXT NOT NULL, attempted INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, expires INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS swear_jar_optout_active ON swear_jar_optouts(guild_id, user_id, state, expires);
      CREATE INDEX IF NOT EXISTS swear_jar_optout_pending ON swear_jar_optouts(state, user_id);`);
    const previous = wallet.hasPending;
    wallet.hasPending = user => previous(user) || Boolean(this.pending(user));
  } // Load durable coin reservations before HTTP routes allow account changes or game purchases.

  get(id) { return this.db.prepare("SELECT * FROM swear_jar_jobs WHERE id=?").get(id); } // Read the latest payment state after asynchronous work.
  apology(id) { return this.db.prepare("SELECT * FROM swear_jar_apologies WHERE job_id=?").get(id); } // Retrieve the acknowledgment separately from the fine's payment state.
  reminder(id) { return this.db.prepare("SELECT * FROM swear_jar_reminders WHERE job_id=?").get(id); } // Track a single manners reminder without nagging on every message.

  recordReminder(message, job) {
    this.db.prepare("INSERT OR IGNORE INTO swear_jar_reminders (job_id,message_id) VALUES (?,?)").run(job.id, message.id);
    return this.reminder(job.id);
  } // Save the first follow-up that still needs a cute apology, including its reply target for retries.

  recentSwear(message) {
    const created = message.createdTimestamp ?? this.wallet.now();
    return this.db.prepare(`SELECT * FROM swear_jar_jobs
      WHERE guild_id=? AND channel_id=? AND user_id=? AND kind='debit' AND created BETWEEN ? AND ?
      ORDER BY created DESC, length(message_id) DESC, message_id DESC LIMIT 1`)
      .get(message.guildId, message.channelId, message.author.id, created - SWEAR_APOLOGY_WINDOW_MS, created);
  } // Scope classification to this member's latest fine in this channel during the last fifteen minutes.

  recordApology(message, job = this.recentSwear(message)) {
    const duplicate = this.db.prepare("SELECT * FROM swear_jar_apologies WHERE message_id=?").get(message.id);
    if (duplicate) return duplicate;
    if (!job) return null;
    const previous = this.apology(job.id);
    if (previous) return previous; // Repeated apologies cannot walk backwards through old fines or farm replies.
    this.db.prepare("INSERT INTO swear_jar_apologies (job_id,message_id,created) VALUES (?,?,?)")
      .run(job.id, message.id, message.createdTimestamp ?? this.wallet.now());
    this.db.prepare("UPDATE swear_jar_reminders SET notified=1 WHERE job_id=?").run(job.id); // Cancel an unsent reminder once the member apologizes properly.
    return this.apology(job.id);
  } // Remember one apology for the member's latest swear in this channel; never charge, refund or change a payment.

  balance(guild) {
    return this.db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN kind='debit' AND state='done' AND allocation IS NULL THEN amount ELSE 0 END),0) AS available,
      COALESCE(SUM(CASE WHEN kind='credit' AND state='pending' THEN amount ELSE 0 END),0) AS reserved
      FROM swear_jar_jobs WHERE guild_id=?`).get(guild);
  } // Show confirmed coins available for the next draw separately from prizes already reserved for winners.
  pending(user) {
    return this.db.prepare("SELECT * FROM swear_jar_jobs WHERE user_id=? AND state='pending' ORDER BY created,id LIMIT 1").get(user) ?? this.pendingOptOut(user);
  } // Any unresolved fine, prize or break purchase protects its original account from unlinking.

  pendingOptOut(user) {
    return this.db.prepare("SELECT *,'optout' AS kind FROM swear_jar_optouts WHERE user_id=? AND state='pending' ORDER BY created,id LIMIT 1").get(user);
  } // Carry the same kind field as a fine so shared payment wording and the existing retry command need no special case.
  optOutRecord(id) { return this.db.prepare("SELECT *,'optout' AS kind FROM swear_jar_optouts WHERE id=?").get(id); }
  activeOptOut(guild, user) {
    return this.db.prepare("SELECT *,'optout' AS kind FROM swear_jar_optouts WHERE guild_id=? AND user_id=? AND state='done' AND expires>? ORDER BY expires DESC LIMIT 1")
      .get(guild, user, this.wallet.now());
  }
  optedOut(guild, user) { return Boolean(this.activeOptOut(guild, user)); } // Only a confirmed payment pauses fines; a pending or refused charge leaves the jar watching.

  async optOut(guildId, userId, identity) {
    if (!identity) throw new WalletError("not_linked", "Make a LiD0llID account if you don't have one, then use /lidollid login before buying a swear jar break.");
    return this.wallet.exclusive(userId, async () => {
      const active = this.activeOptOut(guildId, userId);
      if (active) return { record: active, fresh: false };
      const saved = this.pendingOptOut(userId);
      if (saved) return { record: await this.settleOptOutLocked(saved.id), fresh: true };
      if (this.wallet.hasPending(userId)) throw new WalletError("pending_purchase", "Finish your pending payment with /lidollid wallet retry before buying a swear jar break.");
      const connection = this.wallet.requireConnection(userId), id = randomUUID();
      this.db.prepare(`INSERT INTO swear_jar_optouts
        (id,guild_id,user_id,amount,issuer,subject,account_id,base_url,client_id,state,created)
        VALUES (?,?,?,?,?,?,?,?,?,'pending',?)`).run(id, guildId, userId, SWEAR_OPTOUT_COST, identity.issuer, identity.subject,
        connection.account_id, this.wallet.client.config.baseUrl, this.wallet.client.config.clientId, this.wallet.now());
      return { record: await this.settleOptOutLocked(id), fresh: true };
    });
  } // Charge one break at a time per member; an unfinished purchase is resumed instead of bought twice.

  async settleOptOut(id) {
    const saved = this.optOutRecord(id);
    if (!saved) throw new WalletError("no_swear_jar_payment", "There is no saved swear jar break purchase.");
    return this.wallet.exclusive(saved.user_id, () => this.settleOptOutLocked(id));
  } // Take this member's wallet lock for scheduled recovery and the retry command, which hold no lock of their own.

  async settleOptOutLocked(id) {
    const record = this.optOutRecord(id);
    if (record.state !== "pending") return record;
    const identity = this.wallet.identityFor?.(record.user_id);
    if (identity?.issuer !== record.issuer || identity?.subject !== record.subject) {
      throw new WalletError("account_changed", "Reconnect your original LiD0llID account to finish this swear jar break purchase.");
    }
    this.wallet.assertServer(record);
    const connection = this.wallet.requireConnection(record.user_id);
    if (record.account_id !== connection.account_id) {
      throw new WalletError("account_changed", "Reconnect your original wallet to finish this swear jar break purchase.");
    }
    const first = !record.attempted;
    this.db.prepare("UPDATE swear_jar_optouts SET attempted=1 WHERE id=?").run(id);
    try {
      const receipt = await this.wallet.client.operation(connection.token, {
        request_id: id, kind: "debit", asset: "coins", amount: record.amount,
      });
      if (receipt?.request_id !== id || receipt.kind !== "debit" || receipt.amount !== record.amount ||
          receipt.currency !== "LiDollCoin" || (receipt.asset !== undefined && receipt.asset !== "coins") ||
          !Number.isSafeInteger(receipt.balance) || receipt.balance < 0) {
        throw new WalletError("invalid_receipt", "The swear jar break receipt could not be verified.");
      }
      this.db.prepare("UPDATE swear_jar_optouts SET state='done',expires=? WHERE id=?").run(this.wallet.now() + SWEAR_OPTOUT_MS, id);
    } catch (error) {
      if (first && error instanceof WalletError && [400, 403, 409].includes(error.status)) {
        this.db.prepare("UPDATE swear_jar_optouts SET state='failed' WHERE id=?").run(id);
        return this.optOutRecord(id);
      } // A first definitive refusal collects nothing and starts no break; an uncertain charge keeps its request ID.
      throw new WalletError("swear_jar_pending", "Your swear jar break payment is saved. Use /lidollid wallet retry; MommyBot also retries automatically. The three hours start once the payment is confirmed.");
    }
    return this.optOutRecord(id);
  } // Start the three hours only from a verified receipt, so an uncertain charge never spends a break it did not pay for.

  record(message, identity) {
    const old = this.db.prepare("SELECT * FROM swear_jar_jobs WHERE message_id=?").get(message.id);
    if (old) return { job: old, fresh: false };
    let connection, reason = identity ? null : "unlinked";
    if (identity) {
      try { connection = this.wallet.requireConnection(message.author.id); }
      catch { reason = "wallet"; }
    }
    const id = randomUUID(), created = message.createdTimestamp ?? this.wallet.now();
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO swear_jar_guilds VALUES (?,?,?)
        ON CONFLICT(guild_id) DO UPDATE SET channel_id=excluded.channel_id`)
        .run(message.guildId, message.channelId, nextSwearJarDraw(created));
      this.db.prepare(`INSERT INTO swear_jar_jobs
        (id,message_id,guild_id,channel_id,user_id,kind,amount,issuer,subject,account_id,base_url,client_id,state,reason,created)
        VALUES (?,?,?,?,?,'debit',1,?,?,?,?,?,?,?,?)`).run(id, message.id, message.guildId, message.channelId,
        message.author.id, identity?.issuer ?? null, identity?.subject ?? null, connection?.account_id ?? null,
        this.wallet.client.config.baseUrl, this.wallet.client.config.clientId, reason ? "skipped" : "pending", reason, created);
    })();
    return { job: this.get(id), fresh: true };
  } // One journal entry per Discord message charges at most one coin, regardless of the number of swear words.

  reserve(guildId, cutoff, candidates) {
    return this.db.transaction(() => {
      const guild = this.db.prepare("SELECT * FROM swear_jar_guilds WHERE guild_id=?").get(guildId);
      if (!guild || guild.next_draw !== cutoff || cutoff > this.wallet.now()) return null;
      const amount = this.db.prepare(`SELECT COUNT(*) AS amount FROM swear_jar_jobs
        WHERE guild_id=? AND kind='debit' AND state='done' AND allocation IS NULL AND created<?`).get(guildId, cutoff).amount;
      const eligible = candidates.filter(candidate => {
        const current = this.wallet.identityFor?.(candidate.discord_id);
        return current?.issuer === candidate.issuer && current?.subject === candidate.subject;
      }); // Recheck links after membership lookups; a completed unlink must remove that lottery entry.
      this.db.prepare("UPDATE swear_jar_guilds SET next_draw=? WHERE guild_id=?").run(nextSwearJarDraw(this.wallet.now()), guildId);
      if (!amount || !eligible.length) return null;
      const winner = eligible[this.draw(eligible.length)], id = randomUUID();
      const connection = this.wallet.connection(winner.discord_id);
      this.db.prepare(`INSERT INTO swear_jar_jobs
        (id,guild_id,channel_id,user_id,kind,amount,issuer,subject,account_id,base_url,client_id,state,created,draw_at)
        VALUES (?,?,?,?,'credit',?,?,?,?,?,?,'pending',?,?)`).run(id, guildId, guild.channel_id, winner.discord_id,
        amount, winner.issuer, winner.subject, connection?.account_id ?? null,
        this.wallet.client.config.baseUrl, this.wallet.client.config.clientId, this.wallet.now(), cutoff);
      this.db.prepare(`UPDATE swear_jar_jobs SET allocation=?
        WHERE guild_id=? AND kind='debit' AND state='done' AND allocation IS NULL AND created<?`).run(id, guildId, cutoff);
      return this.get(id);
    })();
  } // Reserve the whole confirmed pot and a single uniform winner atomically; delayed payments and empty draws roll over.

  async settle(id) {
    const saved = this.get(id);
    if (!saved) throw new WalletError("no_swear_jar_payment", "There is no saved swear jar payment.");
    return this.wallet.exclusive(saved.user_id, async () => {
      const job = this.get(id);
      if (job.state !== "pending") return job;
      const identity = this.wallet.identityFor?.(job.user_id);
      if (identity?.issuer !== job.issuer || identity?.subject !== job.subject) {
        throw new WalletError("account_changed", "Reconnect your original LiD0llID account to finish this swear jar payment.");
      }
      this.wallet.assertServer(job);
      const connection = this.wallet.requireConnection(job.user_id);
      if (job.account_id && job.account_id !== connection.account_id) {
        throw new WalletError("account_changed", "Reconnect your original wallet to finish this swear jar payment.");
      }
      this.db.prepare("UPDATE swear_jar_jobs SET account_id=?,attempted=1 WHERE id=?").run(connection.account_id, id);
      try {
        const receipt = await this.wallet.client.operation(connection.token, {
          request_id: id, kind: job.kind, asset: "coins", amount: job.amount,
        });
        if (receipt?.request_id !== id || receipt.kind !== job.kind || receipt.amount !== job.amount ||
            receipt.currency !== "LiDollCoin" || (receipt.asset !== undefined && receipt.asset !== "coins") ||
            !Number.isSafeInteger(receipt.balance) || receipt.balance < 0) {
          throw new WalletError("invalid_receipt", "The swear jar payment receipt could not be verified.");
        }
        this.db.prepare("UPDATE swear_jar_jobs SET state='done' WHERE id=?").run(id);
      } catch (error) {
        if (job.kind === "debit" && !job.attempted && error instanceof WalletError && [400, 403, 409].includes(error.status)) {
          this.db.prepare("UPDATE swear_jar_jobs SET state='failed',reason='refused' WHERE id=?").run(id);
          return this.get(id);
        } // A first definitive refusal collects nothing; an uncertain debit or any prize retains the same request ID.
        throw new WalletError("swear_jar_pending", "Your swear jar payment is saved. Reconnect with /lidollid login if needed, then use /lidollid wallet retry. MommyBot also retries automatically.");
      }
      return this.get(id);
    });
  } // Credit only collected coins; matching receipts and provider idempotency prevent duplicate charges and prizes after restart.

  async retry(user) {
    const job = this.pending(user);
    if (!job) throw new WalletError("no_swear_jar_payment", "You have no pending swear jar payment.");
    return job.kind === "optout" ? this.settleOptOut(job.id) : this.settle(job.id);
  } // Let members recover their own saved fine, prize or break purchase through the existing private wallet command.
}

export function swearJarPaymentText(job, now = Date.now()) {
  if (job.kind === "optout") return job.state === "done" ? `Your **${job.amount} LiDollcoins** are paid. ${swearJarOptOutText(job, now)}` :
    "Your wallet declined the swear jar break. No coins were collected and no break started.";
  if (job.kind === "credit") return job.state === "done" ? `Your swear jar lottery prize of **${job.amount} LiDollcoins** has been gifted to your wallet!` : "Your swear jar lottery prize is saved until your wallet payment completes.";
  return job.state === "done" ? "Your **1 LiDollcoin** has been put in the swear jar." : "Your wallet declined the swear jar coin. No coin was collected; check your balance and wallet permissions.";
} // Share accurate payment confirmations between Discord's private menus and slash commands.

export function swearJarOptOutText(record, now = Date.now()) {
  const minutes = Math.max(0, Math.ceil((record.expires - now) / 60_000));
  return `MommyBot will let your language slide in this server for **${Math.floor(minutes / 60)}h ${minutes % 60}m** more. Be gentle anyway, sweetheart. 💗`;
} // Report the remaining break from the stored expiry, never from a model-generated or caller-supplied duration.

export function swearJarBalanceText(balance) {
  return `Swear jar balance: **${balance.available} LiDollcoins**` +
    (balance.reserved ? `\nReserved lottery prizes: **${balance.reserved} LiDollcoins** (awaiting confirmed payment).` : "");
} // Render actual journal totals, never a model-generated amount or an individual's wallet balance.
