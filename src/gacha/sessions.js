import { createHash, randomBytes } from "node:crypto";
import { GachaError } from "./store.js";

const secret = () => randomBytes(32).toString("base64url");
const hash = value => createHash("sha256").update(String(value || "")).digest("hex");
const binding = identity => hash(JSON.stringify([identity.issuer, identity.subject, identity.linked_at]));

export class GachaSessions {
  constructor(db, identities, now = Date.now) {
    this.db = db; this.identities = identities; this.now = now;
    db.exec(`CREATE TABLE IF NOT EXISTS diaper_tickets(user_id TEXT PRIMARY KEY,ticket TEXT UNIQUE NOT NULL,binding TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS diaper_sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL,binding TEXT NOT NULL,expires INTEGER NOT NULL);`);
  } // Browser sessions use hashed opaque secrets and remain bound to the currently confirmed identity link.
  prune() {
    this.db.prepare("DELETE FROM diaper_tickets WHERE expires<=?").run(this.now());
    this.db.prepare("DELETE FROM diaper_sessions WHERE expires<=?").run(this.now());
  }
  begin(user) {
    this.prune();
    const identity = this.identities.get(user);
    if (!identity) throw new GachaError("Link your account with /lidollid login and confirm it first, then use /diapers.");
    const ticket = secret();
    this.db.prepare("INSERT OR REPLACE INTO diaper_tickets VALUES (?,?,?,?)").run(user, hash(ticket), binding(identity), this.now() + 600000);
    return ticket;
  } // One ten-minute handoff per Discord user; link previews do not consume it.
  ticket(value) {
    if (!/^[\w-]{43}$/.test(value || "")) return null;
    const row = this.db.prepare("SELECT * FROM diaper_tickets WHERE ticket=? AND expires>?").get(hash(value), this.now());
    const identity = row && this.identities.get(row.user_id);
    return identity && row.binding === binding(identity) ? row : null;
  }
  open(value) {
    return this.db.transaction(() => {
      const row = this.ticket(value);
      if (!row) throw new GachaError("This game link expired or was used. Run /diapers in Discord for a fresh link.");
      const token = secret();
      this.db.prepare("DELETE FROM diaper_tickets WHERE user_id=?").run(row.user_id);
      this.db.prepare("DELETE FROM diaper_sessions WHERE user_id=?").run(row.user_id);
      this.db.prepare("INSERT INTO diaper_sessions VALUES (?,?,?,?)").run(hash(token), row.user_id, row.binding, this.now() + 8 * 3600000);
      return token;
    }).immediate();
  } // Only the explicit Continue POST exchanges the ticket; opening a new session revokes older browser sessions.
  get(token) {
    if (!/^[\w-]{43}$/.test(token || "")) return null;
    const row = this.db.prepare("SELECT * FROM diaper_sessions WHERE token=? AND expires>?").get(hash(token), this.now());
    const identity = row && this.identities.get(row.user_id);
    return identity && binding(identity) === row.binding ? { ...row, username: identity.username, csrf: hash(`diaper-csrf:${token}`) } : null;
  }
  revoke(user) {
    this.db.prepare("DELETE FROM diaper_sessions WHERE user_id=?").run(user);
    this.db.prepare("DELETE FROM diaper_tickets WHERE user_id=?").run(user);
  } // Unlink and browser logout revoke game access without touching the player's collection.
}
