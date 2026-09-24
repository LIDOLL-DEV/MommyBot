import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { IdentityStore } from "../src/auth/store.js";
import { DiaperCheckStore, silentHour, CHECK_MIN_MS, CHECK_MAX_MS, ANSWER_WINDOW_MS, FOLLOWUP_WINDOW_MS, MAX_FOLLOWUPS } from "../src/diaperCheck/store.js";
import { createDiaperChecks, diaperCheckStatus } from "../src/diaperCheck/index.js";
import { exactDiaperReply, classifyDiaperReply } from "../src/graph/diaperCheckReply.js";

const START = Date.parse("2026-09-14T15:00:00Z"), HOUR = 3_600_000;
const BRIDGE = { DIAPER_CHECKS_ENABLED: "true", LIDOLLID_ENABLED: "true" };

function fixture(t, env = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "mommybot-diaper-"));
  const f = { now: START, sent: [], replies: [], kinds: [], members: new Map(), roles: new Map(), prompts: [], silent: false, nextId: 500 };
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
  f.store = new DiaperCheckStore(path.join(directory, "checks.db"), { now: () => f.now, draw: max => f.drawValue ?? Math.floor(max / 2) });
  f.open = () => {
    f.bot = createDiaperChecks(f.client, f.identities, { ...BRIDGE, ...env }, {
      store: f.store, now: () => f.now, isSilent: () => f.silent,
      settings: () => ({ diaperChecks: f.settings }),
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
  f.member = (user, { roles = ["little-role"] } = {}) => { f.members.set(user, false); f.roles.set(user, roles); };
  // A server member who never verified with LiDollID.
  f.due = () => f.store.db.prepare(`INSERT INTO diaper_guild_schedule VALUES ('guild',?)
    ON CONFLICT(guild_id) DO UPDATE SET next_check=excluded.next_check`).run(f.now - 1);
  // Open this server's random window now instead of waiting two to four hours.
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
} // Drive the real journal and orchestration against deterministic Discord and model stand-ins.


test("silent hours cover 22:00 to 06:00 server time inclusive of the boundaries", () => {
  const at = hour => silentHour(0, () => hour);
  for (const hour of [22, 23, 0, 3, 5]) assert.equal(at(hour), true, `hour ${hour}`);
  for (const hour of [6, 7, 12, 21]) assert.equal(at(hour), false, `hour ${hour}`);
});

test("plain answers to 'is your diaper dry?' are recognized without a model request", async () => {
  for (const text of ["yes", "Yes mommy", "yeah", "yep", "mhm", "YES, MOMMY SAKURA!", "dry", "still dry!", "im clean"]) assert.equal(exactDiaperReply(text), "dry", text);
  for (const text of ["no", "nope", "Nah", "no mommy", "No, Momma.", "wet", "im wet", "messy"]) assert.equal(exactDiaperReply(text), "wet", text);
  for (const text of ["maybe", "why", "yes i had lunch", "", "she said yes"]) assert.equal(exactDiaperReply(text), null, text);
  let calls = 0;
  const fetcher = async () => { calls++; return { ok: true, json: async () => ({ choices: [{ message: { content: "unclear" } }] }) }; };
  assert.equal(await classifyDiaperReply("yes mommy", { fetcher }), "dry");
  assert.equal(calls, 0);
  assert.equal(await classifyDiaperReply("i suppose so, kind of", { fetcher }), "unclear");
  assert.equal(calls, 1);
});

test("an unreachable classifier asks again rather than guessing", async () => {
  const fetcher = async () => { throw new Error("offline"); };
  assert.equal(await classifyDiaperReply("i am perfectly fine thank you", { fetcher }), "unclear");
  assert.equal(await classifyDiaperReply("no", { fetcher }), "wet"); // A direct answer still stands on its own.
  const legacy = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: "yes" } }] }) });
  assert.equal(await classifyDiaperReply("i suppose so", { fetcher: legacy }), "unclear"); // Old labels are no longer valid decisions.
});

test("a due server asks one verified role member whether their diaper is dry, and a yes is believed", async t => {
  const f = fixture(t); f.link("alice");
  f.due();
  await f.bot.tick();
  assert.equal(f.sent.length, 1);
  assert.match(f.sent[0].content, /Is your diaper still dry\?/);
  assert.match(f.sent[0].content, /\*\*yes\*\* or \*\*no\*\*/);
  assert.deepEqual(f.sent[0].allowedMentions, { parse: [], users: ["alice"], repliedUser: true });
  assert.deepEqual(f.kinds, ["ask"]);
  assert.equal(f.checks()[0].state, "open"); assert.equal(f.checks()[0].asked, 1); assert.equal(f.checks()[0].kind, "random");
  await f.bot.tick(); // A second pass must not ask again.
  assert.equal(f.sent.length, 1); assert.equal(f.checks().length, 1);
  assert.equal(await f.bot.handleMessage(f.message("yes mommy")), true);
  assert.deepEqual(f.kinds, ["ask", "dry"]);
  assert.match(f.replies[0].content, /checking in/i);
  assert.equal(f.checks()[0].state, "answered"); assert.equal(f.checks()[0].answer, "dry"); assert.equal(f.checks()[0].notified, 1);
});

test("a wet answer is trusted and met with reassurance, never an accusation", async t => {
  const f = fixture(t); f.link("alice");
  f.due();
  await f.bot.tick();
  assert.equal(await f.bot.handleMessage(f.message("no mommy")), true);
  assert.deepEqual(f.kinds, ["ask", "wet"]);
  assert.match(f.replies[0].content, /perfectly okay/i);
  assert.doesNotMatch(f.replies[0].content, /fib|records/i);
  assert.equal(f.checks()[0].answer, "wet");
});

test("nobody is asked before the server's window opens, and each check pushes it two to four hours out", async t => {
  const f = fixture(t); f.link("alice");
  await f.bot.tick();
  assert.equal(f.checks().length, 0); // A newly enabled server waits a full window first.
  const first = f.store.db.prepare("SELECT next_check FROM diaper_guild_schedule WHERE guild_id='guild'").get().next_check;
  assert.ok(first >= START + CHECK_MIN_MS && first <= START + CHECK_MAX_MS, `first ${first}`);
  f.now = first;
  await f.bot.tick();
  assert.equal(f.checks().length, 1);
  const next = f.store.db.prepare("SELECT next_check FROM diaper_guild_schedule WHERE guild_id='guild'").get().next_check;
  assert.ok(next >= f.now + CHECK_MIN_MS && next <= f.now + CHECK_MAX_MS, `next ${next}`);
  f.store.draw = () => 0;
  assert.equal(f.store.interval(), CHECK_MIN_MS);
  f.store.draw = max => max - 1;
  assert.equal(f.store.interval(), CHECK_MAX_MS);
});

test("no questions are posted during silent hours, and the due check is asked once quiet time ends", async t => {
  const f = fixture(t); f.link("alice");
  f.silent = true;
  f.due();
  await f.bot.tick();
  assert.equal(f.sent.length, 0);
  assert.equal(f.checks().length, 0); // Nobody is chosen during quiet hours at all.
  f.silent = false;
  await f.bot.tick();
  assert.equal(f.sent.length, 1); assert.equal(f.checks()[0].asked, 1);
});

test("only LiDollID-verified members holding the role in this server are asked", async t => {
  const f = fixture(t);
  f.link("alice", { roles: [] }); f.link("bob", { member: false }); f.member("dana"); f.link("cara");
  f.due();
  await f.bot.tick();
  assert.equal(f.sent.length, 1);
  assert.match(f.sent[0].content, /<@cara>/);
  assert.deepEqual(f.checks().map(check => check.user_id), ["cara"]);
});

test("a server with nobody eligible waits another window rather than searching every minute", async t => {
  const f = fixture(t); f.link("alice", { roles: [] }); f.member("dana");
  f.due();
  await f.bot.tick();
  assert.equal(f.checks().length, 0);
  const next = f.store.db.prepare("SELECT next_check FROM diaper_guild_schedule WHERE guild_id='guild'").get().next_check;
  assert.ok(next >= START + CHECK_MIN_MS, `next ${next}`);
});

test("checks stop entirely when the server has not enabled them or has chosen no channel", async t => {
  const f = fixture(t); f.link("alice");
  f.settings = { enabled: false, channel: "check-channel", role: "little-role" };
  f.due();
  await f.bot.tick();
  assert.equal(f.checks().length, 0); assert.equal(f.sent.length, 0);
  f.settings = { enabled: true, channel: "", role: "little-role" };
  await f.bot.tick();
  assert.equal(f.checks().length, 0); assert.equal(f.sent.length, 0);
});

test("a failed send is retried on the next pass without asking twice or losing the question", async t => {
  const f = fixture(t); f.link("alice");
  f.due();
  f.failSend = true;
  await f.bot.tick();
  assert.equal(f.sent.length, 0); assert.equal(f.checks()[0].asked, 0);
  f.failSend = false;
  await f.bot.tick();
  assert.equal(f.sent.length, 1); assert.equal(f.checks()[0].asked, 1);
  await f.bot.tick();
  assert.equal(f.sent.length, 1);
});

test("an unanswered question expires after its window and cannot be answered late", async t => {
  const f = fixture(t); f.link("alice");
  f.due();
  await f.bot.tick();
  assert.equal(await f.bot.handleMessage(f.message("what a nice day")), true); // One clarification is offered.
  assert.deepEqual(f.kinds, ["ask", "unclear"]);
  assert.equal(await f.bot.handleMessage(f.message("still a nice day")), false); // Then ordinary conversation resumes.
  f.now += ANSWER_WINDOW_MS + 1000;
  await f.bot.tick();
  assert.equal(f.checks()[0].state, "expired");
  assert.equal(await f.bot.handleMessage(f.message("yes mommy")), false);
});

test("messages outside the check channel, from other members and from bots are left alone", async t => {
  const f = fixture(t); f.link("alice");
  f.due();
  await f.bot.tick();
  assert.equal(await f.bot.handleMessage(f.message("yes", { channelId: "somewhere-else" })), false);
  assert.equal(await f.bot.handleMessage(f.message("yes", { author: { id: "bob", bot: false } })), false);
  assert.equal(await f.bot.handleMessage(f.message("yes", { author: { id: "alice", bot: true } })), false);
  assert.equal(await f.bot.handleMessage(f.message("yes", { guildId: null })), false);
  assert.equal(f.replies.length, 0); assert.equal(f.checks()[0].state, "open");
});

test("a restart re-asks nothing and still delivers a saved answer", async t => {
  const f = fixture(t); f.link("alice");
  f.due();
  await f.bot.tick();
  await f.restart();
  await f.bot.tick();
  assert.equal(f.sent.length, 1);
  assert.equal(await f.bot.handleMessage(f.message("yes")), true);
  assert.equal(f.checks()[0].notified, 1);
});

test("an answer saved under the old yes/no labels is still delivered with its meaning", async t => {
  const f = fixture(t); f.link("alice");
  f.store.db.prepare(`INSERT INTO diaper_checks (id,guild_id,user_id,channel_id,kind,state,answer,created,asked,answered)
    VALUES ('old','guild','alice','check-channel','evidence','answered','yes',?,1,?)`).run(f.now, f.now);
  await f.bot.tick();
  assert.deepEqual(f.kinds, ["wet"]); // "yes" used to mean "I had an accident".
});

test("status reports every configuration that silently prevents checks", () => {
  assert.match(diaperCheckStatus({}), /OFF: set DIAPER_CHECKS_ENABLED/);
  assert.match(diaperCheckStatus({ DIAPER_CHECKS_ENABLED: "true" }), /OFF: requires LIDOLLID_ENABLED/);
  assert.match(diaperCheckStatus(BRIDGE), /^ON: every 2-4 hours/);
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

test("an undiapered answer asks the member to put a fresh one on", async t => {
  const f = fixture(t); f.link("alice");
  f.due();
  await f.bot.tick();
  assert.equal(await f.bot.handleMessage(f.message("no diaper today")), true);
  assert.deepEqual(f.kinds, ["ask", "undiapered"]);
  assert.match(f.replies[0].content, /not wearing your protection/i);
  assert.match(f.replies[0].content, /put a fresh one on/i);
  assert.equal(f.checks()[0].answer, "undiapered");
  assert.equal(f.checks()[0].state, "answered"); assert.equal(f.checks()[0].notified, 1);
});

test("an administrator can start a check immediately, even during quiet hours", async t => {
  const f = fixture(t); f.link("alice");
  f.silent = true;
  const seen = await f.command();
  assert.equal(seen.ephemeral, true);
  assert.match(seen.content, /Asked <@alice> in <#check-channel>/);
  assert.equal(f.sent.length, 1);
  assert.deepEqual(f.kinds, ["ask"]);
  assert.equal(f.checks()[0].kind, "manual");
  const next = f.store.db.prepare("SELECT next_check FROM diaper_guild_schedule WHERE guild_id='guild'").get().next_check;
  assert.ok(next >= START + CHECK_MIN_MS, "the manual check pushes the server's random window out");
  assert.equal(await f.bot.handleMessage(f.message("no")), true);
  assert.deepEqual(f.kinds, ["ask", "wet"]);
});

test("the admin check refuses non-administrators, unconfigured servers, unverified or opted-out members and duplicates", async t => {
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
  f.due();
  await f.bot.tick();
  assert.equal(await f.bot.handleMessage(f.message("yes mommy")), true);
  assert.equal(f.replies.length, 1);
  f.now += 5 * 60_000;
  f.reply = "Good girl for telling Mommy, sweetheart!";
  assert.equal(await f.bot.handleMessage(f.message("i drank a big juice box")), true);
  assert.equal(f.replies.length, 2);
  assert.equal(f.replies[1].content, "Good girl for telling Mommy, sweetheart!");
  assert.deepEqual(f.prompts[0], { text: "i drank a big juice box", answer: "dry" }); // The reply sees their message and the answer it follows.
  f.reply = null;
  assert.equal(await f.bot.handleMessage(f.message("thanks mommy")), true);
  assert.match(f.replies[2].content, /keeping Mommy in the loop/); // A missing AI server still gets an answer.
});

test("a changed answer during the follow-up window gets the matching reply, not a generic one", async t => {
  const f = fixture(t); f.link("alice");
  f.due();
  await f.bot.tick();
  await f.bot.handleMessage(f.message("yes mommy"));
  assert.deepEqual(f.kinds, ["ask", "dry"]);
  assert.equal(await f.bot.handleMessage(f.message("im wet")), true);
  assert.equal(await f.bot.handleMessage(f.message("im not wearing a diaper")), true);
  assert.deepEqual(f.kinds, ["ask", "dry", "wet", "undiapered"]);
  assert.equal(f.prompts.length, 0); // Decided answers never go to the free-form reply.
});

test("the follow-up conversation is bounded by a window, a reply cap and the member's own channel", async t => {
  const f = fixture(t); f.link("alice");
  f.due();
  await f.bot.tick();
  await f.bot.handleMessage(f.message("yes mommy"));
  for (let turn = 0; turn < MAX_FOLLOWUPS; turn++) {
    assert.equal(await f.bot.handleMessage(f.message(`chatting ${turn}`)), true, `turn ${turn}`);
  }
  assert.equal(await f.bot.handleMessage(f.message("still chatting")), false); // The cap hands the channel back to ordinary handling.
  assert.equal(f.store.db.prepare("SELECT followups FROM diaper_checks").get().followups, MAX_FOLLOWUPS);
  const g = fixture(t); g.link("alice");
  g.due();
  await g.bot.tick();
  await g.bot.handleMessage(g.message("yes mommy"));
  g.now += FOLLOWUP_WINDOW_MS + 1000;
  assert.equal(await g.bot.handleMessage(g.message("still there mommy?")), false); // The window closes on its own.
  g.now -= FOLLOWUP_WINDOW_MS;
  assert.equal(await g.bot.handleMessage(g.message("over here", { channelId: "elsewhere" })), false);
  assert.equal(await g.bot.handleMessage(g.message("hi", { author: { id: "bob", bot: false } })), false);
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

test("one member per window: three members are each asked once across three windows", async t => {
  const f = fixture(t);
  for (const user of ["alice", "bob", "cara"]) f.link(user);
  const asked = [];
  for (let round = 0; round < 3; round++) {
    f.due();
    await f.bot.tick();
    assert.equal(f.checks().filter(check => check.state === "open").length, 1, `round ${round}`);
    const open = f.checks().find(check => check.state === "open");
    asked.push(open.user_id);
    await f.bot.handleMessage(f.message("yes", { author: { id: open.user_id, bot: false } }));
    await f.bot.tick();
    assert.equal(f.checks().length, round + 1); // Answered, but the next window has not opened yet.
  }
  assert.deepEqual([...asked].sort(), ["alice", "bob", "cara"]);
});

test("the retired Littlepottchi care tables are dropped from an existing journal", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "mommybot-diaper-legacy-"));
  try {
    const file = path.join(directory, "checks.db");
    const old = new DiaperCheckStore(file);
    old.db.exec("CREATE TABLE diaper_care (user_id TEXT PRIMARY KEY); CREATE TABLE diaper_schedule (guild_id TEXT, user_id TEXT);");
    old.close();
    const store = new DiaperCheckStore(file);
    const tables = store.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name);
    assert.ok(!tables.includes("diaper_care") && !tables.includes("diaper_schedule"), tables.join(","));
    store.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
