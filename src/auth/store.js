import Database from "better-sqlite3";
import { createHash, randomBytes } from "node:crypto";

const secret = () => randomBytes(32).toString("base64url");
const hash = value => createHash("sha256").update(String(value || "")).digest("hex");
const lifetime = 10 * 60 * 1000;

export class IdentityStore {
  constructor(filename, now = Date.now) {
    this.now = now;
    this.db = new Database(filename);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`CREATE TABLE IF NOT EXISTS identity_links (
      discord_id TEXT PRIMARY KEY, issuer TEXT NOT NULL, subject TEXT NOT NULL,
      username TEXT NOT NULL, linked_at INTEGER NOT NULL, UNIQUE(issuer, subject));
      CREATE TABLE IF NOT EXISTS identity_attempts (
      discord_id TEXT PRIMARY KEY, generation TEXT NOT NULL, ticket TEXT UNIQUE, browser TEXT UNIQUE,
      verifier TEXT, state TEXT, nonce TEXT, confirmation TEXT,
      issuer TEXT, subject TEXT, username TEXT, expires INTEGER NOT NULL);`);
  } // Use a separate persistent database; Discord IDs and verified issuer/subject pairs are the keys.

  prune() { this.db.prepare("DELETE FROM identity_attempts WHERE expires <= ?").run(this.now()); }
  get(discordId) { return this.db.prepare("SELECT * FROM identity_links WHERE discord_id = ?").get(discordId); }
  hasTicket(ticket) {
    return Boolean(this.db.prepare("SELECT 1 FROM identity_attempts WHERE ticket = ? AND expires > ?").get(hash(ticket), this.now()));
  } // Reject fabricated tickets locally before making any provider requests.
  begin(discordId) {
    this.prune();
    if (this.get(discordId)) throw new Error("Already linked. Use /lidollid unlink before choosing another account.");
    const ticket = secret();
    this.db.prepare("INSERT OR REPLACE INTO identity_attempts(discord_id, generation, ticket, expires) VALUES (?, ?, ?, ?)")
      .run(discordId, secret(), hash(ticket), this.now() + lifetime);
    return ticket;
  } // Replace older attempts for this Discord user and return a private, single-use login ticket.

  start(ticket, values) {
    this.prune();
    const browser = secret();
    const attempt = this.db.prepare(`UPDATE identity_attempts SET ticket = NULL, browser = ?, verifier = ?, state = ?, nonce = ?
      WHERE ticket = ? RETURNING discord_id`).get(hash(browser), values.verifier, values.state, values.nonce, hash(ticket));
    if (!attempt) throw new Error("Login link expired or already used. Run /lidollid login again.");
    return browser;
  } // Bind the consumed ticket to an HttpOnly browser cookie before leaving for the identity provider.

  take(browser) {
    this.prune();
    return this.db.transaction(() => {
      const attempt = this.db.prepare("SELECT * FROM identity_attempts WHERE browser = ?").get(hash(browser));
      if (attempt) this.db.prepare("UPDATE identity_attempts SET browser = NULL, verifier = NULL, state = NULL, nonce = NULL WHERE discord_id = ?").run(attempt.discord_id);
      return attempt;
    })();
  } // Consume callback credentials once, including on failed or replayed callbacks.

  verified(attempt, identity) {
    const code = randomBytes(16).toString("hex");
    const result = this.db.prepare(`UPDATE identity_attempts SET confirmation = ?, issuer = ?, subject = ?, username = ?
      WHERE discord_id = ? AND generation = ? AND expires > ? AND ticket IS NULL AND browser IS NULL AND confirmation IS NULL`)
      .run(hash(code), identity.issuer, identity.subject, identity.username, attempt.discord_id, attempt.generation, this.now());
    if (!result.changes) throw new Error("Login expired or was replaced. Start again in Discord.");
    return code;
  } // Stage verified identity only; the browser cannot finalize a Discord account link.

  confirm(discordId, code) {
    this.prune();
    return this.db.transaction(() => {
      const attempt = this.db.prepare("SELECT * FROM identity_attempts WHERE discord_id = ? AND confirmation = ?").get(discordId, hash(code));
      if (!attempt) throw new Error("Invalid or expired confirmation code. Use the code from your own sign-in page.");
      if (this.get(discordId)) throw new Error("Already linked. Unlink before changing accounts.");
      if (this.db.prepare("SELECT 1 FROM identity_links WHERE issuer = ? AND subject = ?").get(attempt.issuer, attempt.subject)) {
        throw new Error("This LiD0llID is already linked to another Discord account.");
      }
      this.db.prepare("INSERT INTO identity_links VALUES (?, ?, ?, ?, ?)").run(discordId, attempt.issuer, attempt.subject, attempt.username, this.now());
      this.db.prepare("DELETE FROM identity_attempts WHERE discord_id = ?").run(discordId);
      return this.get(discordId);
    })();
  } // Require the original Discord user and atomically enforce one account on each side.

  unlink(discordId) {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM identity_links WHERE discord_id = ?").run(discordId);
      this.db.prepare("DELETE FROM identity_attempts WHERE discord_id = ?").run(discordId);
    })();
  } // Cancel pending callbacks as well as the durable link, without changing the shared identity session.
  close() { this.db.close(); }
}
