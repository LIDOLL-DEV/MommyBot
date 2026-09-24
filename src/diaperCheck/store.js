import Database from "better-sqlite3";
import { randomInt, randomUUID } from "node:crypto";

export const HOUR = 3_600_000;
export const CHECK_MIN_MS = 2 * HOUR;
export const CHECK_MAX_MS = 4 * HOUR;
export const ANSWER_WINDOW_MS = 60 * 60_000;
export const FOLLOWUP_WINDOW_MS = 15 * 60_000;
export const MAX_FOLLOWUPS = 4;
export const SILENT_START_HOUR = 22;
export const SILENT_END_HOUR = 6;

export function silentHour(now, hourOf = time => new Date(time).getHours()) {
  const hour = hourOf(now);
  return hour >= SILENT_START_HOUR || hour < SILENT_END_HOUR;
} // Quiet 22:00 to 06:00 in the bot host's own time zone, which is what "server time" means for this deployment.

export class DiaperCheckStore {
  constructor(filename, { now = Date.now, draw = randomInt } = {}) {
    this.db = new Database(filename); this.now = now; this.draw = draw;
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`CREATE TABLE IF NOT EXISTS diaper_checks (
      id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, channel_id TEXT NOT NULL,
      kind TEXT NOT NULL, event_id TEXT, event_kind TEXT, state TEXT NOT NULL, answer TEXT,
      created INTEGER NOT NULL, asked INTEGER NOT NULL DEFAULT 0, message_id TEXT,
      answered INTEGER, notified INTEGER NOT NULL DEFAULT 0, clarified INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS diaper_checks_open ON diaper_checks(guild_id,user_id,state,created);
      CREATE INDEX IF NOT EXISTS diaper_checks_work ON diaper_checks(state,asked,notified);
      CREATE TABLE IF NOT EXISTS diaper_guild_schedule (guild_id TEXT PRIMARY KEY, next_check INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS diaper_roster (
      guild_id TEXT NOT NULL, user_id TEXT NOT NULL, cycle INTEGER NOT NULL DEFAULT 0, called_at INTEGER,
      PRIMARY KEY(guild_id,user_id));
      DROP INDEX IF EXISTS diaper_checks_event;
      DROP TABLE IF EXISTS diaper_events; DROP TABLE IF EXISTS diaper_cursor;
      DROP TABLE IF EXISTS diaper_care; DROP TABLE IF EXISTS diaper_schedule;`);
    // The retired Littlepottchi care copies and per-member windows are removed; checks no longer rest on any record.
    const columns = new Set(this.db.prepare("PRAGMA table_info(diaper_checks)").all().map(column => column.name));
    if (!columns.has("followups")) this.db.exec("ALTER TABLE diaper_checks ADD COLUMN followups INTEGER NOT NULL DEFAULT 0");
    // Existing journals gain conversation counters without losing any saved question or answer.
  } // Keep open questions, the rotation and each server's next check durable so a restart never re-asks or double-asks.

  interval() { return CHECK_MIN_MS + this.draw(CHECK_MAX_MS - CHECK_MIN_MS + 1); } // A uniform 2-4 hour gap, redrawn after every check.

  get(id) { return this.db.prepare("SELECT * FROM diaper_checks WHERE id=?").get(id); }

  nextInCycle(guild, users, now = this.now()) {
    if (!users.length) return null;
    const rows = users.map(user => this.db.prepare("SELECT * FROM diaper_roster WHERE guild_id=? AND user_id=?").get(guild, user)
      ?? { guild_id: guild, user_id: user, cycle: 0, called_at: null });
    const lowest = Math.min(...rows.map(row => row.cycle));
    const waiting = rows.filter(row => row.cycle === lowest);
    return waiting[this.draw(waiting.length)].user_id;
  } // Everyone is called once before anyone is called twice; ties inside a cycle are still drawn at random.

  markCalled(guild, user, now = this.now()) {
    this.db.prepare(`INSERT INTO diaper_roster VALUES (?,?,1,?)
      ON CONFLICT(guild_id,user_id) DO UPDATE SET cycle=cycle+1,called_at=excluded.called_at`).run(guild, user, now);
  } // The call log is what makes the rotation fair, and it survives restarts.

  prune() {
    this.db.prepare("DELETE FROM diaper_checks WHERE state!='open' AND notified=1 AND created<?").run(this.now() - 30 * 24 * HOUR);
  } // Answered checks are not a permanent record.

  open(guild, user) {
    return this.db.prepare("SELECT * FROM diaper_checks WHERE guild_id=? AND user_id=? AND state='open' ORDER BY created DESC LIMIT 1").get(guild, user);
  }
  openInGuild(guild) {
    return this.db.prepare("SELECT * FROM diaper_checks WHERE guild_id=? AND state='open' ORDER BY created LIMIT 1").get(guild);
  } // One question at a time per server, so the channel is never filled with several at once.
  recentAnswered(guild, user, channel, now = this.now()) {
    return this.db.prepare(`SELECT * FROM diaper_checks WHERE guild_id=? AND user_id=? AND channel_id=? AND state='answered'
      AND notified=1 AND answered>? AND followups<? ORDER BY answered DESC LIMIT 1`)
      .get(guild, user, channel, now - FOLLOWUP_WINDOW_MS, MAX_FOLLOWUPS);
  } // Keep talking for a short while after a check closes, with a hard reply cap so the channel cannot become an endless chat.
  bumpFollowup(id) { this.db.prepare("UPDATE diaper_checks SET followups=followups+1 WHERE id=?").run(id); }

  openAnywhere(user) {
    return this.db.prepare("SELECT * FROM diaper_checks WHERE user_id=? AND state='open' ORDER BY created DESC LIMIT 1").get(user);
  } // A member is only ever asked one question at a time, even across servers.

  record({ guild, user, channel, kind }) {
    const id = randomUUID(), created = this.now();
    const saved = this.db.transaction(() => {
      if (this.open(guild, user)) return null; // One open question per member.
      this.db.prepare(`INSERT INTO diaper_checks (id,guild_id,user_id,channel_id,kind,state,created)
        VALUES (?,?,?,?,?,'open',?)`).run(id, guild, user, channel, kind, created);
      this.reschedule(guild, created);
      return this.get(id);
    })();
    return saved?.id === id ? { check: saved, fresh: true } : { check: saved, fresh: false };
  } // Journal the question before Discord is contacted, so a failed send is retried instead of silently lost.

  markAsked(id, messageId) {
    this.db.prepare("UPDATE diaper_checks SET asked=1,message_id=? WHERE id=?").run(messageId ?? null, id);
  }
  answer(id, answer) {
    this.db.prepare("UPDATE diaper_checks SET state='answered',answer=?,answered=? WHERE id=? AND state='open'")
      .run(answer, this.now(), id);
    return this.get(id);
  } // Record the decided answer once; a later message cannot reopen or rewrite a closed check.
  markNotified(id) { this.db.prepare("UPDATE diaper_checks SET notified=1 WHERE id=?").run(id); }
  markClarified(id) {
    return this.db.prepare("UPDATE diaper_checks SET clarified=1 WHERE id=? AND clarified=0").run(id).changes === 1;
  } // Ask for a plain yes or no exactly once; further unclear chatter belongs to ordinary conversation.

  expire(now = this.now()) {
    return this.db.prepare("UPDATE diaper_checks SET state='expired',notified=1 WHERE state='open' AND asked=1 AND created<?")
      .run(now - ANSWER_WINDOW_MS).changes;
  } // An unanswered question stops blocking future checks after an hour, and is never chastised for silence.

  unsent() { return this.db.prepare("SELECT * FROM diaper_checks WHERE state='open' AND asked=0 ORDER BY created,id").all(); }
  unfinished() { return this.db.prepare("SELECT * FROM diaper_checks WHERE state='answered' AND notified=0 ORDER BY created,id").all(); }

  reschedule(guild, now = this.now()) {
    this.db.prepare("INSERT INTO diaper_guild_schedule VALUES (?,?) ON CONFLICT(guild_id) DO UPDATE SET next_check=excluded.next_check")
      .run(guild, now + this.interval());
  } // Every check in a server, however it started, pushes that server's next random check 2-4 hours out.

  due(guild, now = this.now()) {
    const saved = this.db.prepare("SELECT next_check FROM diaper_guild_schedule WHERE guild_id=?").get(guild);
    if (!saved) { this.reschedule(guild, now); return false; } // A newly enabled server waits a full window before its first check.
    return saved.next_check <= now;
  } // Report whether this server's random window has passed, leaving the choice of member to the caller.

  close() { this.db.close(); }
}
