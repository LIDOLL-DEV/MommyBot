import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { GameClock } from "../src/dressup/clock.js";
import { createPottchiControl, buildPottchiAdminCommand } from "../src/dressup/serverToggle.js";

const HOUR = 3_600_000;

function database(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "mommybot-pottchi-clock-"));
  const filename = path.join(directory, "clock.db");
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return filename;
}

test("game time stops while frozen and resumes exactly where it left off", t => {
  let real = 1_000_000;
  const db = new Database(database(t));
  const clock = new GameClock(db, () => real);
  assert.equal(clock.now(), real); // Nothing paused yet: game time is wall-clock time, so old saves need no migration.
  real += HOUR;
  assert.equal(clock.now(), 1_000_000 + HOUR);
  assert.equal(clock.freeze(), true);
  const frozenAt = clock.now();
  real += 5 * HOUR; // Hours pass in the real world...
  assert.equal(clock.now(), frozenAt); // ...but not for the dolls.
  assert.equal(clock.freeze(), false); // Freezing twice changes nothing.
  assert.equal(clock.thaw(), true);
  assert.equal(clock.now(), frozenAt); // Resumes at the instant it stopped, not five hours later.
  real += HOUR;
  assert.equal(clock.now(), frozenAt + HOUR);
  assert.equal(clock.offset(), 5 * HOUR); // Wall-clock time runs ahead by exactly the time spent frozen.
  assert.equal(clock.thaw(), false);
  db.close();
});

test("the pause survives a restart, including a restart while frozen", t => {
  let real = 5_000_000;
  const filename = database(t);
  let db = new Database(filename), clock = new GameClock(db, () => real);
  real += HOUR; clock.freeze(); const frozenAt = clock.now();
  db.close();
  real += 3 * HOUR;
  db = new Database(filename); clock = new GameClock(db, () => real);
  assert.equal(clock.frozen, true);
  assert.equal(clock.now(), frozenAt); // A restart mid-pause does not leak the downtime into the dolls.
  clock.thaw(); real += 1000;
  db.close();
  db = new Database(filename); clock = new GameClock(db, () => real);
  assert.equal(clock.frozen, false);
  assert.equal(clock.now(), frozenAt + 1000);
  db.close();
});

function control(t, { guilds = ["a"], settings = {}, clock = null, admin = true } = {}) {
  const f = { saved: [], replies: [], logs: [], settings: { ...settings } };
  f.client = { guilds: { cache: new Map(guilds.map(id => [id, { id }])) } };
  f.control = createPottchiControl(f.client, { clock, logger: { log: line => f.logs.push(line), error: line => f.logs.push(line) },
    settings: id => ({ littlepottchi: f.settings[id] ?? true }),
    setEnabled: (id, value, actor) => { f.settings[id] = value; f.saved.push({ id, value, actor }); } });
  f.slash = async (commandName, { guildId = "a", subcommand = null, isAdmin = admin } = {}) => {
    const seen = {};
    const handled = await f.control.handleInteraction({ isChatInputCommand: () => true, commandName, guildId,
      user: { id: "u1", username: "doll" }, memberPermissions: { has: () => isAdmin },
      options: { getSubcommand: () => subcommand },
      async reply(options) { seen.content = options.content; seen.ephemeral = Boolean(options.flags); } });
    return { handled, ...seen };
  };
  f.prefix = async (content, guildId = "a") => {
    const seen = {};
    const handled = await f.control.handleMessage({ guildId, content, author: { bot: false },
      async reply(options) { seen.content = options.content; } });
    return { handled, ...seen };
  };
  t.after(() => f.control.stop());
  return f;
}

test("pet commands pass through where Littlepottchi is on, and are refused privately where it is off", async t => {
  const f = control(t, { guilds: ["a", "b"], settings: { b: false } });
  for (const name of ["littlepottchi", "doll", "pottchistats"]) {
    assert.equal((await f.slash(name, { guildId: "a" })).handled, false, `${name} in an enabled server`);
    const off = await f.slash(name, { guildId: "b" });
    assert.equal(off.handled, true); assert.equal(off.ephemeral, true);
    assert.match(off.content, /turned off in this server/);
  }
  assert.equal((await f.prefix("!doll", "a")).handled, false);
  assert.match((await f.prefix("!pottchistats", "b")).content, /turned off in this server/);
  assert.equal((await f.prefix("!doll please", "b")).handled, false); // Only the exact aliases are intercepted.
  assert.equal((await f.slash("lidollid", { guildId: "b" })).handled, false); // Unrelated commands are never touched.
});

test("/pottchiadmin switches this server and records who did it, for administrators only", async t => {
  const f = control(t);
  const denied = await f.slash("pottchiadmin", { subcommand: "disable", isAdmin: false });
  assert.match(denied.content, /Only a server administrator/);
  assert.deepEqual(f.saved, []);
  assert.match((await f.slash("pottchiadmin", { subcommand: "status" })).content, /is \*\*on\*\*/);
  const off = await f.slash("pottchiadmin", { subcommand: "disable" });
  assert.equal(off.ephemeral, true);
  assert.match(off.content, /is now \*\*off\*\*/);
  assert.deepEqual(f.saved, [{ id: "a", value: false, actor: "doll" }]);
  await f.slash("pottchiadmin", { subcommand: "disable" }); // Already off: nothing re-saved or re-audited.
  assert.equal(f.saved.length, 1);
  assert.match((await f.slash("pottchiadmin", { subcommand: "enable" })).content, /is now \*\*on\*\*/);
  assert.equal(f.saved.length, 2);
  const cmd = buildPottchiAdminCommand().toJSON();
  assert.equal(cmd.default_member_permissions, "8"); // Hidden from non-administrators by default.
  assert.deepEqual(cmd.options.map(option => option.name), ["disable", "enable", "status"]);
});

test("doll clocks freeze only once every server has Littlepottchi off, and resume when any turns it back on", async t => {
  let real = 10_000_000;
  const db = new Database(database(t));
  const clock = new GameClock(db, () => real);
  const f = control(t, { guilds: ["a", "b"], clock });
  await f.slash("pottchiadmin", { guildId: "a", subcommand: "disable" });
  assert.equal(clock.frozen, false); // Server b still plays, so no one else's doll is stopped.
  const partial = await f.slash("pottchiadmin", { guildId: "a", subcommand: "status" });
  assert.match(partial.content, /still on in another server/);
  await f.slash("pottchiadmin", { guildId: "b", subcommand: "disable" });
  assert.equal(clock.frozen, true);
  assert.match((await f.slash("pottchiadmin", { guildId: "b", subcommand: "status" })).content, /\*\*paused\*\*/);
  const frozenAt = clock.now();
  real += 2 * HOUR;
  await f.slash("pottchiadmin", { guildId: "a", subcommand: "enable" });
  assert.equal(clock.frozen, false);
  assert.equal(clock.now(), frozenAt); // Two hours off cost the dolls nothing.
  assert.ok(f.logs.some(line => /Paused/.test(line)) && f.logs.some(line => /Resumed/.test(line)));
  db.close();
});

test("a single-server deployment freezes as soon as its only server turns Littlepottchi off", async t => {
  const db = new Database(database(t));
  const clock = new GameClock(db, () => 1);
  const f = control(t, { guilds: ["only"], clock });
  await f.slash("pottchiadmin", { guildId: "only", subcommand: "disable" });
  assert.equal(clock.frozen, true);
  db.close();
});

test("a bot in no servers never freezes anything", t => {
  const db = new Database(database(t));
  const clock = new GameClock(db, () => 1);
  const f = control(t, { guilds: [], clock });
  assert.equal(f.control.sync(), false);
  db.close();
});

test("a real doll neither wets nor gets hungry while paused, and carries on normally afterwards", async t => {
  const { dressupFixture } = await import("../scripts/fixtures/dressup.mjs");
  const { LittlepottchiStore } = await import("../src/dressup/store.js");
  const f = dressupFixture(); t.after(() => f.close());
  const clock = new GameClock(f.clothes.db, () => f.now);
  const doll = new LittlepottchiStore(f.clothes, f.diapers, f.catalog, clock.now);
  doll.clock = clock;
  doll.care.importAnalysis({ reportId: "report-busy", finished: f.now,
    days: [{ date: "2026-09-14", wettings: 48, activeParticipants: 1 }, { date: "2026-09-15", wettings: 48, activeParticipants: 1 }] });
  const before = doll.snapshot(f.user);
  assert.equal(before.paused, false);
  clock.freeze();
  f.now += 48 * HOUR; // Two days with the game switched off.
  const during = doll.snapshot(f.user);
  assert.equal(during.paused, true);
  assert.equal(during.player.hunger, before.player.hunger);
  assert.equal(during.player.care.wettings, before.player.care.wettings);
  assert.equal(during.player.care.wetness, before.player.care.wetness);
  assert.deepEqual(during.player.care.due, before.player.care.due);
  clock.thaw();
  const resumed = doll.snapshot(f.user);
  assert.equal(resumed.player.hunger, before.player.hunger); // Resuming costs nothing for the time spent off.
  assert.equal(resumed.player.care.wettings, before.player.care.wettings);
  f.now += 2 * HOUR;
  const later = doll.snapshot(f.user);
  assert.ok(later.player.hunger < before.player.hunger, "needs decay again once running");
  assert.ok(Math.abs((before.player.hunger - later.player.hunger) - 8) < 0.01, "exactly two hours of hunger, not fifty");
});

test("reminder expiry sent to Little Log is converted back to wall-clock time", async () => {
  const { createPetIntegration } = await import("../src/dressup/integration.js");
  const token = "t".repeat(40);
  const doll = { clock: { frozen: false, offset: () => 5 * HOUR }, tick() {}, identity: () => null, player: () => ({}),
    care: { events: () => ({ events: [{ id: "x".repeat(36), created: 1000, expires: 1000 + 24 * HOUR }], nextAfter: 1, more: false }) } };
  const route = createPetIntegration(doll, { token });
  let status, body;
  const res = { writeHead(code) { status = code; }, end(text) { body = JSON.parse(text); } };
  await route({ method: "GET", headers: { authorization: `Bearer ${token}` } }, res, new URL("http://h/littlepottchi/integration/v1/events?after=0&limit=10"));
  assert.equal(status, 200);
  assert.equal(body.events[0].created, 1000 + 5 * HOUR);
  assert.equal(body.events[0].expires, 1000 + 29 * HOUR); // A paused span no longer makes reminders look expired early.
});
