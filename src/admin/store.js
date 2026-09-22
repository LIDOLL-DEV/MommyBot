import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export class AdminError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
} // Return deliberate operator-facing errors without exposing Discord payloads or credentials.

export function discordId(value) {
  if (typeof value !== "string" || !/^\d{17,20}$/.test(value)) throw new AdminError("Choose a valid Discord channel, message or role ID.");
  return value;
} // IDs remain strings so Discord snowflakes never lose integer precision.

export function emojiKey(value) {
  const text = String(value ?? "").trim();
  const custom = /^<a?:[A-Za-z0-9_]{2,32}:(\d{17,20})>$/.exec(text);
  if (custom) return custom[1];
  if (/^\d{17,20}$/.test(text)) return text;
  if (!text || text.length > 32 || !/[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(text) || /[\s<>"'\\]/u.test(text)) throw new AdminError("Use one Unicode emoji or a Discord custom emoji.");
  const parts = [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(text)];
  if (parts.length !== 1) throw new AdminError("Choose one emoji.");
  return text.replace(/\uFE0F/g, "");
} // Match Unicode presentation variants and custom emojis by their stable Discord ID.

export function swearWordList(value) {
  const words = value ?? [];
  if (!Array.isArray(words) || words.length > 200) throw new AdminError("Use at most two hundred swear jar words.");
  const cleaned = words.map(word => String(word ?? "").normalize("NFKC").trim().toLowerCase()).filter(Boolean);
  if (cleaned.some(word => word.length > 40 || /\p{C}/u.test(word))) throw new AdminError("Each swear jar word must be at most forty characters and contain no control characters.");
  return [...new Set(cleaned)];
} // Normalize and deduplicate exactly as the matcher does, so the saved list is what the jar really tests against.

export class AdminStore {
  constructor(filename, now = Date.now) {
    this.db = new Database(filename); this.now = now;
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`CREATE TABLE IF NOT EXISTS admin_settings(guild_id TEXT PRIMARY KEY, settings TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reaction_roles(id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL, emoji TEXT NOT NULL, role_id TEXT NOT NULL, UNIQUE(guild_id,message_id,emoji), UNIQUE(guild_id,role_id));
      CREATE TABLE IF NOT EXISTS reaction_role_grants(binding_id TEXT NOT NULL, user_id TEXT NOT NULL, owned INTEGER NOT NULL,
      PRIMARY KEY(binding_id,user_id));
      CREATE TABLE IF NOT EXISTS starboard_posts(guild_id TEXT NOT NULL, source_id TEXT NOT NULL, source_channel TEXT NOT NULL,
      channel_id TEXT NOT NULL, post_id TEXT NOT NULL, PRIMARY KEY(guild_id,source_id));
      CREATE TABLE IF NOT EXISTS starboard_pending(guild_id TEXT NOT NULL, source_id TEXT NOT NULL, source_channel TEXT NOT NULL,
      PRIMARY KEY(guild_id,source_id));
      CREATE TABLE IF NOT EXISTS admin_audit(id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, actor TEXT NOT NULL,
      action TEXT NOT NULL, detail TEXT NOT NULL, created INTEGER NOT NULL);`);
  } // Keep server configuration, reaction ownership and starboard message IDs durable across deployments.

  settings(guild) {
    const saved = this.db.prepare("SELECT settings FROM admin_settings WHERE guild_id=?").get(guild);
    return { chat: true, swearJar: true, swearJarIgnored: [], swearWords: [], welcomes: true, littlepottchi: true,
      diaperChecks: { enabled: false, channel: "", role: "" }, showcase: { enabled: false, channel: "" }, starboard: { enabled: false, channel: "", sources: [], emoji: "⭐", threshold: 3, audience: "" }, ...JSON.parse(saved?.settings || "{}") };
  }
  save(guild, settings, actor) {
    this.db.transaction(() => {
      this.db.prepare("INSERT OR REPLACE INTO admin_settings VALUES (?,?)").run(guild, JSON.stringify(settings));
      this.audit(guild, actor, "settings.saved", "Server controls and starboard settings updated.");
    })();
  } // Commit settings and their audit entry together; global environment switches still take precedence.
  bindings(guild) { return this.db.prepare("SELECT * FROM reaction_roles WHERE guild_id=? ORDER BY channel_id,message_id,emoji").all(guild); }
  binding(id) { return this.db.prepare("SELECT * FROM reaction_roles WHERE id=?").get(id); }
  addBinding(guild, input, actor) {
    const row = { id: randomUUID(), guild_id: guild, channel_id: input.channel, message_id: input.message, emoji: input.emoji, role_id: input.role };
    this.db.transaction(() => {
      if (this.bindings(guild).length >= 100) throw new AdminError("This server already has the maximum of one hundred reaction-role mappings.");
      if (this.db.prepare("SELECT 1 FROM reaction_roles WHERE guild_id=? AND (role_id=? OR (message_id=? AND emoji=?))").get(guild, row.role_id, row.message_id, row.emoji)) throw new AdminError("That role or message/emoji already has a mapping. Remove its old mapping first.");
      this.db.prepare("INSERT INTO reaction_roles VALUES (@id,@guild_id,@channel_id,@message_id,@emoji,@role_id)").run(row);
      this.audit(guild, actor, "reaction-role.added", `Message ${row.message_id}; role ${row.role_id}; emoji ${row.emoji}`);
    })();
    return row;
  } // Each self-service role has a single binding, so removing a reaction cannot conflict with another mapping.
  addBindings(guild, input, actor) {
    return this.db.transaction(() => input.choices.map(choice => this.addBinding(guild, { channel: input.channel, message: input.message, ...choice }, actor)))();
  } // Save all emoji/role choices together; a conflict or mapping limit rolls back the entire batch.
  deleteBinding(id, actor) {
    const row = this.binding(id); if (!row) return;
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM reaction_roles WHERE id=?").run(id);
      this.db.prepare("DELETE FROM reaction_role_grants WHERE binding_id=?").run(id);
      this.audit(row.guild_id, actor, "reaction-role.removed", `Message ${row.message_id}; existing member roles retained.`);
    })();
  } // Stop managing the mapping without mass-removing roles from members.
  audit(guild, actor, action, detail) {
    this.db.prepare("INSERT INTO admin_audit(guild_id,actor,action,detail,created) VALUES (?,?,?,?,?)").run(guild, actor, action, String(detail).slice(0, 500), this.now());
    this.db.prepare("DELETE FROM admin_audit WHERE guild_id=? AND id NOT IN (SELECT id FROM admin_audit WHERE guild_id=? ORDER BY id DESC LIMIT 200)").run(guild, guild);
  } // Store a bounded, secret-free activity history per server.
  history(guild) { return this.db.prepare("SELECT actor,action,detail,created FROM admin_audit WHERE guild_id=? ORDER BY id DESC LIMIT 30").all(guild); }
  close() { this.db.close(); }
}
