import { randomInt, randomUUID } from "node:crypto";
import { GachaError } from "../gacha/store.js";
import { advanceExcitement, useToy } from "./excitement.js";

export const HOUR = 3600000;
const DAY = 24 * HOUR;
export const messyRules = { minInterval: 10 * HOUR, maxInterval: 14 * HOUR, bulkPerAccident: 2, label: "Game timer · messy accidents every 10–14 hours while enabled" };
export const careRules = {
  feed: { every: 4 * HOUR }, water: { every: 2 * HOUR },
  play: { every: 3 * HOUR, duration: 120000, rewards: { joy: 25, energy: -10, hunger: -5 } },
  rest: { every: 8 * HOUR, duration: 300000, rewards: { energy: 35 } },
};
const clamp = value => Math.max(0, Math.min(100, value));
const fallback = { reportId: null, interval: 4 * HOUR, rate: null, label: "Default rhythm · waiting for a completed Little Log analysis" };
const messages = { wet: "Your Littlepottchi has a wet diaper.", mess: "Your Littlepottchi has a messy diaper and needs a fresh change.", leak: "Your Littlepottchi is leaking and needs a fresh diaper.",
  cleanup: "Your Littlepottchi needs a baby wipe before a fresh diaper.",
  feed: "Your Littlepottchi is ready for food.", water: "Your Littlepottchi is ready for water.",
  play: "Your Littlepottchi would like some playtime.", rest: "Your Littlepottchi is ready for a rest.", complete: "Your Littlepottchi finished a timed activity." };

export function analysisProfile(input, now) {
  if (!input || typeof input.reportId !== "string" || !/^[\w-]{1,100}$/.test(input.reportId) ||
      !Number.isSafeInteger(input.finished) || input.finished < 0 || input.finished > now + 60000 ||
      !Array.isArray(input.days) || !input.days.length || input.days.length > 3660) throw new GachaError("Invalid completed analysis snapshot.");
  let wettings = 0, participantDays = 0;
  const dates = new Set();
  for (const row of input.days) {
    if (!row || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || dates.has(row.date) ||
        !Number.isSafeInteger(row.wettings) || row.wettings < 0 || row.wettings > 10000000 ||
        !Number.isSafeInteger(row.activeParticipants) || row.activeParticipants < 0 || row.activeParticipants > 10000000 ||
        (row.wettings && !row.activeParticipants)) throw new GachaError("Invalid daily aggregate counts.");
    dates.add(row.date); wettings += row.wettings; participantDays += row.activeParticipants;
  }
  if (!participantDays) throw new GachaError("The analysis needs at least one active participant-day.");
  const rate = wettings / participantDays, rawInterval = rate ? DAY / rate : null;
  return { reportId: input.reportId, finished: input.finished, wettings, participantDays, rate,
    interval: rawInterval === null ? null : Math.max(30 * 60000, Math.min(DAY, Math.round(rawInterval))),
    limited: rawInterval !== null && (rawInterval < 30 * 60000 || rawInterval > DAY),
    label: "Community rhythm from the latest completed Little Log analysis" };
} // Derive a rate from the report's saved counts, including potty wettings and excluding random game rolls.

export class PetCare {
  constructor(db, catalog, now, random = randomInt) {
    this.db = db; this.catalog = catalog; this.now = now; this.random = random;
    db.exec(`CREATE TABLE IF NOT EXISTS littlepottchi_analysis(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS littlepottchi_events(id INTEGER PRIMARY KEY AUTOINCREMENT,token TEXT UNIQUE NOT NULL,
      user_id TEXT NOT NULL,kind TEXT NOT NULL,episode TEXT NOT NULL,created INTEGER NOT NULL,acked INTEGER NOT NULL DEFAULT 0,
      UNIQUE(user_id,kind,episode));`);
  } // Keep simulation, source metadata and delivery receipts in the same durable pet database.

  profile() { const row = this.db.prepare("SELECT data FROM littlepottchi_analysis WHERE id=1").get(); return row ? JSON.parse(row.data) : fallback; }

  messyInterval() { return this.random(messyRules.minInterval, messyRules.maxInterval + 1); } // Choose a fresh, uniform delay in milliseconds, including both the 10-hour and 14-hour endpoints.

  importAnalysis(input) {
    const profile = analysisProfile(input, this.now()), old = this.profile();
    if (old.reportId === profile.reportId) {
      if (JSON.stringify(old) !== JSON.stringify(profile)) throw new GachaError("A saved report cannot be replaced with different counts.");
      return { accepted: true, unchanged: true };
    }
    if (old.reportId && profile.finished <= old.finished) return { accepted: false, stale: true };
    this.db.prepare("INSERT INTO littlepottchi_analysis VALUES (1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").run(JSON.stringify(profile));
    return { accepted: true };
  } // Replayed report uploads are harmless; an older report cannot move the community rhythm backward.

  advance(p, diaper) {
    const now = Math.max(p.updated, this.now()), profile = this.profile();
    if (!p.care) {
      p.hydration = 85;
      p.care = { wetness: 0, wettings: 0, leaking: false, revision: randomUUID(), reminders: false,
        interval: profile.interval, reportId: profile.reportId, nextWettingAt: profile.interval === null ? null : now + profile.interval,
        due: Object.fromEntries(Object.entries(careRules).map(([key, rule]) => [key, now + rule.every])), task: null, completed: null };
    } // Existing dolls migrate once with a fresh diaper and future timers; historical visits do not invent accidents.
    const c = p.care;
    c.messyMode ??= false; c.mess ??= 0; c.messings ??= 0;
    c.bodyWetness ??= 0; c.bodyMess ??= 0;
    c.cleanupRevision ??= randomUUID();
    c.needsWipe ??= Boolean(c.leaking); // Existing leaked diapers migrate with one cleanup requirement, regardless of accident count.
    c.nextMessAt ??= null; c.messRemaining ??= this.messyInterval();
    // Older saves start with messy mode off; migration preserves wetness, activities and the wetting clock.
    let decayFrom = p.updated;
    const decayUntil = time => {
      const hours = Math.max(0, time - decayFrom) / HOUR;
      for (const [stat, rate] of Object.entries({ hunger: 4, hydration: 6, energy: 2, comfort: 3, joy: 2 })) p[stat] = clamp(p[stat] - hours * rate);
      decayFrom = Math.max(decayFrom, time);
    };
    if (c.task && now >= c.task.finishesAt) {
      decayUntil(c.task.finishesAt);
      for (const [stat, amount] of Object.entries(careRules[c.task.kind].rewards)) p[stat] = clamp(p[stat] + amount);
      c.due[c.task.kind] = c.task.finishesAt + careRules[c.task.kind].every;
      c.completed = c.task; c.task = null; p.careCount++;
    } // Apply rewards at their completion time so the rest of an offline absence still decays normally.
    decayUntil(now);
    let wetCount = 0, messCount = 0;
    if (c.nextWettingAt !== null && now >= c.nextWettingAt) {
      const count = Math.floor((now - c.nextWettingAt) / c.interval) + 1;
      wetCount = count;
      if (diaper) c.wetness = Math.min(1000000, c.wetness + count);
      c.wettings = Math.min(Number.MAX_SAFE_INTEGER, c.wettings + count);
      c.nextWettingAt += count * c.interval;
    } // Catch up in constant time, even after a long absence; refreshing never restarts the wetting clock.
    if (c.messyMode && c.nextMessAt !== null && now >= c.nextMessAt) {
      do {
        messCount++;
        c.nextMessAt += this.messyInterval();
      } while (now >= c.nextMessAt); // Schedule from each due time so offline catch-up uses a new random delay per accident.
      if (diaper) c.mess = Math.min(1000000, c.mess + messCount);
      c.messings = Math.min(Number.MAX_SAFE_INTEGER, c.messings + messCount);
    } // Persist the next deadline; reads, restarts, changes and pause/resume never reroll an existing countdown.
    const usedBulk = c.wetness + c.mess * messyRules.bulkPerAccident;
    if (diaper && usedBulk > 0 && usedBulk >= diaper.bulk) c.leaking = true;
    if ((!diaper || c.leaking) && (wetCount || messCount)) {
      c.bodyWetness = Math.min(1000000, c.bodyWetness + wetCount);
      c.bodyMess = Math.min(1000000, c.bodyMess + messCount); c.needsWipe = true;
    } // Only new diaper-free accidents and leaks soil the doll; a wiped old leak stays clean until the next accident.
    if (c.needsWipe) p.comfort = Math.min(p.comfort, 20);
    if (c.mess) p.comfort = Math.min(p.comfort, 35);
    if (c.leaking) p.comfort = Math.min(p.comfort, 20);
    if (c.reportId !== profile.reportId || c.interval !== profile.interval) {
      const remaining = c.interval && c.nextWettingAt ? Math.max(0, Math.min(1, (c.nextWettingAt - now) / c.interval)) : 1;
      c.nextWettingAt = profile.interval === null ? null : now + Math.max(1, Math.round(remaining * profile.interval));
      c.reportId = profile.reportId; c.interval = profile.interval;
    } // A new analysis changes future rhythm without replaying elapsed time using a different rate.
    advanceExcitement(p, now);
    p.updated = now;
  }

  change(p) {
    if (p.care.needsWipe) throw new GachaError("Use one baby wipe to clean up before putting on a fresh diaper.");
    Object.assign(p.care, { wetness: 0, mess: 0, leaking: false, revision: randomUUID() });
    p.comfort = 100; p.careCount++;
  } // A fresh replacement clears the diaper but preserves the doll's next wetting time and lifetime count.

  removeDiaper(p) {
    Object.assign(p.care, { wetness: 0, mess: 0, leaking: false, revision: randomUUID() });
  } // Discard the old diaper's contents while retaining body cleanup needs and both accident clocks.

  wipe(p) {
    Object.assign(p.care, { needsWipe: false, bodyWetness: 0, bodyMess: 0, cleanupRevision: randomUUID() });
    p.comfort = 100; p.careCount++;
  } // One delivered wipe cleans every accumulated body accident; it neither replaces nor empties the worn diaper.

  act(p, input) {
    const c = p.care, action = input.action, now = this.now();
    if (["toy", "stop-toy"].includes(action)) { useToy(p, input, now); return; }
    if (action === "messy-mode") {
      if (typeof input.enabled !== "boolean") throw new GachaError("Choose whether to enable messy mode.");
      if (input.enabled !== c.messyMode) {
        if (input.enabled) c.nextMessAt = now + c.messRemaining;
        else { c.messRemaining = Math.max(1, c.nextMessAt - now); c.nextMessAt = null; }
        c.messyMode = input.enabled;
      }
      return;
    } // Repeated settings requests preserve the countdown; disabling pauses future messes without cleaning the diaper.
    if (action === "reminders") {
      if (typeof input.enabled !== "boolean") throw new GachaError("Choose whether to receive pet reminders.");
      c.reminders = input.enabled; return;
    }
    if (!Object.hasOwn(careRules, action)) throw new GachaError("Unknown doll action.");
    if ((p.cooldowns[action] || 0) > now) throw new GachaError("Your doll is still enjoying that care. Try again in a moment.");
    if (action === "feed") {
      const food = this.catalog.foods.find(item => item.id === (input.food || "apple"));
      if (!food) throw new GachaError("Choose food from the pantry.");
      p.hunger = clamp(p.hunger + food.fullness); p.joy = clamp(p.joy + food.joy); p.careCount++;
      c.due.feed = now + careRules.feed.every;
    } else if (action === "water") {
      p.hydration = clamp(p.hydration + 35); p.careCount++; c.due.water = now + careRules.water.every;
    } else {
      if (c.task) throw new GachaError("Finish the current timed activity first.");
      c.task = { id: randomUUID(), kind: action, started: now, finishesAt: now + careRules[action].duration }; c.completed = null;
    }
    p.cooldowns[action] = now + 30000;
  } // Food and water are free care supplies; play and rest must finish their server-controlled timers.

  episodes(p) {
    const c = p.care, result = {};
    if (c.needsWipe) result.cleanup = c.cleanupRevision;
    else if (c.leaking) result.leak = c.revision;
    else if (c.mess) result.mess = c.revision;
    else if (c.wetness) result.wet = c.revision;
    for (const [kind, due] of Object.entries(c.due)) if (due <= this.now() && c.task?.kind !== kind) result[kind] = String(due);
    if (c.completed && this.now() - c.completed.finishesAt < DAY) result.complete = c.completed.id;
    return result;
  } // Episode keys coalesce repeated polls into one reminder for each unresolved need.

  record(user, p) {
    if (!p.care.reminders) {
      this.db.prepare("UPDATE littlepottchi_events SET acked=1 WHERE user_id=? AND acked=0").run(user); return;
    }
    for (const [kind, episode] of Object.entries(this.episodes(p))) this.db.prepare(
      "INSERT OR IGNORE INTO littlepottchi_events(token,user_id,kind,episode,created) VALUES (?,?,?,?,?)").run(randomUUID(), user, kind, episode, this.now());
  }

  events(resolveIdentity, player, after = 0, limit = 50) {
    const result = [], now = this.now();
    let cursor = after;
    // Bound each page's scan; the caller follows nextAfter even when a page contains only stale events.
    const rows = this.db.prepare("SELECT * FROM littlepottchi_events WHERE id>? AND acked=0 ORDER BY id LIMIT ?").all(after, limit);
    for (const row of rows) {
      cursor = row.id;
      const p = player(row.user_id), identity = resolveIdentity(row.user_id);
      if (!p.care.reminders || this.episodes(p)[row.kind] !== row.episode || now - row.created >= DAY || !identity?.issuer || !identity?.subject ||
          identity.issuer !== p.care.recipient?.issuer || identity.subject !== p.care.recipient?.subject) {
        this.db.prepare("UPDATE littlepottchi_events SET acked=1 WHERE id=?").run(row.id); continue;
      }
      result.push({ id: row.token, sequence: row.id, recipient: { issuer: identity.issuer, subject: identity.subject },
        kind: row.kind, title: "Littlepottchi", body: messages[row.kind], created: row.created, expires: row.created + DAY });
    }
    return { events: result, nextAfter: cursor, more: rows.length === limit };
  } // Export only current opted-in game reminders addressed by verified identity, never personal potty records.

  ack(ids) {
    if (!Array.isArray(ids) || ids.length > 100 || ids.some(id => typeof id !== "string" || !/^[\w-]{36}$/.test(id))) throw new GachaError("Invalid reminder receipts.");
    this.db.transaction(() => { for (const id of ids) this.db.prepare("UPDATE littlepottchi_events SET acked=1 WHERE token=?").run(id); }).immediate();
    return { ok: true };
  } // Receipts are idempotent; episode tombstones prevent a delivered need from being recreated on every tick.
}
