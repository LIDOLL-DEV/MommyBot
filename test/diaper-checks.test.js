import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { IdentityStore } from "../src/auth/store.js";
import { DiaperCheckStore, silentHour, CHECK_MIN_MS, CHECK_MAX_MS, ANSWER_WINDOW_MS, FOLLOWUP_WINDOW_MS, MAX_FOLLOWUPS, RANDOM_GAP_MS, ACCIDENT_WINDOW_MS, CHANGE_SUPERSEDES_MS } from "../src/diaperCheck/store.js";
import { createDiaperChecks, diaperCheckStatus } from "../src/diaperCheck/index.js";
import { exactDiaperReply, classifyDiaperReply } from "../src/graph/diaperCheckReply.js";

const START = Date.parse("2026-09-14T15:00:00Z"), HOUR = 3_600_000;
const BRIDGE = { DIAPER_CHECKS_ENABLED: "true", LIDOLLID_ENABLED: "true" };

function fixture(t, env = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "mommybot-diaper-"));
  const f = { now: START, sent: [], replies: [], audits: [], kinds: [], events: [], members: new Map(), roles: new Map(), prompts: [], states: new Map(), silent: false, nextId: 500 };
  f.identities = new IdentityStore(path.join(directory, "identity.db"), () => f.now);
  f.settings = { enabled: true, channel: "check-channel", role: "little-role" };
  f.channel = { id: "check-channel", guildId: "guild", isTextBased: () => true,
    async send(options) { if (f.failSend) throw new Error("Discord offline"); const id = String(f.nextId++); f.sent.push({ ...options, id }); return { id }; } };
  f.guild = { id: "guild", roles: { everyone: { id: "guild" } }, members: { async fetch({ user, force }) {
    assert.equal(force, true);
    if (f.membershipError) throw f.membershipError;
    if (!f.members.has(user)) throw Object.assign(new Error("Unknown member"), { code: 10007 });
    return { id: user, user: { id: user, bot: f.members.get(user) }, roles: { cache: new Map((f.roles.get(user) ?? []).map(role => [role, { id: role, name: role }])) } };
    // Values carry a name so pronoun roles resolve exactly as they do on a real member.
  } } };
  f.client = { guilds: { cache: new Map([["guild", f.guild]]) },
    channels: { async fetch(id) { return id === "check-channel" ? f.channel : null; } } };
  f.pets = () => true;
  f.care = { observe() {
    if (f.feedError) throw f.feedError;
    return [...f.states.values()];
  } }; // Stand in for the live Littlepottchi scan, which reports each linked player's diaper revision and accident state.
  f.store = new DiaperCheckStore(path.join(directory, "checks.db"), { now: () => f.now, draw: max => f.drawValue ?? Math.floor(max / 2) });
  f.open = () => {
    f.bot = createDiaperChecks(f.client, f.identities, { ...BRIDGE, ...env }, {
      store: f.store, care: f.care, now: () => f.now, isSilent: () => f.silent, petsEnabled: guild => f.pets(guild),
      settings: () => ({ diaperChecks: f.settings }),
      audit: (guild, actor, action, detail) => f.audits.push({ guild, actor, action, detail }),
      generateMessage: async kind => { f.kinds.push(kind); return f.generate ? f.generate(kind) : null; },
      generateReply: async (text, options) => { f.prompts.push({ text, answer: options?.answer }); return f.reply ?? null; },
      classifyReply: async (...args) => f.classify ? f.classify(...args) : exactDiaperReply(args[0]) ?? "unclear",
    });
  };
  f.open();
  f.link = (user, { member = true, bot = false, roles = ["little-role"] } = {}) => {
    f.identities.db.prepare("INSERT OR REPLACE INTO identity_links VALUES (?,?,?,?,?)").run(user, "issuer", `sub-${user}`, user, f.now);
    if (member) { f.members.set(user, bot); f.roles.set(user, roles); }
  };
  f.accident = (user, { kind = "wet", revision = "r1" } = {}) => f.states.set(user, { discordId: user, revision, kind });
  f.changed = (user, { revision = "r2" } = {}) => f.states.set(user, { discordId: user, revision, kind: null });
  // A fresh revision with no accident is exactly what putting on a clean diaper looks like to the scan.
  f.message = (content, overrides = {}) => ({
    id: String(f.nextId++), guildId: "guild", channelId: "check-channel", createdTimestamp: f.now,
    author: { id: "alice", bot: false }, content,
    async reply(options) { if (f.failSend) throw new Error("Discord offline"); f.replies.push(options); return { id: String(f.nextId++) }; }, ...overrides });
  f.command = async ({ target = "alice", ...overrides } = {}) => {
    const seen = { content: null, ephemeral: false, deferred: false };
    const interaction = { isChatInputCommand: () => true, commandName: "diapercheck", id: String(f.nextId++),
      guildId: "guild", user: { id: "admin" }, memberPermissions: { has: () => true },
      options: { getSubcommand: () => "ask", getUser: () => ({ id: target }) },
      async deferReply(options) { seen.deferred = true; seen.ephemeral = Boolean(options?.flags); },
      async reply(options) { seen.content = options.content; seen.ephemeral = Boolean(options.flags); },
      async editReply(options) { seen.content = options.content; }, ...overrides };
    assert.equal(await f.bot.handleInteraction(interaction), true);
    return seen;
  }; // Drive the real admin command so its permission recheck and wording stay covered.
  f.checks = () => f.store.db.prepare("SELECT * FROM diaper_checks ORDER BY created,id").all();
  f.restart = async () => { await f.bot.stop(); f.open(); };
  t.after(async () => { await f.bot?.stop(); f.store.close(); f.identities.close(); rmSync(directory, { recursive: true, force: true }); });
  return f;
} // Drive the real journal and orchestration against deterministic Discord, feed and model stand-ins.

test("silent hours cover 22:00 to 06:00 server time inclusive of the boundaries", () => {
  const at = hour => silentHour(0, () => hour);
  for (const hour of [22, 23, 0, 3, 5]) assert.equal(at(hour), true, `hour ${hour}`);
  for (const hour of [6, 7, 12, 21]) assert.equal(at(hour), false, `hour ${hour}`);
});

test("plain yes and no answers are recognized without a model request", async () => {
  for (const text of ["yes", "Yes mommy", "yeah", "yep", "mhm", "YES, MOMMY SAKURA!"]) assert.equal(exactDiaperReply(text), "yes", text);
  for (const text of ["no", "nope", "Nah", "no mommy", "No, Momma."]) assert.equal(exactDiaperReply(text), "no", text);
  for (const text of ["maybe", "why", "yes i had lunch", "", "she said yes"]) assert.equal(exactDiaperReply(text), null, text);
  let calls = 0;
  const fetcher = async () => { calls++; return { ok: true, json: async () => ({ choices: [{ message: { content: "unclear" } }] }) }; };
  assert.equal(await classifyDiaperReply("yes mommy", { fetcher }), "yes");
  assert.equal(calls, 0);
  assert.equal(await classifyDiaperReply("i suppose so, kind of", { fetcher }), "unclear");
  assert.equal(calls, 1);
});

test("an unreachable classifier never decides no, so nobody is accused of fibbing", async () => {
  const fetcher = async () => { throw new Error("offline"); };
  assert.equal(await classifyDiaperReply("i am perfectly dry thank you", { fetcher }), "unclear");
  assert.equal(await classifyDiaperReply("no", { fetcher }), "no"); // A direct answer still stands on its own.
});

test("an accident event asks its member once, in the configured channel, and admitting it is praised", async t => {
  const f = fixture(t); f.link("alice");
  f.accident("alice");
  await f.bot.tick();
  assert.equal(f.sent.length, 1);
  assert.match(f.sent[0].content, /have you had an accident/i);
  assert.match(f.sent[0].content, /\*\*yes\*\* or \*\*no\*\*/);
  assert.deepEqual(f.sent[0].allowedMentions, { parse: [], users: ["alice"], repliedUser: true });
  assert.deepEqual(f.kinds, ["ask"]);
  assert.equal(f.checks()[0].state, "open"); assert.equal(f.checks()[0].asked, 1);
  await f.bot.tick(); // A second pass must not re-read or re-ask the same event.
  assert.equal(f.sent.length, 1); assert.equal(f.checks().length, 1);
  assert.equal(await f.bot.handleMessage(f.message("yes mommy")), true);
  assert.equal(f.replies.length, 1); assert.match(f.replies[0].content, /truth/i);
  assert.deepEqual(f.kinds, ["ask", "confirmed"]);
  assert.equal(f.checks()[0].state, "answered"); assert.equal(f.checks()[0].answer, "yes");
  assert.equal(f.checks()[0].notified, 1); assert.deepEqual(f.audits, []);
});

test("denying a recorded accident is chastised for fibbing and noted in the admin journal", async t => {
  const f = fixture(t); f.link("alice");
  f.accident("alice", { kind: "mess" });
  await f.bot.tick();
  assert.equal(await f.bot.handleMessage(f.message("no mommy")), true);
  assert.match(f.replies[0].content, /fibbing to Mommy/i);
  assert.deepEqual(f.kinds, ["ask", "denied"]);
  assert.equal(f.audits.length, 1);
  assert.equal(f.audits[0].action, "diaper-check.denied");
  assert.match(f.audits[0].detail, /Member alice answered no to a recorded mess check/);
  assert.equal(f.checks()[0].answer, "no");
});

test("a random check has no record to contradict, so denying it is simply thanked", async t => {
  const f = fixture(t); f.link("alice");
  f.store.db.prepare("INSERT INTO diaper_schedule VALUES ('guild','alice',?)").run(START - 1);
  await f.bot.tick();
  assert.deepEqual(f.kinds, ["ask-random"]);
  assert.match(f.sent[0].content, /status update/i);
  assert.equal(f.checks()[0].kind, "random");
  assert.equal(await f.bot.handleMessage(f.message("nope")), true);
  assert.deepEqual(f.kinds, ["ask-random", "status"]);
  assert.match(f.replies[0].content, /checking in/i);
  assert.deepEqual(f.audits, []);
});

test("no questions are posted during silent hours, and saved ones are asked once quiet time ends", async t => {
  const f = fixture(t); f.link("alice");
  f.silent = true;
  f.accident("alice");
  await f.bot.tick();
  assert.equal(f.sent.length, 0);
  assert.equal(f.checks().length, 0); // Nobody is chosen during quiet hours at all.
  f.silent = false;
  await f.bot.tick();
  assert.equal(f.sent.length, 1); assert.equal(f.checks()[0].asked, 1); // The accident is still waiting to be asked about.
});

test("only role members in the server are asked, and losing the role stops further checks", async t => {
  const f = fixture(t);
  f.link("alice", { roles: [] }); f.link("bob", { member: false }); f.link("cara");
  f.accident("alice"); f.accident("bob"); f.accident("cara");
  await f.bot.tick();
  assert.equal(f.sent.length, 1);
  assert.match(f.sent[0].content, /<@cara>/);
  assert.deepEqual(f.checks().map(check => check.user_id), ["cara"]);
});

test("checks stop entirely when the server has not enabled them or has chosen no channel", async t => {
  const f = fixture(t); f.link("alice");
  f.settings = { enabled: false, channel: "check-channel", role: "little-role" };
  f.accident("alice");
  await f.bot.tick();
  assert.equal(f.checks().length, 0); assert.equal(f.sent.length, 0);
  f.settings = { enabled: true, channel: "", role: "little-role" };
  f.accident("alice", { episode: 2 });
  await f.bot.tick();
  assert.equal(f.checks().length, 0); assert.equal(f.sent.length, 0);
});

test("a failed send is retried on the next pass without asking twice or losing the question", async t => {
  const f = fixture(t); f.link("alice");
  f.accident("alice");
  f.failSend = true;
  await f.bot.tick();
  assert.equal(f.sent.length, 0); assert.equal(f.checks()[0].asked, 0);
  f.failSend = false;
  await f.bot.tick();
  assert.equal(f.sent.length, 1); assert.equal(f.checks()[0].asked, 1);
  await f.bot.tick();
  assert.equal(f.sent.length, 1);
});

test("an unanswered question expires after its window and stops blocking the next check", async t => {
  const f = fixture(t); f.link("alice");
  f.accident("alice");
  await f.bot.tick();
  assert.equal(await f.bot.handleMessage(f.message("what a nice day")), true); // One clarification is offered.
  assert.deepEqual(f.kinds, ["ask", "unclear"]);
  assert.equal(await f.bot.handleMessage(f.message("still a nice day")), false); // Then ordinary conversation resumes.
  f.now += ANSWER_WINDOW_MS + 1000;
  await f.bot.tick();
  assert.equal(f.checks()[0].state, "expired");
  assert.equal(await f.bot.handleMessage(f.message("yes mommy")), false); // An expired question cannot be answered late.
  await f.bot.tick();
  assert.equal(f.checks().length, 1); // The same accident is never asked about twice.
  f.accident("alice", { revision: "r5" }); // A genuinely new accident, though.
  await f.bot.tick();
  assert.equal(f.checks().length, 2);
  assert.equal(f.checks().filter(check => check.state === "open").length, 1);
});

test("messages outside the check channel, from other members and from bots are left alone", async t => {
  const f = fixture(t); f.link("alice");
  f.accident("alice");
  await f.bot.tick();
  assert.equal(await f.bot.handleMessage(f.message("yes", { channelId: "somewhere-else" })), false);
  assert.equal(await f.bot.handleMessage(f.message("yes", { author: { id: "bob", bot: false } })), false);
  assert.equal(await f.bot.handleMessage(f.message("yes", { author: { id: "alice", bot: true } })), false);
  assert.equal(await f.bot.handleMessage(f.message("yes", { guildId: null })), false);
  assert.equal(f.replies.length, 0); assert.equal(f.checks()[0].state, "open");
});

test("a restart re-asks nothing and still delivers a saved answer", async t => {
  const f = fixture(t); f.link("alice");
  f.accident("alice");
  await f.bot.tick();
  await f.restart();
  await f.bot.tick();
  assert.equal(f.sent.length, 1);
  assert.equal(await f.bot.handleMessage(f.message("yes")), true);
  assert.equal(f.checks()[0].notified, 1);
});

test("unreadable care state defers checks without crashing maintenance", async t => {
  const f = fixture(t); f.link("alice");
  f.feedError = new Error("feed offline");
  await f.bot.tick();
  assert.equal(f.checks().length, 0);
  f.feedError = null;
  f.accident("alice");
  await f.bot.tick();
  assert.equal(f.checks().length, 1);
});

test("the random window is six to twelve hours and every check resets it", async t => {
  const f = fixture(t);
  f.store.draw = () => 0;
  assert.equal(f.store.interval(), CHECK_MIN_MS);
  f.store.draw = max => max - 1;
  assert.equal(f.store.interval(), CHECK_MAX_MS);
  f.store.draw = max => Math.floor(max / 2);
  f.link("alice");
  f.accident("alice");
  await f.bot.tick();
  const next = f.store.db.prepare("SELECT next_check FROM diaper_schedule WHERE user_id='alice'").get().next_check;
  assert.ok(next >= START + CHECK_MIN_MS && next <= START + CHECK_MAX_MS, `next ${next}`);
});

test("status reports every configuration that silently prevents checks", () => {
  assert.match(diaperCheckStatus({}), /OFF: set DIAPER_CHECKS_ENABLED/);
  assert.match(diaperCheckStatus({ DIAPER_CHECKS_ENABLED: "true" }), /OFF: requires LIDOLLID_ENABLED/);
  assert.match(diaperCheckStatus(BRIDGE, { identities: true, care: false }), /^ON: random and administrator checks.*Littlepottchi is unavailable/);
  assert.match(diaperCheckStatus(BRIDGE), /^ON:/);
});

test("saying you are not wearing a diaper is recognized directly, and outranks a yes or no in the same message", async () => {
  const wordings = ["im not wearing a diaper", "I'm not wearing a diaper!", "i am not wearing any diapers",
    "not wearing one", "no diaper right now", "no padding today mommy", "without a diaper",
    "i dont have a diaper on", "i'm not diapered", "im diaper free", "i took it off earlier",
    "im in big kid undies", "wearing regular underwear", "nope, not wearing a nappy", "yes but im not wearing a diaper"];
  for (const text of wordings) assert.equal(exactDiaperReply(text), "undiapered", text);
  for (const text of ["yes", "no", "no one is home", "i have a diaper on", "im diapered", "yes mommy"]) {
    assert.notEqual(exactDiaperReply(text), "undiapered", text);
  }
  assert.equal(exactDiaperReply("im diapered"), null); // Wearing one must never read as the opposite.
  let calls = 0;
  const fetcher = async () => { calls++; return { ok: true, json: async () => ({ choices: [{ message: { content: "undiapered" } }] }) }; };
  assert.equal(await classifyDiaperReply("im not wearing a diaper", { fetcher }), "undiapered");
  assert.equal(calls, 0); // A direct answer never waits on the router.
  assert.equal(await classifyDiaperReply("sorry mommy, i forgot to put one on after my shower", { fetcher }), "undiapered");
  assert.equal(calls, 1);
});

test("an undiapered answer is chastised for going without, and is not treated as a fib", async t => {
  const f = fixture(t); f.link("alice");
  f.accident("alice");
  await f.bot.tick();
  assert.equal(await f.bot.handleMessage(f.message("im not wearing a diaper")), true);
  assert.deepEqual(f.kinds, ["ask", "undiapered"]);
  assert.match(f.replies[0].content, /not wearing your protection/i);
  assert.match(f.replies[0].content, /put a fresh one on/i);
  assert.deepEqual(f.audits, []); // Going without is not lying, so nothing is recorded against them.
  assert.equal(f.checks()[0].answer, "undiapered");
  assert.equal(f.checks()[0].state, "answered"); assert.equal(f.checks()[0].notified, 1);
});

test("a random check answered undiapered is chastised the same way", async t => {
  const f = fixture(t); f.link("alice");
  f.store.db.prepare("INSERT INTO diaper_schedule VALUES ('guild','alice',?)").run(START - 1);
  await f.bot.tick();
  assert.equal(await f.bot.handleMessage(f.message("no diaper today")), true);
  assert.deepEqual(f.kinds, ["ask-random", "undiapered"]);
  assert.match(f.replies[0].content, /not wearing your protection/i);
});

test("an administrator can start a check immediately, even during quiet hours", async t => {
  const f = fixture(t); f.link("alice");
  f.silent = true;
  const seen = await f.command();
  assert.equal(seen.ephemeral, true);
  assert.match(seen.content, /Asked <@alice> in <#check-channel>/);
  assert.equal(f.sent.length, 1);
  assert.deepEqual(f.kinds, ["ask-random"]); // An admin check has no accident record, so it asks for a status update.
  assert.equal(f.checks()[0].kind, "manual");
  const next = f.store.db.prepare("SELECT next_check FROM diaper_schedule WHERE user_id='alice'").get().next_check;
  assert.ok(next > START, "the manual check resets the random window");
  assert.equal(await f.bot.handleMessage(f.message("no")), true);
  assert.deepEqual(f.kinds, ["ask-random", "status"]); // No record to contradict, so a no is simply thanked.
  assert.deepEqual(f.audits, []);
});

test("the admin check refuses non-administrators, unconfigured servers, opted-out members and duplicates", async t => {
  const f = fixture(t); f.link("alice"); f.link("dana", { roles: [] });
  assert.match((await f.command({ memberPermissions: { has: () => false } })).content, /Only a server administrator/);
  assert.match((await f.command({ guildId: null })).content, /Only a server administrator/);
  assert.equal(f.sent.length, 0);
  f.settings = { enabled: false, channel: "check-channel", role: "little-role" };
  assert.match((await f.command()).content, /no diaper check channel yet/);
  f.settings = { enabled: true, channel: "check-channel", role: "little-role" };
  assert.match((await f.command({ target: "dana" })).content, /not taking part in diaper checks/);
  assert.match((await f.command({ target: "erin" })).content, /not taking part in diaper checks/);
  assert.equal(f.sent.length, 0);
  await f.command();
  assert.equal(f.sent.length, 1);
  assert.match((await f.command()).content, /already has a diaper check waiting/);
  assert.equal(f.sent.length, 1);
  assert.equal(await f.bot.handleInteraction({ isChatInputCommand: () => true, commandName: "lidollid", options: { getSubcommand: () => "ask" } }), false);
});

test("Sakura keeps talking after a check closes, which the chat channel gate would otherwise silence", async t => {
  const f = fixture(t); f.link("alice");
  f.accident("alice");
  await f.bot.tick();
  assert.equal(await f.bot.handleMessage(f.message("no mommy")), true);
  assert.equal(f.replies.length, 1);
  f.now += 5 * 60_000;
  f.reply = "Good girl for changing yourself, sweetheart!";
  assert.equal(await f.bot.handleMessage(f.message("i changed 5 minutes ago")), true);
  assert.equal(f.replies.length, 2);
  assert.equal(f.replies[1].content, "Good girl for changing yourself, sweetheart!");
  assert.deepEqual(f.prompts[0], { text: "i changed 5 minutes ago", answer: "no" }); // The reply sees their message and the answer it follows.
  f.reply = null;
  assert.equal(await f.bot.handleMessage(f.message("thanks mommy")), true);
  assert.match(f.replies[2].content, /keeping Mommy in the loop/); // A missing AI server still gets an answer.
});

test("a correction during the follow-up window gets the matching reply, not a generic one", async t => {
  const f = fixture(t); f.link("alice");
  f.accident("alice");
  await f.bot.tick();
  await f.bot.handleMessage(f.message("no mommy"));
  assert.deepEqual(f.kinds, ["ask", "denied"]);
  assert.equal(await f.bot.handleMessage(f.message("yes")), true); // A decided answer, not free-form chat.
  assert.deepEqual(f.kinds, ["ask", "denied", "confirmed"]);
  assert.equal(await f.bot.handleMessage(f.message("im not wearing a diaper")), true);
  assert.deepEqual(f.kinds, ["ask", "denied", "confirmed", "undiapered"]);
  assert.equal(f.prompts.length, 0); // Decided answers never go to the free-form reply.
});

test("the follow-up conversation is bounded by a window, a reply cap and the member's own channel", async t => {
  const f = fixture(t); f.link("alice");
  f.accident("alice");
  await f.bot.tick();
  await f.bot.handleMessage(f.message("no mommy"));
  for (let turn = 0; turn < MAX_FOLLOWUPS; turn++) {
    assert.equal(await f.bot.handleMessage(f.message(`chatting ${turn}`)), true, `turn ${turn}`);
  }
  assert.equal(await f.bot.handleMessage(f.message("still chatting")), false); // The cap hands the channel back to ordinary handling.
  assert.equal(f.store.db.prepare("SELECT followups FROM diaper_checks").get().followups, MAX_FOLLOWUPS);
  const g = fixture(t); g.link("alice");
  g.accident("alice");
  await g.bot.tick();
  await g.bot.handleMessage(g.message("no mommy"));
  g.now += FOLLOWUP_WINDOW_MS + 1000;
  assert.equal(await g.bot.handleMessage(g.message("still there mommy?")), false); // The window closes on its own.
  g.now -= FOLLOWUP_WINDOW_MS;
  assert.equal(await g.bot.handleMessage(g.message("over here", { channelId: "elsewhere" })), false);
  assert.equal(await g.bot.handleMessage(g.message("hi", { author: { id: "bob", bot: false } })), false);
});

test("only one member is asked at a time per server; the rest wait their turn", async t => {
  const f = fixture(t); f.link("alice"); f.link("bob"); f.link("cara");
  f.accident("alice"); f.accident("bob"); f.accident("cara");
  await f.bot.tick();
  assert.equal(f.sent.length, 1); // Three accidents, one question.
  assert.equal(f.checks().length, 1);
  await f.bot.tick();
  assert.equal(f.sent.length, 1); // Repeated passes do not stack more while one is open.
  const asked = f.checks()[0].user_id;
  assert.equal(await f.bot.handleMessage(f.message("no mommy", { author: { id: asked, bot: false } })), true);
  await f.bot.tick();
  assert.equal(f.sent.length, 1); // Answered, but the calm gap still applies.
  f.now += RANDOM_GAP_MS;
  await f.bot.tick();
  assert.equal(f.sent.length, 2); // The next member is asked only once the first closes and the gap passes.
  assert.equal(new Set(f.checks().map(check => check.user_id)).size, 2); // A different member's turn, not a repeat.
  await f.bot.tick();
  assert.equal(f.sent.length, 2);
});

test("the call log rotates through everyone before anyone repeats", () => {
  const store = new DiaperCheckStore(":memory:", { now: () => START, draw: max => 0 });
  const users = ["alice", "bob", "cara"], picked = [];
  for (let turn = 0; turn < 6; turn++) {
    const pick = store.nextInCycle("guild", users, START);
    picked.push(pick); store.markCalled("guild", pick, START);
  }
  assert.deepEqual([...picked.slice(0, 3)].sort(), users); // A full rotation before anyone comes round again.
  assert.deepEqual([...picked.slice(3)].sort(), users);
  assert.deepEqual(store.db.prepare("SELECT user_id,cycle FROM diaper_roster ORDER BY user_id").all(),
    users.map(user => ({ user_id: user, cycle: 2 })));
  store.close();
});

test("three members with accidents are asked one each, never the same member twice", async t => {
  const f = fixture(t);
  for (const user of ["alice", "bob", "cara"]) { f.link(user); f.accident(user); }
  const asked = [];
  for (let round = 0; round < 3; round++) {
    await f.bot.tick();
    const open = f.checks().find(check => check.state === "open");
    assert.ok(open, `round ${round} asked nobody`);
    asked.push(open.user_id);
    await f.bot.handleMessage(f.message("no", { author: { id: open.user_id, bot: false } }));
    f.now += RANDOM_GAP_MS;
  }
  assert.deepEqual([...asked].sort(), ["alice", "bob", "cara"]);
  await f.bot.tick();
  assert.equal(f.checks().length, 3); // Those accidents are all settled; nobody is asked about them again.
});

test("random checks leave a calm gap after the previous check in that server", async t => {
  const f = fixture(t); f.link("alice"); f.link("bob");
  f.store.db.prepare("INSERT INTO diaper_schedule VALUES ('guild','alice',?)").run(START - 1);
  f.store.db.prepare("INSERT INTO diaper_schedule VALUES ('guild','bob',?)").run(START - 1);
  await f.bot.tick();
  assert.equal(f.sent.length, 1);
  const asked = f.checks()[0].user_id;
  await f.bot.handleMessage(f.message("no", { author: { id: asked, bot: false } }));
  f.now += 60_000;
  await f.bot.tick();
  assert.equal(f.sent.length, 1); // Answered, but still inside the calm gap.
  f.now += RANDOM_GAP_MS;
  await f.bot.tick();
  assert.equal(f.sent.length, 2);
});

test("a fresh diaper is praised with the member's own gendered wording", async t => {
  const f = fixture(t);
  f.link("alice", { roles: ["little-role", "she/her"] });
  f.link("bob", { roles: ["little-role", "he/him"] });
  f.link("cara", { roles: ["little-role"] });
  for (const user of ["alice", "bob", "cara"]) f.accident(user);
  await f.bot.tick();
  f.sent.length = 0; f.kinds.length = 0;
  f.now += CHANGE_SUPERSEDES_MS + 60_000; // Long enough that the change no longer settles a pending check.
  for (const user of ["alice", "bob", "cara"]) f.changed(user);
  await f.bot.tick();
  const praise = f.sent.filter(message => /proud of you/.test(message.content));
  assert.equal(praise.length, 3);
  assert.match(praise.find(message => message.content.includes("<@alice>")).content, /good girl/);
  assert.match(praise.find(message => message.content.includes("<@bob>")).content, /good boy/);
  assert.match(praise.find(message => message.content.includes("<@cara>")).content, /good little one/);
  assert.ok(f.kinds.every(kind => kind === "changed"));
  await f.bot.tick();
  assert.equal(f.sent.filter(message => /proud of you/.test(message.content)).length, 3); // Praised once per change.
});

test("a change within fifteen minutes settles the accident instead of a check", async t => {
  const f = fixture(t); f.link("alice");
  f.accident("alice");
  f.store.observe({ discordId: "alice", revision: "r1", kind: "wet" }, f.now); // Seen before any check could be chosen.
  f.now += 5 * 60_000;
  f.changed("alice");
  await f.bot.tick();
  assert.match(f.sent[0].content, /good little one/);
  assert.equal(f.checks().length, 0); // No question: the change already answered it.
  f.now += RANDOM_GAP_MS;
  await f.bot.tick();
  assert.equal(f.checks().length, 0);
});

test("a change long after the accident still leaves the check to be asked", async t => {
  const f = fixture(t); f.link("alice");
  f.store.observe({ discordId: "alice", revision: "r1", kind: "wet" }, f.now);
  f.now += CHANGE_SUPERSEDES_MS + 60_000;
  f.changed("alice");
  await f.bot.tick();
  assert.equal(f.checks().length, 1); // Still asked, because the change came too late to settle it.
  assert.equal(f.checks()[0].kind, "evidence");
});

test("using a diaper never tags its own member, and an accident outside the window stops counting", async t => {
  const f = fixture(t); f.link("alice");
  f.silent = true;
  f.accident("alice");
  await f.bot.tick();
  assert.equal(f.sent.length, 0); assert.equal(f.checks().length, 0); // Quiet hours, and no automatic tag either way.
  f.now += ACCIDENT_WINDOW_MS + 60_000;
  f.silent = false;
  await f.bot.tick();
  assert.equal(f.checks().length, 0); // Four hours later that accident no longer earns a check.
});

test("where Littlepottchi is off, doll accidents and changes are ignored but routine checks carry on", async t => {
  const f = fixture(t); f.link("alice"); f.link("bob");
  f.pets = () => false;
  f.accident("alice");
  await f.bot.tick();
  assert.equal(f.checks().length, 0); // A doll accident never picks anyone in this server.
  f.now += CHANGE_SUPERSEDES_MS + 60_000;
  f.changed("alice");
  await f.bot.tick();
  assert.equal(f.sent.length, 0); // Nor does a fresh doll diaper earn praise here.
  f.store.db.prepare("INSERT INTO diaper_schedule VALUES ('guild','bob',?) ON CONFLICT(guild_id,user_id) DO UPDATE SET next_check=excluded.next_check").run(f.now - 1);
  f.now += RANDOM_GAP_MS;
  await f.bot.tick();
  assert.equal(f.checks().length, 1);
  assert.equal(f.checks()[0].kind, "random"); // Status checks never used the doll, so they are unaffected.
});


test("without Littlepottchi, random and administrator checks still run and nothing reads a doll", async t => {
  const f = fixture(t); f.link("alice"); f.link("bob");
  const bot = createDiaperChecks(f.client, f.identities, BRIDGE, {
    store: f.store, care: null, now: () => f.now, isSilent: () => false, settings: () => ({ diaperChecks: f.settings }),
    generateMessage: async kind => { f.kinds.push(kind); return null; }, generateReply: async () => null,
    classifyReply: async text => exactDiaperReply(text) ?? "unclear" });
  t.after(() => bot.stop());
  assert.ok(bot, "the feature starts without a care source");
  f.store.db.prepare("INSERT INTO diaper_schedule VALUES ('guild','alice',?)").run(f.now - 1);
  await bot.tick();
  assert.equal(f.checks().length, 1); assert.equal(f.checks()[0].kind, "random");
  const seen = {};
  await bot.handleInteraction({ isChatInputCommand: () => true, commandName: "diapercheck", id: "x", guildId: "guild",
    user: { id: "admin" }, memberPermissions: { has: () => true },
    options: { getSubcommand: () => "ask", getUser: () => ({ id: "bob" }) },
    async reply(o) { seen.content = o.content; }, async deferReply() {}, async editReply(o) { seen.content = o.content; } });
  assert.match(seen.content, /already has a diaper check waiting|Asked <@bob>/); // The admin command is reachable again.
});
