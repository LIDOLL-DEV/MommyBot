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
    this.db.exec("CREATE TABLE IF NOT EXISTS web_game_accounts (player_id TEXT PRIMARY KEY, issuer TEXT NOT NULL, subject TEXT NOT NULL, username TEXT NOT NULL, linked_at INTEGER NOT NULL, UNIQUE(issuer, subject)); CREATE TABLE IF NOT EXISTS public_game_players (user_id TEXT PRIMARY KEY);"); // Standalone game players never become confirmed Discord links or receive Discord roles.
    this.db.exec(`CREATE TABLE IF NOT EXISTS identity_links (
      discord_id TEXT PRIMARY KEY, issuer TEXT NOT NULL, subject TEXT NOT NULL,
      username TEXT NOT NULL, linked_at INTEGER NOT NULL, UNIQUE(issuer, subject));
      CREATE TABLE IF NOT EXISTS identity_attempts (
      discord_id TEXT PRIMARY KEY, generation TEXT NOT NULL, ticket TEXT UNIQUE, browser TEXT UNIQUE,
      verifier TEXT, state TEXT, nonce TEXT, confirmation TEXT,
      issuer TEXT, subject TEXT, username TEXT, expires INTEGER NOT NULL);`);
    if (!this.db.prepare('PRAGMA table_info(identity_attempts)').all().some(c => c.name === 'reconnect')) this.db.exec('ALTER TABLE identity_attempts ADD COLUMN reconnect INTEGER NOT NULL DEFAULT 0');
  } // Use a separate persistent database; Discord IDs and verified issuer/subject pairs are the keys.

  prune() { this.db.prepare("DELETE FROM identity_attempts WHERE expires <= ?").run(this.now()); }
  get(discordId) { return this.db.prepare("SELECT * FROM identity_links WHERE discord_id = ?").get(discordId); }
  discordLinks() { return this.db.prepare("SELECT discord_id,issuer,subject FROM identity_links ORDER BY discord_id").all(); } // Lottery entries come only from confirmed Discord links, never standalone web accounts.
  leaderboardAccounts() {
    const accounts = new Map();
    const rows = this.db.prepare(`SELECT discord_id AS player_id, issuer, subject, username FROM identity_links
      UNION ALL SELECT player_id, issuer, subject, username FROM web_game_accounts
      ORDER BY player_id`).all();
    for (const record of rows) {
      const key = JSON.stringify([record.issuer, record.subject]);
      const account = accounts.get(key) || { key, username: record.username, players: [] };
      account.players.push(record.player_id);
      accounts.set(key, account);
    }
    return [...accounts.values()];
  } // List confirmed registrations once per identity, including players who later connect Discord to a web account.
  find(issuer, subject) { return this.db.prepare("SELECT * FROM identity_links WHERE issuer=? AND subject=?").get(issuer, subject); } // Resolve only verified issuer/subject pairs; names and caller-supplied Discord IDs cannot grant access.
  gameIdentity(userId) {
    const linked = this.get(userId);
    return linked ? {...linked, player_id: linked.discord_id} : this.db.prepare("SELECT * FROM web_game_accounts WHERE player_id=?").get(userId);
  } // Game ownership can use either a confirmed Discord link or a standalone LiD0llID account.
  gameAccount(identity) {
    if (!identity || typeof identity.issuer !== "string" || !identity.issuer || typeof identity.subject !== "string" || !identity.subject) throw new Error("Missing verified game identity.");
    return this.db.transaction(() => {
      const web = this.db.prepare("SELECT * FROM web_game_accounts WHERE issuer=? AND subject=?").get(identity.issuer, identity.subject);
      if (web) {
        this.db.prepare("UPDATE web_game_accounts SET username=? WHERE player_id=?").run(String(identity.username || web.username).slice(0,100), web.player_id);
        return this.gameIdentity(web.player_id);
      }
      const linked = this.find(identity.issuer, identity.subject);
      if (linked) return this.gameIdentity(linked.discord_id); // Existing Discord players retain their saves, collection and payment journal IDs.
      const id = "web_" + randomBytes(16).toString("hex");
      this.db.prepare("INSERT INTO web_game_accounts VALUES (?,?,?,?,?)").run(id, identity.issuer, identity.subject, String(identity.username || "LiD0llID player").slice(0,100), this.now());
      return this.gameIdentity(id);
    }).immediate();
  } // Only verified OIDC issuer/subject pairs may create or resume a player; display names never grant ownership.
  hasTicket(ticket) {
    return Boolean(this.db.prepare("SELECT 1 FROM identity_attempts WHERE ticket = ? AND expires > ?").get(hash(ticket), this.now()));
  } // Reject fabricated tickets locally before making any provider requests.
  begin(discordId, reconnect = false) {
    this.prune();
    if (this.get(discordId) && !reconnect) throw new Error("Already linked. Use /lidollid unlink before choosing another account.");
    const ticket = secret();
    this.db.prepare("INSERT OR REPLACE INTO identity_attempts(discord_id, generation, ticket, expires, reconnect) VALUES (?, ?, ?, ?, ?)")
      .run(discordId, secret(), hash(ticket), this.now() + lifetime, Number(reconnect));
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
    const linked = this.get(attempt.discord_id);
    if (linked && (linked.issuer !== identity.issuer || linked.subject !== identity.subject)) throw new Error("Sign in to the account already linked to this Discord user, or unlink first.");
    const code = randomBytes(16).toString("hex");
    const result = this.db.prepare(`UPDATE identity_attempts SET confirmation = ?, issuer = ?, subject = ?, username = ?
      WHERE discord_id = ? AND generation = ? AND expires > ? AND ticket IS NULL AND browser IS NULL AND confirmation IS NULL`)
      .run(hash(code), identity.issuer, identity.subject, identity.username, attempt.discord_id, attempt.generation, this.now());
    if (!result.changes) throw new Error("Login expired or was replaced. Start again in Discord.");
    return code;
  } // Stage verified identity only; the browser cannot finalize a Discord account link.

  pendingConfirmation(discordId, code) { // Validate the original Discord confirmation before any wallet exchange.
    this.prune();
    const attempt=this.db.prepare('SELECT * FROM identity_attempts WHERE discord_id=? AND confirmation=?').get(discordId,hash(code));
    if(!attempt)throw new Error('Invalid or expired confirmation code.');
    const existing=this.get(discordId);
    if(existing&&(!attempt.reconnect||existing.issuer!==attempt.issuer||existing.subject!==attempt.subject))throw new Error('Already linked. Unlink before changing accounts.');
    if(this.db.prepare('SELECT 1 FROM identity_links WHERE issuer=? AND subject=? AND discord_id!=?').get(attempt.issuer,attempt.subject,discordId))throw new Error('This LiD0llID is already linked to another Discord account.');
    return attempt;
  }

  confirm(discordId, code, activateWallet = null) {
    this.prune();
    return this.db.transaction(() => {
      const attempt = this.db.prepare("SELECT * FROM identity_attempts WHERE discord_id = ? AND confirmation = ?").get(discordId, hash(code));
      if (!attempt) throw new Error("Invalid or expired confirmation code. Use the code from your own sign-in page.");
      const existing=this.get(discordId);
      if (existing && (!attempt.reconnect || existing.issuer!==attempt.issuer || existing.subject!==attempt.subject)) throw new Error("Already linked. Unlink before changing accounts.");
      if (this.db.prepare("SELECT 1 FROM identity_links WHERE issuer = ? AND subject = ? AND discord_id != ?").get(attempt.issuer, attempt.subject, discordId)) {
        throw new Error("This LiD0llID is already linked to another Discord account.");
      }
      this.db.prepare("INSERT OR REPLACE INTO identity_links VALUES (?, ?, ?, ?, ?)").run(discordId, attempt.issuer, attempt.subject, attempt.username, this.now());
      if (activateWallet) activateWallet(); // Wallet activation must succeed before this identity transaction commits.
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
