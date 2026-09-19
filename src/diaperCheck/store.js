import Database from "better-sqlite3";
import { randomInt, randomUUID } from "node:crypto";

export const HOUR = 3_600_000;
export const CHECK_MIN_MS = 6 * HOUR;
export const CHECK_MAX_MS = 12 * HOUR;
export const ANSWER_WINDOW_MS = 60 * 60_000;
export const FOLLOWUP_WINDOW_MS = 15 * 60_000;
export const MAX_FOLLOWUPS = 4;
export const RANDOM_GAP_MS = 30 * 60_000;
export const ACCIDENT_WINDOW_MS = 4 * HOUR;
export const CHANGE_SUPERSEDES_MS = 15 * 60_000;
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
    this.db.exec(`CREATE TABLE IF NOT EXISTS diaper_events (
      id TEXT PRIMARY KEY, sequence INTEGER NOT NULL, kind TEXT NOT NULL, seen INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS diaper_cursor (id INTEGER PRIMARY KEY CHECK(id=1), position INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS diaper_checks (
      id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, channel_id TEXT NOT NULL,
      kind TEXT NOT NULL, event_id TEXT, event_kind TEXT, state TEXT NOT NULL, answer TEXT,
      created INTEGER NOT NULL, asked INTEGER NOT NULL DEFAULT 0, message_id TEXT,
      answered INTEGER, notified INTEGER NOT NULL DEFAULT 0, clarified INTEGER NOT NULL DEFAULT 0);
      CREATE UNIQUE INDEX IF NOT EXISTS diaper_checks_event ON diaper_checks(guild_id,event_id) WHERE event_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS diaper_checks_open ON diaper_checks(guild_id,user_id,state,created);
      CREATE INDEX IF NOT EXISTS diaper_checks_work ON diaper_checks(state,asked,notified);
      CREATE TABLE IF NOT EXISTS diaper_schedule (
      guild_id TEXT NOT NULL, user_id TEXT NOT NULL, next_check INTEGER NOT NULL, PRIMARY KEY(guild_id,user_id));
      CREATE TABLE IF NOT EXISTS diaper_care (
      user_id TEXT PRIMARY KEY, revision TEXT NOT NULL, kind TEXT, accident_at INTEGER, praised_at INTEGER);
      CREATE TABLE IF NOT EXISTS diaper_roster (
      guild_id TEXT NOT NULL, user_id TEXT NOT NULL, cycle INTEGER NOT NULL DEFAULT 0, called_at INTEGER,
      PRIMARY KEY(guild_id,user_id));`);
    const columns = new Set(this.db.prepare("PRAGMA table_info(diaper_checks)").all().map(column => column.name));
    if (!columns.has("followups")) this.db.exec("ALTER TABLE diaper_checks ADD COLUMN followups INTEGER NOT NULL DEFAULT 0");
    // Existing journals gain conversation counters without losing any saved question or answer.
  } // Keep seen events, open questions and per-member scheduling durable so a restart never re-asks or double-asks.

  interval() { return CHECK_MIN_MS + this.draw(CHECK_MAX_MS - CHECK_MIN_MS + 1); } // A uniform 6-12 hour gap, redrawn after every check.

  get(id) { return this.db.prepare("SELECT * FROM diaper_checks WHERE id=?").get(id); }
  cursor() { return this.db.prepare("SELECT position FROM diaper_cursor WHERE id=1").get()?.position ?? 0; }
  saveCursor(position) {
    this.db.prepare("INSERT INTO diaper_cursor VALUES (1,?) ON CONFLICT(id) DO UPDATE SET position=excluded.position").run(position);
  } // Remember where the read-only feed pass stopped; this is never an acknowledgement to Little Log.

  observe({ discordId, revision, kind }, now = this.now()) {
    const previous = this.db.prepare("SELECT * FROM diaper_care WHERE user_id=?").get(discordId);
    if (!previous) {
      this.db.prepare("INSERT INTO diaper_care VALUES (?,?,?,?,NULL)").run(discordId, revision, kind, kind ? now : null);
      return null; // A member first seen mid-accident is recorded, never announced as if it just happened.
    }
    if (previous.revision !== revision) {
      const wasSoiled = Boolean(previous.accident_at);
      const supersedes = wasSoiled && now - previous.accident_at <= CHANGE_SUPERSEDES_MS;
      this.db.prepare("UPDATE diaper_care SET revision=?,kind=?,accident_at=? WHERE user_id=?")
        .run(revision, kind, kind ? now : supersedes ? null : previous.accident_at, discordId);
      return wasSoiled ? { change: true, supersedes } : null;
    } // A fresh diaper revision after a soiled one is a change; within the window it also clears the pending check.
    if (kind && !previous.accident_at) {
      this.db.prepare("UPDATE diaper_care SET kind=?,accident_at=? WHERE user_id=?").run(kind, now, discordId);
    }
    return null;
  } // Derive accidents and changes from the diaper revision alone, so no care record is ever copied into this journal.

  praise(user, now = this.now()) {
    return this.db.prepare("UPDATE diaper_care SET praised_at=? WHERE user_id=? AND (praised_at IS NULL OR praised_at<?)")
      .run(now, user, now - CHANGE_SUPERSEDES_MS).changes === 1;
  } // One praise per change; a quick second change cannot be farmed for repeated compliments.

  soiled(users, now = this.now()) {
    if (!users.length) return [];
    const marks = users.map(() => "?").join(",");
    return this.db.prepare(`SELECT user_id,kind,accident_at FROM diaper_care WHERE user_id IN (${marks}) AND accident_at IS NOT NULL AND accident_at>?`)
      .all(...users, now - ACCIDENT_WINDOW_MS);
  } // Everyone who has used their diaper inside the window and has not since been changed out of it.

  clearAccident(user) { this.db.prepare("UPDATE diaper_care SET accident_at=NULL WHERE user_id=?").run(user); }

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
    this.db.prepare("DELETE FROM diaper_events WHERE seen<?").run(this.now() - 7 * 24 * HOUR);
    this.db.prepare("UPDATE diaper_care SET accident_at=NULL WHERE accident_at<?").run(this.now() - ACCIDENT_WINDOW_MS);
    this.db.prepare("DELETE FROM diaper_checks WHERE state!='open' AND notified=1 AND created<?").run(this.now() - 30 * 24 * HOUR);
  } // Bound both journals; events expire upstream after a day and answered checks are not a permanent record.

  open(guild, user) {
    return this.db.prepare("SELECT * FROM diaper_checks WHERE guild_id=? AND user_id=? AND state='open' ORDER BY created DESC LIMIT 1").get(guild, user);
  }
  openInGuild(guild) {
    return this.db.prepare("SELECT * FROM diaper_checks WHERE guild_id=? AND state='open' ORDER BY created LIMIT 1").get(guild);
  } // One question at a time per server, so several accidents or overdue members never fill the channel at once.
  lastStarted(guild) {
    return this.db.prepare("SELECT MAX(created) AS created FROM diaper_checks WHERE guild_id=?").get(guild)?.created ?? 0;
  }
  recentAnswered(guild, user, channel, now = this.now()) {
    return this.db.prepare(`SELECT * FROM diaper_checks WHERE guild_id=? AND user_id=? AND channel_id=? AND state='answered'
      AND notified=1 AND answered>? AND followups<? ORDER BY answered DESC LIMIT 1`)
      .get(guild, user, channel, now - FOLLOWUP_WINDOW_MS, MAX_FOLLOWUPS);
  } // Keep talking for a short while after a check closes, with a hard reply cap so the channel cannot become an endless chat.
  bumpFollowup(id) { this.db.prepare("UPDATE diaper_checks SET followups=followups+1 WHERE id=?").run(id); }

  openAnywhere(user) {
    return this.db.prepare("SELECT * FROM diaper_checks WHERE user_id=? AND state='open' ORDER BY created DESC LIMIT 1").get(user);
  } // A member is only ever asked one question at a time, so a second accident cannot stack another prompt.

  record({ guild, user, channel, kind, event = null, eventKind = null }) {
    const id = randomUUID(), created = this.now();
    const saved = this.db.transaction(() => {
      if (event) {
        const duplicate = this.db.prepare("SELECT * FROM diaper_checks WHERE guild_id=? AND event_id=?").get(guild, event);
        if (duplicate) return duplicate;
      }
      if (this.open(guild, user)) return null; // One open question per member; the newer accident is covered by the pending answer.
      this.db.prepare(`INSERT INTO diaper_checks (id,guild_id,user_id,channel_id,kind,event_id,event_kind,state,created)
        VALUES (?,?,?,?,?,?,?,'open',?)`).run(id, guild, user, channel, kind, event, eventKind, created);
      this.reschedule(guild, user);
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

  reschedule(guild, user, now = this.now()) {
    this.db.prepare("INSERT INTO diaper_schedule VALUES (?,?,?) ON CONFLICT(guild_id,user_id) DO UPDATE SET next_check=excluded.next_check")
      .run(guild, user, now + this.interval());
  } // Every check, however it started, resets that member's 6-12 hour window.

  due(guild, users, now = this.now()) {
    const overdue = [];
    for (const user of users) {
      const saved = this.db.prepare("SELECT next_check FROM diaper_schedule WHERE guild_id=? AND user_id=?").get(guild, user);
      if (!saved) { this.reschedule(guild, user, now); continue; } // A newly eligible member waits a full window before their first check.
      if (saved.next_check <= now) overdue.push(user);
    }
    return overdue;
  } // Report who has gone a full random window without any check, leaving the choice of one member to the caller.

  close() { this.db.close(); }
}
