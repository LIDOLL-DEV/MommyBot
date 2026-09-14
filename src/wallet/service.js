import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { chmodSync } from "node:fs";
import { WalletError } from "./client.js";
import { WalletGifts } from "./gifts.js";

export class WalletService {
  constructor(filename, client, { now = Date.now } = {}) {
    this.client = client;
    this.now = now;
    this.locks = new Set();
    this.hasPending = () => false;
    this.db = new Database(filename);
    if (filename !== ":memory:") chmodSync(filename, 0o600); // Restrict bearer grants on Fedora; the service also uses UMask=0077.
    this.db.pragma("journal_mode = WAL");
    this.gifts = new WalletGifts(this); // Load gift reservations before other games register their pending-payment guards.
    this.db.exec(`CREATE TABLE IF NOT EXISTS online_wallets (
      discord_id TEXT PRIMARY KEY, token TEXT NOT NULL, expires INTEGER NOT NULL,
      account_id TEXT NOT NULL, base_url TEXT NOT NULL, client_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS wallet_approvals (
      discord_id TEXT PRIMARY KEY, generation TEXT NOT NULL, device_code TEXT NOT NULL,
      user_code TEXT NOT NULL, verification_uri TEXT NOT NULL, expires INTEGER NOT NULL,
      interval_ms INTEGER NOT NULL, next_poll INTEGER NOT NULL, candidate TEXT, candidate_expires INTEGER,
      base_url TEXT NOT NULL, client_id TEXT NOT NULL);`);
    this.db.exec('CREATE TABLE IF NOT EXISTS combined_wallets(discord_id TEXT PRIMARY KEY,generation TEXT NOT NULL,issuer TEXT NOT NULL,subject TEXT NOT NULL,proof TEXT NOT NULL,deadline INTEGER NOT NULL,candidate TEXT,candidate_expires INTEGER,base_url TEXT NOT NULL,client_id TEXT NOT NULL); CREATE TABLE IF NOT EXISTS wallet_identity_links(discord_id TEXT PRIMARY KEY,issuer TEXT NOT NULL,subject TEXT NOT NULL);');
  } // Store wallet grants separately from identity links under the existing protected data directory.
  async exclusive(userId, action) {
    return this.exclusiveMany([userId], action);
  } // Reuse the same lock set for single-player actions and marketplace buyer/seller settlement.
  async exclusiveMany(userIds, action) {
    const users = [...new Set(userIds)].sort();
    if (this.closing) throw new WalletError("closing", "The bot is restarting. Please try again shortly.");
    if (users.some(user => this.locks.has(user))) throw new WalletError("busy", "Another wallet action is finishing. Please wait and try again.");
    for (const user of users) this.locks.add(user);
    try { return await action(); } finally { for (const user of users) this.locks.delete(user); }
  } // Serialize connection changes and purchases for each authenticated Discord user before awaiting network I/O.
  connection(userId) { return this.db.prepare("SELECT * FROM online_wallets WHERE discord_id = ?").get(userId); }
  assertServer(record) {
    if (record.base_url !== this.client.config.baseUrl || record.client_id !== this.client.config.clientId) {
      throw new WalletError("configuration_changed", "This wallet connection belongs to different API settings. Restore the original settings before reconnecting.");
    }
  } // A configuration change must not send a stored bearer token to a different service.
  requireConnection(userId) {
    const connection = this.connection(userId);
    if (!connection) throw new WalletError("not_connected", userId.startsWith("web_") ? "Sign in with LiD0llID again and approve wallet access to use your stars and coins." : "Connect your Little Log wallet with /lidollid wallet connect to use your online stars and coins.");
    this.assertServer(connection);
    if (connection.expires <= this.now()) throw new WalletError("invalid_token", userId.startsWith("web_") ? "Your wallet connection expired. Sign in with LiD0llID again." : "Your wallet connection expired. Use /lidollid wallet connect again.");
    const binding=this.db.prepare('SELECT * FROM wallet_identity_links WHERE discord_id=?').get(userId);
    if(this.identityFor&&binding){const identity=this.identityFor(userId);if(!identity||identity.issuer!==binding.issuer||identity.subject!==binding.subject)throw new WalletError('not_linked','Finish /lidollid login before using this wallet.');}
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
  async stageIdentity(attempt, identity, validateAttempt = () => {}) { // Stage the short-lived proof in the protected wallet database, never in browser storage or the identity database.
    if(!identity.walletAccessToken)throw new WalletError('insufficient_scope','Start a fresh /lidollid login and approve wallet access.');
    return this.exclusive(attempt.discord_id,async()=>{
      validateAttempt(); // A delayed callback cannot replace the proof from a newer sign-in.
      const previous=this.db.prepare('SELECT * FROM combined_wallets WHERE discord_id=?').get(attempt.discord_id);
      if(previous?.candidate&&previous.candidate!==this.connection(attempt.discord_id)?.token){this.assertServer(previous);try{await this.client.revoke(previous.candidate);}catch(error){if(error.code!=='invalid_token')throw error;}}
      validateAttempt();
      this.db.prepare('INSERT OR REPLACE INTO combined_wallets VALUES (?,?,?,?,?,?,NULL,NULL,?,?)').run(attempt.discord_id,attempt.generation,identity.issuer,identity.subject,identity.walletAccessToken,attempt.expires,this.client.config.baseUrl,this.client.config.clientId);
    });
  }
  async confirmIdentity(userId, attempt, finishIdentity, validateAttempt = () => {}) { // Replays a lost exchange safely and activates only the exact identity confirmed in Discord.
    return this.exclusive(userId,async()=>{
      validateAttempt();
      const staged=this.db.prepare('SELECT * FROM combined_wallets WHERE discord_id=? AND generation=?').get(userId,attempt.generation);
      if(!staged||staged.deadline<=this.now()||staged.issuer!==attempt.issuer||staged.subject!==attempt.subject)throw new WalletError('expired_token','Start a fresh /lidollid login to connect account and wallet.');
      this.assertServer(staged);
      if(!staged.candidate){
        const tokens=await this.client.exchange(staged.proof);
        if(tokens.identity.issuer!==attempt.issuer||tokens.identity.subject!==attempt.subject)throw new WalletError('account_changed','The wallet did not match your verified LiD0llID account.');
        staged.candidate=tokens.access_token;staged.candidate_expires=this.now()+tokens.expires_in*1000;
        this.db.prepare('UPDATE combined_wallets SET candidate=?,candidate_expires=?,proof=? WHERE discord_id=? AND generation=?').run(staged.candidate,staged.candidate_expires,'',userId,attempt.generation);
      }
      if(staged.candidate_expires<=this.now())throw new WalletError('expired_token','Start a fresh /lidollid login to renew wallet access.');
      const balance=await this.client.balance(staged.candidate),old=this.connection(userId);
      validateAttempt(); // Recheck expiry and account ownership before revoking the previous connection.
      if(old)this.assertServer(old);
      if(old&&old.account_id!==balance.accountId&&this.hasPending(userId))throw new WalletError('pending_purchase','Reconnect your previous account to finish its pending purchase first.');
      if(old&&old.token!==staged.candidate){try{await this.client.revoke(old.token);}catch(error){if(error.code!=='invalid_token')throw error;}}
      finishIdentity(()=>this.db.transaction(()=>{
        this.db.prepare('INSERT OR REPLACE INTO online_wallets VALUES (?,?,?,?,?,?)').run(userId,staged.candidate,staged.candidate_expires,balance.accountId,staged.base_url,staged.client_id);
        this.db.prepare('INSERT OR REPLACE INTO wallet_identity_links VALUES (?,?,?)').run(userId,attempt.issuer,attempt.subject);
        this.db.prepare('DELETE FROM wallet_approvals WHERE discord_id=?').run(userId);
      })()); // A partially committed cross-database activation cannot be used until its identity binding is present.
      this.db.prepare('DELETE FROM combined_wallets WHERE discord_id=? AND generation=?').run(userId,attempt.generation);
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
      if (this.hasPending(userId)) throw new WalletError("pending_purchase", "Finish your pending game or gift payment with /lidollid wallet retry before disconnecting.");
      const attempt = this.db.prepare("SELECT * FROM wallet_approvals WHERE discord_id = ?").get(userId);
      const connection = this.connection(userId);
      const combined=this.db.prepare('SELECT * FROM combined_wallets WHERE discord_id=?').get(userId);
      for (const record of [combined?.candidate ? {...combined,token:combined.candidate} : null, attempt?.candidate ? { ...attempt, token: attempt.candidate } : null, connection].filter(Boolean)) {
        this.assertServer(record);
        try { await this.client.revoke(record.token); } catch (error) { if (error.code !== "invalid_token") throw error; }
      }
      this.db.transaction(() => {
        this.db.prepare("DELETE FROM wallet_approvals WHERE discord_id = ?").run(userId);
        this.db.prepare("DELETE FROM online_wallets WHERE discord_id = ?").run(userId);
        this.db.prepare("DELETE FROM combined_wallets WHERE discord_id = ?").run(userId);
        this.db.prepare("DELETE FROM wallet_identity_links WHERE discord_id = ?").run(userId);
      })();
    });
  } // Revoke stored grants before forgetting them, and do not strand unsettled payments on unlink.
  pruneProofs() { this.db.prepare('UPDATE combined_wallets SET proof=? WHERE deadline<=? AND proof!=?').run('',this.now(),''); } // Drop expired OIDC credentials while retaining candidate grants for revocation/recovery.
  async close() {
    this.closing = true;
    while (this.locks.size) await new Promise(resolve => setTimeout(resolve, 50));
    this.db.close();
  } // Let active purchases persist their result before shutdown closes either database.
}
