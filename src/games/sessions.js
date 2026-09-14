import { createHash, randomBytes } from "node:crypto";
const secret = () => randomBytes(32).toString("base64url");
const hash = value => createHash("sha256").update(String(value || "")).digest("hex");
const binding = identity => hash(JSON.stringify([identity.issuer, identity.subject, identity.linked_at]));

export class GameSessions {
  constructor(db, identities, { prefix, command, ErrorClass = Error, now = Date.now }) {
    if (!/^[a-z]+$/.test(prefix)) throw new Error("Invalid game session namespace.");
    this.db = db; this.identities = identities; this.now = now;
    this.prefix = prefix; this.command = command; this.ErrorClass = ErrorClass;
    db.exec(`CREATE TABLE IF NOT EXISTS ${prefix}_tickets(user_id TEXT PRIMARY KEY,ticket TEXT UNIQUE NOT NULL,binding TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS ${prefix}_sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL,binding TEXT NOT NULL,expires INTEGER NOT NULL);`);
  } // Games share the same hashed, identity-bound handoff while retaining separate tables, cookies and CSRF tokens.
  prune() {
    this.db.prepare(`DELETE FROM ${this.prefix}_tickets WHERE expires<=?`).run(this.now());
    this.db.prepare(`DELETE FROM ${this.prefix}_sessions WHERE expires<=?`).run(this.now());
  }
  begin(user) {
    this.prune();
    const identity = this.identities.get(user);
    if (!identity) throw new this.ErrorClass(`Link your account with /lidollid login and confirm it first, then use ${this.command}.`);
    const ticket = secret();
    this.db.prepare(`INSERT OR REPLACE INTO ${this.prefix}_tickets VALUES (?,?,?,?)`).run(user, hash(ticket), binding(identity), this.now() + 600000);
    return ticket;
  } // One ten-minute handoff per player; GET previews never consume it.
  ticket(value) {
    if (!/^[\w-]{43}$/.test(value || "")) return null;
    const row = this.db.prepare(`SELECT * FROM ${this.prefix}_tickets WHERE ticket=? AND expires>?`).get(hash(value), this.now());
    const identity = row && this.identities.get(row.user_id);
    return identity && row.binding === binding(identity) ? row : null;
  }
  open(value) {
    return this.db.transaction(() => {
      const row = this.ticket(value);
      if (!row) throw new this.ErrorClass(`This game link expired or was used. Run ${this.command} in Discord for a fresh link.`);
      const token = secret();
      this.db.prepare(`DELETE FROM ${this.prefix}_tickets WHERE user_id=?`).run(row.user_id);
      this.db.prepare(`DELETE FROM ${this.prefix}_sessions WHERE user_id=?`).run(row.user_id);
      this.db.prepare(`INSERT INTO ${this.prefix}_sessions VALUES (?,?,?,?)`).run(hash(token), row.user_id, row.binding, this.now() + 8 * 3600000);
      return token;
    }).immediate();
  } // An explicit protected POST opens a browser session and revokes that game's older browser sessions.
  get(token) {
    if (!/^[\w-]{43}$/.test(token || "")) return null;
    const row = this.db.prepare(`SELECT * FROM ${this.prefix}_sessions WHERE token=? AND expires>?`).get(hash(token), this.now());
    const identity = row && this.identities.gameIdentity(row.user_id);
    return identity && binding(identity) === row.binding ? { ...row, username: identity.username, csrf: hash(`${this.prefix}-csrf:${token}`) } : null;
  }
  openForIdentity(identity) {
    return this.db.transaction(() => {
      const linked = this.identities.gameAccount(identity);
      const token = secret();
      this.db.prepare(`DELETE FROM ${this.prefix}_sessions WHERE user_id=?`).run(linked.player_id);
      this.db.prepare(`INSERT INTO ${this.prefix}_sessions VALUES (?,?,?,?)`).run(hash(token), linked.player_id, binding(linked), this.now() + 8 * 3600000);
      return token;
    }).immediate();
  } // Verified web sign-in opens saved progress without creating a Discord link or consuming Discord tickets.
  revoke(user) {
    this.db.prepare(`DELETE FROM ${this.prefix}_sessions WHERE user_id=?`).run(user);
    this.db.prepare(`DELETE FROM ${this.prefix}_tickets WHERE user_id=?`).run(user);
  } // Logout and unlink remove browser access without deleting saved games or collections.
}
