import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { chmodSync } from "node:fs";
import { WalletError } from "./client.js";

export class WalletService {
  constructor(filename, client, { now = Date.now } = {}) {
    this.client = client;
    this.now = now;
    this.locks = new Set();
    this.hasPending = () => false;
    this.db = new Database(filename);
    if (filename !== ":memory:") chmodSync(filename, 0o600); // Restrict bearer grants on Fedora; the service also uses UMask=0077.
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`CREATE TABLE IF NOT EXISTS online_wallets (
      discord_id TEXT PRIMARY KEY, token TEXT NOT NULL, expires INTEGER NOT NULL,
      account_id TEXT NOT NULL, base_url TEXT NOT NULL, client_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS wallet_approvals (
      discord_id TEXT PRIMARY KEY, generation TEXT NOT NULL, device_code TEXT NOT NULL,
      user_code TEXT NOT NULL, verification_uri TEXT NOT NULL, expires INTEGER NOT NULL,
      interval_ms INTEGER NOT NULL, next_poll INTEGER NOT NULL, candidate TEXT, candidate_expires INTEGER,
      base_url TEXT NOT NULL, client_id TEXT NOT NULL);`);
  } // Store wallet grants separately from identity links under the existing protected data directory.
  async exclusive(userId, action) {
    if (this.closing) throw new WalletError("closing", "The bot is restarting. Please try again shortly.");
    if (this.locks.has(userId)) throw new WalletError("busy", "Another wallet action is finishing. Please wait and try again.");
    this.locks.add(userId);
    try { return await action(); } finally { this.locks.delete(userId); }
  } // Serialize connection changes and purchases for each authenticated Discord user before awaiting network I/O.
  connection(userId) { return this.db.prepare("SELECT * FROM online_wallets WHERE discord_id = ?").get(userId); }
  assertServer(record) {
    if (record.base_url !== this.client.config.baseUrl || record.client_id !== this.client.config.clientId) {
      throw new WalletError("configuration_changed", "This wallet connection belongs to different API settings. Restore the original settings before reconnecting.");
    }
  } // A configuration change must not send a stored bearer token to a different service.
  requireConnection(userId) {
    const connection = this.connection(userId);
    if (!connection) throw new WalletError("not_connected", "Connect your Little Log wallet with /lidollid wallet connect to use your online stars and coins.");
    this.assertServer(connection);
    if (connection.expires <= this.now()) throw new WalletError("invalid_token", "Your wallet connection expired. Use /lidollid wallet connect again.");
    return connection;
  }
  async balance(userId) {
    return this.exclusive(userId, async () => {
      const connection = this.requireConnection(userId);
      const balance = await this.client.balance(connection.token);
      if (balance.accountId !== connection.account_id) throw new WalletError("account_changed", "The wallet account did not match its saved connection.");
      return balance;
    });
  }
  async begin(userId) {
    return this.exclusive(userId, async () => {
      const existing = this.connection(userId);
      if (existing) this.assertServer(existing);
      const previous = this.db.prepare("SELECT * FROM wallet_approvals WHERE discord_id=?").get(userId);
      if (previous) {
        this.assertServer(previous);
        if (previous.candidate) {
          try { await this.client.revoke(previous.candidate); } catch (error) { if (error.code !== "invalid_token") throw error; }
        }
      } // Revoke an interrupted approval's token before replacing its recovery record.
      const data = await this.client.begin();
      const generation = randomUUID();
      this.db.prepare(`INSERT OR REPLACE INTO wallet_approvals
        (discord_id,generation,device_code,user_code,verification_uri,expires,interval_ms,next_poll,base_url,client_id)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(userId, generation, data.device_code, data.user_code, data.verification_uri,
        this.now() + data.expires_in * 1000, data.interval * 1000, this.now() + data.interval * 1000, this.client.config.baseUrl, this.client.config.clientId);
      return { generation, userCode: data.user_code, verificationUri: data.verification_uri };
    });
  } // Ask the player for explicit wallet consent; an OIDC profile alone cannot read or spend stars.
  async finish(userId, generation) {
    return this.exclusive(userId, async () => {
      const attempt = this.db.prepare("SELECT * FROM wallet_approvals WHERE discord_id = ? AND generation = ?").get(userId, generation);
      if (!attempt || attempt.expires <= this.now() && !attempt.candidate) throw new WalletError("expired_token", "This wallet approval expired or was replaced. Use /lidollid wallet connect again.");
      this.assertServer(attempt);
      if (!attempt.candidate) {
        if (attempt.next_poll > this.now()) throw new WalletError("slow_down", "Wait a few seconds before checking approval again.");
        this.db.prepare("UPDATE wallet_approvals SET next_poll = ? WHERE discord_id = ?").run(this.now() + attempt.interval_ms, userId);
        let tokens;
        try { tokens = await this.client.poll(attempt.device_code); }
        catch (error) {
          if (error.code === "slow_down") this.db.prepare("UPDATE wallet_approvals SET interval_ms = interval_ms + 5000, next_poll = ? WHERE discord_id = ?").run(this.now() + attempt.interval_ms + 5000, userId);
          if (["access_denied", "expired_token"].includes(error.code)) this.db.prepare("DELETE FROM wallet_approvals WHERE discord_id=? AND generation=?").run(userId, generation);
          throw error;
        }
        attempt.candidate = tokens.access_token;
        attempt.candidate_expires = this.now() + tokens.expires_in * 1000;
        this.db.prepare("UPDATE wallet_approvals SET candidate = ?, candidate_expires = ? WHERE discord_id = ?").run(attempt.candidate, attempt.candidate_expires, userId);
      } // Save the one-time token response before fetching its account/balance, so a network outage can resume.
      if (attempt.candidate_expires <= this.now()) throw new WalletError("invalid_token", "This wallet grant expired. Use /lidollid wallet connect again.");
      const balance = await this.client.balance(attempt.candidate);
      const old = this.connection(userId);
      if (old) this.assertServer(old);
      if (old && old.account_id !== balance.accountId && this.hasPending(userId)) {
        throw new WalletError("pending_purchase", "An adoption is waiting on your previous wallet. Reconnect that same Little Log account before retrying it.");
      }
      if (old && old.token !== attempt.candidate) {
        try { await this.client.revoke(old.token); } catch (error) { if (error.code !== "invalid_token") throw error; }
      }
      this.db.transaction(() => {
        this.db.prepare("INSERT OR REPLACE INTO online_wallets VALUES (?,?,?,?,?,?)").run(userId, attempt.candidate, attempt.candidate_expires, balance.accountId, attempt.base_url, attempt.client_id);
        this.db.prepare("DELETE FROM wallet_approvals WHERE discord_id = ?").run(userId);
      })();
      return balance;
    });
  } // Pin purchases to the approved opaque wallet account, which the wallet API scopes to this app.
  async disconnect(userId) {
    return this.exclusive(userId, async () => {
      if (this.hasPending(userId)) throw new WalletError("pending_purchase", "Finish your pending adoption with /lidollid wallet retry before disconnecting.");
      const attempt = this.db.prepare("SELECT * FROM wallet_approvals WHERE discord_id = ?").get(userId);
      const connection = this.connection(userId);
      for (const record of [attempt?.candidate ? { ...attempt, token: attempt.candidate } : null, connection].filter(Boolean)) {
        this.assertServer(record);
        try { await this.client.revoke(record.token); } catch (error) { if (error.code !== "invalid_token") throw error; }
      }
      this.db.transaction(() => {
        this.db.prepare("DELETE FROM wallet_approvals WHERE discord_id = ?").run(userId);
        this.db.prepare("DELETE FROM online_wallets WHERE discord_id = ?").run(userId);
      })();
    });
  } // Revoke stored grants before forgetting them, and do not strand unsettled payments on unlink.
  async close() {
    this.closing = true;
    while (this.locks.size) await new Promise(resolve => setTimeout(resolve, 50));
    this.db.close();
  } // Let active purchases persist their result before shutdown closes either database.
}
