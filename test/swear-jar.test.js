import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { WalletService } from "../src/wallet/service.js";
import { WalletError } from "../src/wallet/client.js";
import { IdentityStore } from "../src/auth/store.js";
import { nextSwearJarDraw } from "../src/wallet/swearJar.js";
import { createSwearJar, swearMatcher } from "../src/swearJar.js";
import { classifySwearApology, exactSwearApology } from "../src/graph/swearJarApology.js";
import { runWalletAction } from "../src/wallet/commands.js";

const MONDAY = Date.parse("2026-09-14T00:00:00Z"), WEEK = 7 * 86_400_000;

function fixture(t, env = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "mommybot-swear-jar-"));
  const f = { now: MONDAY + 1000, calls: [], balances: new Map(), receipts: new Map(), sent: [], fetched: [], members: new Map(), nextMessage: 100 };
  f.identities = new IdentityStore(path.join(directory, "identity.db"), () => f.now);
  f.api = {
    config: { baseUrl: "https://wallet.example/v1/", clientId: "lidollbot" },
    async operation(token, body) {
      f.calls.push({ token, ...body });
      if (f.reject) throw f.reject;
      const key = `${token}:${body.request_id}`;
      let receipt = f.receipts.get(key);
      if (!receipt) {
        const old = f.balances.get(token) ?? 0;
        if (body.kind === "debit" && old < body.amount) throw new WalletError("request_failed", "Balance too low.", 409);
        const balance = old + (body.kind === "debit" ? -body.amount : body.amount);
        f.balances.set(token, balance);
        receipt = { ...body, currency: "LiDollCoin", balance };
        f.receipts.set(key, receipt);
      }
      if (f.delay) await f.delay;
      if (f.lose === body.kind) throw new Error("PRIVATE response lost");
      return f.badReceipt ? { ...receipt, currency: "Stars" } : receipt;
    },
    async revoke() {},
  };
  f.open = () => {
    f.wallet = new WalletService(path.join(directory, "wallet.db"), f.api, { now: () => f.now });
    f.wallet.identityFor = user => f.identities.gameIdentity(user);
    f.wallet.swearJar.draw = count => { f.drawCount = count; return f.winnerIndex ?? 0; };
    f.bot = createSwearJar(f.client, f.wallet, f.identities, env, {
      generateMessage: async (...args) => f.generate ? f.generate(...args) : null,
      classifyApology: async (...args) => f.classify ? f.classify(...args) : exactSwearApology(args[0]),
    }); // Keep payment and apology tests independent of live model servers.
  };
  f.channel = guild => ({ guildId: guild, isTextBased: () => true, async send(options) {
    if (f.failSend) throw new Error("Discord offline");
    f.sent.push(options);
  } });
  f.client = {
    channels: { async fetch(id) { return f.channel(id === "other-channel" ? "other" : "guild"); } },
    guilds: { cache: new Map([["guild", { members: { async fetch({ user, force }) {
      assert.equal(force, true); f.fetched.push(user);
      if (f.membershipError) throw f.membershipError;
      if (!f.members.has(user)) throw Object.assign(new Error("Unknown member"), { code: 10007 });
      return { user: { id: user, bot: f.members.get(user) } };
    } } }]]) },
  };
  f.open();
  f.link = (user, { coins = 10, connected = true, member = true, bot = false } = {}) => {
    f.identities.db.prepare("INSERT OR REPLACE INTO identity_links VALUES (?,?,?,?,?)").run(user, "issuer", user, user, f.now);
    if (member) f.members.set(user, bot);
    if (connected) f.connect(user, coins);
  };
  f.connect = (user, coins = 10) => {
    f.wallet.db.prepare("INSERT OR REPLACE INTO online_wallets VALUES (?,?,?,?,?,?)").run(user, user, f.now + 100 * WEEK, user, f.api.config.baseUrl, f.api.config.clientId);
    f.balances.set(user, coins);
  };
  f.message = (content = "Oh SHIT!", overrides = {}) => ({
    id: String(f.nextMessage++), guildId: "guild", channelId: "channel", createdTimestamp: f.now,
    author: { id: "alice", bot: false }, content,
    async reply(options) { if (f.failSend) throw new Error("Discord offline"); f.sent.push(options); }, ...overrides,
  });
  f.jobs = () => f.wallet.db.prepare("SELECT * FROM swear_jar_jobs ORDER BY created,id").all();
  f.prizes = () => f.jobs().filter(job => job.kind === "credit");
  f.restart = async () => { await f.bot.stop(); await f.wallet.close(); f.open(); };
  t.after(async () => { await f.bot.stop(); await f.wallet.close(); f.identities.close(); rmSync(directory, { recursive: true, force: true }); });
  return f;
} // Exercise real SQLite journals and wallet locks using disposable accounts, a controlled clock and an idempotent fake provider.

test("whole-word swears support case, punctuation and Unicode normalization without innocent substrings", () => {
  const matches = swearMatcher();
  for (const text of ["Fuck!", "shit, fuck", "that's bullshit", "ＦＵＣＫ", "bitch's", "damn-it"]) assert.equal(matches(text), true, text);
  for (const text of ["class assignment", "Scunthorpe", "hello shell", "Dickens", "passage", "shitake", "éshit", "fucké", "", null]) assert.equal(matches(text), false, text);
  assert.equal(swearMatcher(["heck", "a+b"])("Heck! a+b"), true);
  assert.equal(swearMatcher(["heck"])("fuck"), false);
  assert.equal(swearMatcher([])("fuck"), false);
});

test("weekly boundary is always the next Monday midnight UTC", () => {
  assert.equal(nextSwearJarDraw(MONDAY), MONDAY + WEEK);
  assert.equal(nextSwearJarDraw(MONDAY - 1), MONDAY);
  assert.equal(nextSwearJarDraw(Date.parse("2026-11-01T23:59:59Z")), Date.parse("2026-11-02T00:00:00Z"));
  assert.equal(nextSwearJarDraw(Date.parse("2026-12-31T23:59:59Z")), Date.parse("2027-01-04T00:00:00Z"));
});

test("a message with several swears costs one coin and duplicate deliveries do not charge or reply again", async t => {
  const f = fixture(t); f.link("alice");
  const message = f.message("fuck shit damn");
  assert.equal(await f.bot.handleMessage(message), true);
  await f.bot.handleMessage(message);
  assert.equal(f.balances.get("alice"), 9); assert.equal(f.calls.length, 1); assert.equal(f.sent.length, 1);
  assert.match(f.sent[0].content, /1 coin in the swear jar/);
  assert.match(f.sent[0].content, /has been put/);
  assert.deepEqual(f.sent[0].allowedMentions.parse, []);
  assert.equal(f.calls[0].asset, "coins"); assert.equal(f.jobs()[0].state, "done");
  await f.restart(); await f.bot.handleMessage(message);
  assert.equal(f.calls.length, 1); assert.equal(f.sent.length, 1);
});

test("bot messages, webhooks, DMs and clean messages are ignored; swears outside the conversation channel count", async t => {
  const f = fixture(t, { CHANNEL_ID: "conversation-only" }); f.link("alice");
  for (const message of [f.message("hello"), f.message("shit", { guildId: null }), f.message("shit", { webhookId: "hook" }), f.message("shit", { author: { id: "alice", bot: true } })]) {
    assert.equal(await f.bot.handleMessage(message), false);
  }
  assert.equal(f.calls.length, 0);
  assert.equal(await f.bot.handleMessage(f.message()), true);
  assert.equal(f.calls.length, 1);
});

test("unlinked users are asked to create and register LiD0llID; missing wallets get login guidance without debt", async t => {
  const f = fixture(t);
  await f.bot.handleMessage(f.message());
  assert.match(f.sent.at(-1).content, /make a \*\*LiD0llID account/);
  assert.match(f.sent.at(-1).content, /\/lidollid login/);
  f.link("alice", { connected: false });
  await f.bot.handleMessage(f.message());
  assert.match(f.sent.at(-1).content, /connect your wallet/);
  f.connect("alice"); await f.bot.tick();
  assert.equal(f.calls.length, 0); assert.equal(f.wallet.hasPending("alice"), false);
});

test("insufficient coins collect nothing and cannot inflate the lottery pot", async t => {
  const f = fixture(t); f.link("alice", { coins: 0 });
  await f.bot.handleMessage(f.message());
  assert.match(f.sent[0].content, /No coin was collected/);
  assert.equal(f.jobs()[0].state, "failed"); assert.equal(f.wallet.hasPending("alice"), false);
  f.now = MONDAY + WEEK; await f.bot.tick();
  assert.equal(f.prizes().length, 0); assert.equal(f.balances.get("alice"), 0);
});

test("lost debit responses survive restart, prevent unlink, and recover exactly once with private retry", async t => {
  const f = fixture(t); f.link("alice"); f.lose = "debit";
  await f.bot.handleMessage(f.message());
  assert.equal(f.balances.get("alice"), 9); assert.equal(f.wallet.hasPending("alice"), true);
  assert.match(f.sent[0].content, /payment is pending/); assert.doesNotMatch(f.sent[0].content, /PRIVATE/);
  await assert.rejects(f.wallet.disconnect("alice"), /pending/);
  await f.restart(); f.lose = null;
  const response = await runWalletAction({ user: { id: "alice" } }, f.wallet, f.identities, "retry");
  assert.match(response.content, /has been put in the swear jar/);
  assert.equal(f.balances.get("alice"), 9); assert.equal(f.wallet.hasPending("alice"), false);
  assert.equal(f.calls[0].request_id, f.calls[1].request_id);
});

test("uncertain debit stays reserved even if a later attempt is refused", async t => {
  const f = fixture(t); f.link("alice"); f.lose = "debit";
  await f.bot.handleMessage(f.message());
  f.reject = new WalletError("request_failed", "Declined", 403);
  await assert.rejects(f.wallet.swearJar.retry("alice"), /saved/);
  assert.equal(f.wallet.hasPending("alice"), true);
  f.reject = null; f.lose = null; await f.bot.tick();
  assert.equal(f.balances.get("alice"), 9); assert.equal(f.wallet.hasPending("alice"), false);
});

test("weekly draw pays the entire pot to one linked current human member, including members who never swore", async t => {
  const f = fixture(t); f.link("alice"); f.link("bob"); f.link("departed", { member: false }); f.link("robot", { bot: true });
  f.identities.gameAccount({ issuer: "issuer", subject: "web-only", username: "web-only" });
  f.members.set("unlinked", false); f.winnerIndex = 1;
  await f.bot.handleMessage(f.message()); await f.bot.handleMessage(f.message());
  f.now = MONDAY + WEEK - 1; await f.bot.tick(); assert.equal(f.prizes().length, 0);
  f.now++; await f.bot.tick();
  assert.equal(f.drawCount, 2); assert.equal(f.prizes().length, 1);
  assert.equal(f.prizes()[0].user_id, "bob"); assert.equal(f.prizes()[0].amount, 2);
  assert.equal(f.balances.get("alice"), 8); assert.equal(f.balances.get("bob"), 12);
  assert.match(f.sent.at(-1).content, /weekly swear jar lottery winner is <@bob>/);
  assert.match(f.sent.at(-1).content, /have been gifted/);
  assert.deepEqual(f.sent.at(-1).allowedMentions.users, ["bob"]);
  assert.ok(f.fetched.includes("departed")); assert.ok(!f.fetched.includes("unlinked"));
  await Promise.all([f.bot.tick(), f.bot.tick()]); await f.restart(); await f.bot.tick();
  assert.equal(f.prizes().length, 1); assert.equal(f.balances.get("bob"), 12);
});

test("pending prize holds the same winner and coins through timeout, restart and a subsequent week", async t => {
  const f = fixture(t); f.link("alice"); f.link("bob"); f.winnerIndex = 1;
  await f.bot.handleMessage(f.message());
  f.now = MONDAY + WEEK; f.lose = "credit"; await f.bot.tick();
  const prize = f.prizes()[0];
  assert.equal(prize.state, "pending"); assert.equal(f.balances.get("bob"), 11);
  assert.match(f.sent.at(-1).content, /reserved for you/);
  await f.restart(); f.now += WEEK; f.lose = null; await f.bot.tick();
  assert.equal(f.prizes().length, 1); assert.equal(f.prizes()[0].id, prize.id);
  assert.equal(f.balances.get("bob"), 11); assert.equal(f.prizes()[0].state, "done");
  assert.match(f.sent.at(-1).content, /has been gifted/);
  assert.equal(f.calls.filter(call => call.kind === "credit").every(call => call.request_id === prize.id), true);
});

test("linked winners without a wallet remain eligible and can collect after connecting", async t => {
  const f = fixture(t); f.link("alice"); f.link("bob", { connected: false }); f.winnerIndex = 1;
  await f.bot.handleMessage(f.message()); f.now = MONDAY + WEEK; await f.bot.tick();
  assert.equal(f.prizes()[0].user_id, "bob"); assert.equal(f.prizes()[0].state, "pending");
  assert.equal(f.wallet.hasPending("bob"), true); assert.equal(f.calls.length, 1);
  f.connect("bob", 0);
  const result = await f.wallet.swearJar.retry("bob");
  assert.equal(result.state, "done"); assert.equal(f.balances.get("bob"), 1);
  await f.bot.tick(); assert.match(f.sent.at(-1).content, /has been gifted/);
});

test("no eligible members carries the pot forward, and transient membership errors defer the draw", async t => {
  const f = fixture(t); f.link("alice"); await f.bot.handleMessage(f.message());
  f.now = MONDAY + WEEK; f.membershipError = Object.assign(new Error("Discord unavailable"), { code: 500 });
  await f.bot.tick(); assert.equal(f.prizes().length, 0);
  assert.equal(f.wallet.db.prepare("SELECT next_draw FROM swear_jar_guilds").get().next_draw, f.now);
  f.membershipError = null; f.members.clear(); await f.bot.tick();
  assert.equal(f.prizes().length, 0); assert.equal(f.jobs()[0].allocation, null);
  f.members.set("alice", false); f.now += WEEK; await f.bot.tick();
  assert.equal(f.prizes()[0].amount, 1); assert.equal(f.balances.get("alice"), 10);
});

test("the next week's messages stay out of an overdue draw and unresolved fines enter a later lottery", async t => {
  const f = fixture(t); f.link("alice");
  await f.bot.handleMessage(f.message()); f.lose = "debit"; await f.bot.handleMessage(f.message());
  f.now = MONDAY + WEEK; f.reject = new WalletError("daily_limit", "Tomorrow", 429);
  await f.bot.tick();
  assert.equal(f.prizes()[0].amount, 1);
  f.reject = null; f.lose = null; await f.bot.handleMessage(f.message()); await f.bot.tick();
  assert.equal(f.prizes()[0].amount, 1);
  f.now += WEEK; await f.bot.tick();
  assert.deepEqual(f.prizes().map(job => job.amount), [1, 2]);
  assert.equal(f.balances.get("alice"), 10);
});

test("API, wallet account and identity changes cannot redirect a saved fine", async t => {
  const f = fixture(t); f.link("alice"); f.lose = "debit"; await f.bot.handleMessage(f.message()); f.lose = null;
  f.api.config.baseUrl = "https://other.example/v1/";
  await assert.rejects(f.wallet.swearJar.retry("alice"), /different API settings/);
  f.api.config.baseUrl = "https://wallet.example/v1/";
  f.wallet.db.prepare("UPDATE online_wallets SET account_id='other'").run();
  await assert.rejects(f.wallet.swearJar.retry("alice"), /original wallet/);
  f.wallet.db.prepare("UPDATE online_wallets SET account_id='alice'").run();
  f.identities.db.prepare("UPDATE identity_links SET subject='different'").run();
  await assert.rejects(f.wallet.swearJar.retry("alice"), /original LiD0llID/);
  assert.equal(f.calls.length, 1);
});

test("malformed receipts and SQLite completion failures retain the original operation for recovery", async t => {
  const f = fixture(t); f.link("alice"); f.badReceipt = true;
  await f.bot.handleMessage(f.message()); assert.equal(f.wallet.hasPending("alice"), true);
  f.badReceipt = false;
  f.wallet.db.exec("CREATE TRIGGER fail_swear BEFORE UPDATE OF state ON swear_jar_jobs WHEN NEW.state='done' BEGIN SELECT RAISE(FAIL,'disk failure'); END");
  await assert.rejects(f.wallet.swearJar.retry("alice"), /saved/);
  f.wallet.db.exec("DROP TRIGGER fail_swear"); await f.restart(); await f.bot.tick();
  assert.equal(f.balances.get("alice"), 9); assert.equal(f.wallet.hasPending("alice"), false);
  assert.equal(new Set(f.calls.map(call => call.request_id)).size, 1);
});

test("concurrent messages share wallet locks, queue their own one-coin fines and do not duplicate notifications", async t => {
  const f = fixture(t); f.link("alice");
  let release; f.delay = new Promise(resolve => { release = resolve; });
  const first = f.bot.handleMessage(f.message());
  const second = f.bot.handleMessage(f.message());
  assert.equal(f.calls.length, 1); assert.equal(f.jobs().length, 1);
  release(); await Promise.all([first, second]); f.delay = null; await f.bot.tick();
  assert.equal(f.calls.length, 2); assert.equal(f.balances.get("alice"), 8); assert.equal(f.sent.length, 2);
});

test("a swear arriving during unlink waits for its result and cannot strand a charge on the removed account", async t => {
  const f = fixture(t); f.link("alice");
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  f.api.revoke = async () => waiting;
  const unlink = f.wallet.disconnect("alice").then(() => f.identities.unlink("alice"));
  const message = f.bot.handleMessage(f.message());
  assert.equal(f.jobs().length, 0);
  release(); await unlink; await message;
  assert.equal(f.calls.length, 0); assert.equal(f.wallet.hasPending("alice"), false);
  assert.match(f.sent[0].content, /make a \*\*LiD0llID account/);
});

test("failed Discord notices retry independently without charging again", async t => {
  const f = fixture(t); f.link("alice"); f.failSend = true;
  await f.bot.handleMessage(f.message()); assert.equal(f.jobs()[0].notified, 0);
  f.failSend = false; await f.bot.tick();
  assert.equal(f.calls.length, 1); assert.equal(f.sent.length, 1); assert.equal(f.jobs()[0].notified, 1);
  assert.equal(f.sent[0].reply.messageReference, "100");
});

test("swear notices and apology retries use current role pronouns with neutral factual fallbacks", async t => {
  const f = fixture(t); f.link("alice");
  let role = "She/Her";
  f.client.guilds.cache.get("guild").members.fetch = async () => ({ user: { id: "alice" }, roles: { cache: new Map([["role", { name: role }]]) } });
  const generated = []; f.generate = async (kind, options) => { generated.push([kind, options.pronouns]); return null; };
  f.failSend = true; await f.bot.handleMessage(f.message());
  role = "He/Him"; f.failSend = false; await f.bot.tick();
  assert.deepEqual(generated.slice(0, 2), [["debit", "she/her"], ["debit", "he/him"]]);
  await f.bot.handleMessage(f.message("okay"));
  assert.deepEqual(generated.at(-1), ["reminder", "he/him"]);
  role = "It's Complicated"; await f.bot.handleMessage(f.message("sorry mommy"));
  assert.deepEqual(generated.at(-1), ["apology", "they/them"]);
  assert.equal(f.calls.length, 1);
  for (const payload of f.sent) assert.doesNotMatch(payload.content, /sweet girl|sweet boy/i);
});

test("shutdown drains an in-flight reply even when the same message is delivered again", async t => {
  const f = fixture(t); f.link("alice");
  let release, beginReply;
  const waiting = new Promise(resolve => { release = resolve; });
  const replying = new Promise(resolve => { beginReply = resolve; });
  const message = f.message("shit", { async reply(options) { beginReply(); await waiting; f.sent.push(options); } });
  const first = f.bot.handleMessage(message);
  await replying; await f.bot.handleMessage(message);
  let stopped = false;
  const stopping = f.bot.stop().then(() => { stopped = true; });
  await Promise.resolve(); assert.equal(stopped, false);
  release(); await Promise.all([first, stopping]);
  assert.equal(f.sent.length, 1); assert.equal(f.calls.length, 1); assert.equal(f.jobs()[0].notified, 1);
  assert.equal(await f.bot.handleMessage(f.message()), false);
});

test("pausing stops new fines while saved money still settles and overdue draws recover", async t => {
  const env = {}, f = fixture(t, env); f.link("alice");
  await f.bot.handleMessage(f.message()); env.SWEAR_JAR_ENABLED = "false"; await f.restart();
  assert.equal(await f.bot.handleMessage(f.message()), false);
  f.now = MONDAY + 3 * WEEK; await f.bot.tick();
  assert.equal(f.prizes().length, 1); assert.equal(f.prizes()[0].amount, 1);
  assert.equal(f.balances.get("alice"), 10);
});

test("per-server pots stay separate and an announcement channel in another server is never used", async t => {
  const f = fixture(t, { SWEAR_JAR_CHANNEL_ID: "other-channel" }); f.link("alice");
  await f.bot.handleMessage(f.message());
  await f.bot.handleMessage(f.message("shit", { guildId: "other", channelId: "other-channel" }));
  f.now = MONDAY + WEEK; await f.bot.tick();
  assert.equal(f.prizes().length, 1); assert.equal(f.prizes()[0].guild_id, "guild"); assert.equal(f.prizes()[0].amount, 1);
  assert.equal(f.jobs().filter(job => job.guild_id === "other")[0].allocation, null);
  assert.equal(f.balances.get("alice"), 9);
});

test("configuration can replace the swear list and missing wallet or identity disables the handler", async t => {
  const f = fixture(t, { SWEAR_JAR_WORDS: "heck, darn" }); f.link("alice");
  assert.equal(await f.bot.handleMessage(f.message("shit")), false);
  assert.equal(await f.bot.handleMessage(f.message("heck!")), true);
  assert.equal(createSwearJar(f.client, null, f.identities), null);
  assert.equal(createSwearJar(f.client, f.wallet, null), null);
});

test("AI wording accompanies factual payment details and the live server jar balance", async t => {
  const f = fixture(t); f.link("alice");
  const calls = [];
  f.generate = async kind => { calls.push(kind); return "Gentle words, sweetheart! Mommy's jar is listening."; };
  await f.bot.handleMessage(f.message());
  assert.match(f.sent[0].content, /^Gentle words, sweetheart!/);
  assert.match(f.sent[0].content, /has been put/);
  assert.match(f.sent[0].content, /Swear jar balance: \*\*1 LiDollcoins\*\*/);
  await f.bot.handleMessage(f.message());
  assert.match(f.sent[1].content, /Swear jar balance: \*\*2 LiDollcoins\*\*/);
  assert.deepEqual(calls, ["debit", "debit"]);
  assert.deepEqual(f.wallet.swearJar.balance("other"), { available: 0, reserved: 0 });
});

test("unlinked, disconnected and refused-payment replies still show the confirmed jar balance", async t => {
  const f = fixture(t); f.link("alice"); await f.bot.handleMessage(f.message());
  await f.bot.handleMessage(f.message("shit", { author: { id: "unlinked", bot: false } }));
  f.link("bob", { connected: false }); await f.bot.handleMessage(f.message("shit", { author: { id: "bob", bot: false } }));
  f.link("empty", { coins: 0 }); await f.bot.handleMessage(f.message("shit", { author: { id: "empty", bot: false } }));
  assert.ok(f.sent.every(message => message.content.includes("Swear jar balance: **1 LiDollcoins**")));
  assert.match(f.sent[1].content, /make a \*\*LiD0llID account/);
  assert.match(f.sent[2].content, /connect your wallet/);
  assert.match(f.sent[3].content, /No coin was collected/);
});

test("AI outages cannot prevent a paid fine, its fallback notice, or its balance", async t => {
  const f = fixture(t); f.link("alice");
  f.generate = async () => { throw new Error("brain offline"); };
  await f.bot.handleMessage(f.message());
  assert.equal(f.balances.get("alice"), 9); assert.equal(f.sent.length, 1);
  assert.match(f.sent[0].content, /MommyBot asks you/);
  assert.match(f.sent[0].content, /Swear jar balance: \*\*1 LiDollcoins\*\*/);
  assert.equal(f.jobs()[0].notified, 1);
});

test("lottery notices show available and reserved coins, then clear the reservation once paid", async t => {
  const f = fixture(t); f.link("alice"); f.link("bob", { connected: false }); f.winnerIndex = 1;
  f.generate = async kind => kind === "credit" ? "A little celebration for our lucky winner!" : null;
  await f.bot.handleMessage(f.message()); f.now = MONDAY + WEEK; await f.bot.tick();
  assert.match(f.sent.at(-1).content, /^A little celebration/);
  assert.match(f.sent.at(-1).content, /Swear jar balance: \*\*0 LiDollcoins\*\*/);
  assert.match(f.sent.at(-1).content, /Reserved lottery prizes: \*\*1 LiDollcoins\*\*/);
  assert.deepEqual(f.wallet.swearJar.balance("guild"), { available: 0, reserved: 1 });
  f.connect("bob", 0); await f.bot.tick();
  assert.match(f.sent.at(-1).content, /has been gifted/);
  assert.match(f.sent.at(-1).content, /Swear jar balance: \*\*0 LiDollcoins\*\*/);
  assert.doesNotMatch(f.sent.at(-1).content, /Reserved lottery prizes/);
});

test("balance is refreshed after a slow AI response, and notice retries never charge again", async t => {
  const f = fixture(t); f.link("alice"); f.link("bob");
  let release, started;
  const waiting = new Promise(resolve => { release = resolve; });
  const generating = new Promise(resolve => { started = resolve; });
  let first = true;
  f.generate = async () => { if (first) { first = false; started(); await waiting; } return "Gentle words, sweetheart."; };
  const message = f.bot.handleMessage(f.message()); await generating;
  await f.bot.handleMessage(f.message("shit", { author: { id: "bob", bot: false } }));
  release(); await message;
  assert.ok(f.sent.every(message => message.content.includes("Swear jar balance: **2 LiDollcoins**")));
  f.failSend = true; await f.bot.handleMessage(f.message()); f.failSend = false;
  await f.restart(); await f.bot.tick();
  assert.equal(f.calls.length, 3);
  assert.match(f.sent.at(-1).content, /Swear jar balance: \*\*3 LiDollcoins\*\*/);
});

test("private swear jar payment retries include a balance even while payment is pending", async t => {
  const f = fixture(t); f.link("alice"); f.lose = "debit";
  await f.bot.handleMessage(f.message());
  let response = await runWalletAction({ user: { id: "alice" } }, f.wallet, f.identities, "retry");
  assert.match(response.content, /Swear jar balance: \*\*0 LiDollcoins\*\*/);
  f.lose = null;
  response = await runWalletAction({ user: { id: "alice" } }, f.wallet, f.identities, "retry");
  assert.match(response.content, /Swear jar balance: \*\*1 LiDollcoins\*\*/);
  assert.equal(f.balances.get("alice"), 9);
});

test("cute apologies acknowledge the recent fine once, survive restart and never refund coins", async t => {
  const f = fixture(t); f.link("alice");
  await f.bot.handleMessage(f.message());
  assert.match(f.sent[0].content, /sorry mommy Sakura/);
  await f.restart();
  const apology = f.message("Sorry mommy Sakura!");
  assert.equal(await f.bot.handleMessage(apology), true);
  assert.match(f.sent.at(-1).content, /^Thank you for apologizing/);
  assert.deepEqual(f.sent.at(-1).allowedMentions.parse, []);
  await f.bot.handleMessage(apology);
  await f.restart(); await f.bot.handleMessage(apology); await f.bot.tick();
  assert.equal(f.sent.length, 2); assert.equal(f.calls.length, 1);
  assert.equal(f.balances.get("alice"), 9); assert.equal(f.jobs().length, 1);
});

test("generic, casual, formal and missing apologies get one act-your-age reminder, then a cute apology is accepted", async t => {
  for (const response of ["sorry", "my bad", "I apologize for my language", "anyway, how is everyone?", "I'm sorry Mommy, I'm late for work"]) {
    const f = fixture(t); f.link("alice");
    await f.bot.handleMessage(f.message());
    f.classify = async () => false;
    assert.equal(await f.bot.handleMessage(f.message(response)), true);
    assert.match(f.sent.at(-1).content, /act your age/);
    assert.match(f.sent.at(-1).content, /sorry mommybot/);
    assert.equal(await f.bot.handleMessage(f.message("still chatting")), false);
    f.classify = async () => true;
    await f.bot.handleMessage(f.message("Please forgive me, Mommy Sakura!"));
    assert.match(f.sent.at(-1).content, /^Thank you for apologizing/);
    assert.equal(f.sent.length, 3); assert.equal(f.calls.length, 1);
    assert.equal(await f.bot.handleMessage(f.message("ordinary conversation")), false);
  }
});

test("apology context stays with the same member, server and channel and expires after fifteen minutes", async t => {
  const f = fixture(t); f.link("alice");
  f.classify = async () => assert.fail("Unrelated messages must not reach the classifier");
  assert.equal(await f.bot.handleMessage(f.message("sorry mommy")), false);
  await f.bot.handleMessage(f.message());
  for (const overrides of [{ guildId: "other" }, { channelId: "elsewhere" }, { author: { id: "bob", bot: false } },
    { guildId: null }, { author: { id: "alice", bot: true } }, { webhookId: "hook" }]) {
    assert.equal(await f.bot.handleMessage(f.message("sorry mommy", overrides)), false);
  }
  assert.equal(await f.bot.handleMessage(f.message("/lidollid login")), false);
  f.now += 15 * 60_000 + 1;
  assert.equal(await f.bot.handleMessage(f.message("sorry mommy")), false);
  assert.equal(f.sent.length, 1);
});

test("an apology in the swear message uses friendly acknowledgment while retaining the fine", async t => {
  const f = fixture(t); f.link("alice");
  f.classify = async content => { assert.equal(content, "shit! sorry mommy"); return true; };
  f.generate = async kind => { assert.equal(kind, "apology"); return "Thank you for apologizing, darling!"; };
  await f.bot.handleMessage(f.message("shit! sorry mommy"));
  assert.equal(f.sent.length, 1); assert.match(f.sent[0].content, /^Thank you for apologizing/);
  assert.doesNotMatch(f.sent[0].content, /Now, a proper little apology/);
  assert.match(f.sent[0].content, /has been put/);
  assert.equal(f.calls.length, 1); assert.equal(f.balances.get("alice"), 9);
});

test("unlinked members can apologize without an account or any wallet operation", async t => {
  const f = fixture(t);
  await f.bot.handleMessage(f.message()); await f.bot.handleMessage(f.message("sorry mommybot"));
  assert.match(f.sent.at(-1).content, /^Thank you for apologizing/);
  assert.equal(f.calls.length, 0); assert.equal(f.jobs()[0].state, "skipped");
});

test("failed reminders and acknowledgments retry after restart without duplicate payments", async t => {
  const f = fixture(t); f.link("alice"); await f.bot.handleMessage(f.message());
  f.failSend = true; const casual = f.message("my bad"); await f.bot.handleMessage(casual);
  f.failSend = false; await f.restart(); await f.bot.tick();
  assert.match(f.sent.at(-1).content, /act your age/);
  assert.equal(f.sent.at(-1).reply.messageReference, casual.id);
  f.failSend = true; const apology = f.message("sorry mommy"); await f.bot.handleMessage(apology);
  f.failSend = false; await f.restart(); await f.bot.tick(); await f.bot.tick();
  assert.match(f.sent.at(-1).content, /^Thank you for apologizing/);
  assert.equal(f.sent.at(-1).reply.messageReference, apology.id);
  assert.equal(f.sent.length, 3); assert.equal(f.calls.length, 1);
});

test("a proper apology cancels an unsent reminder and another swear can receive its own reminder", async t => {
  const f = fixture(t); f.link("alice"); await f.bot.handleMessage(f.message());
  f.failSend = true; await f.bot.handleMessage(f.message("my bad"));
  f.failSend = false; await f.bot.handleMessage(f.message("sorry mommybot"));
  await f.bot.tick(); assert.equal(f.sent.length, 2);
  f.now++; await f.bot.handleMessage(f.message()); await f.bot.handleMessage(f.message("my bad"));
  assert.equal(f.sent.length, 4); assert.match(f.sent.at(-1).content, /act your age/);
  assert.equal(f.calls.length, 2);
});

test("an apology during slow fine generation replaces the scolding and sends only one notice", async t => {
  const f = fixture(t); f.link("alice");
  let release, started;
  const waiting = new Promise(resolve => { release = resolve; });
  const generating = new Promise(resolve => { started = resolve; });
  f.generate = async kind => {
    if (kind === "apology") return "Thank you for apologizing, darling!";
    started(); await waiting; return "SCOLDING";
  };
  const fine = f.bot.handleMessage(f.message()); await generating;
  await f.bot.handleMessage(f.message("sorry mommy"));
  release(); await fine; await f.bot.tick();
  assert.equal(f.sent.length, 1); assert.match(f.sent[0].content, /^Thank you for apologizing/);
  assert.doesNotMatch(f.sent[0].content, /SCOLDING/); assert.equal(f.calls.length, 1);
});

test("concurrent apologies bind to the observed fine and do not acknowledge a newer swear", async t => {
  const f = fixture(t); f.link("alice"); await f.bot.handleMessage(f.message());
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  f.classify = async () => { await waiting; return true; };
  const apology = f.message("sorry mommy");
  const pending = [f.bot.handleMessage(apology), f.bot.handleMessage(apology)];
  f.now++; await f.bot.handleMessage(f.message());
  release(); await Promise.all(pending); await f.bot.tick();
  assert.equal(f.sent.length, 3); assert.equal(f.calls.length, 2);
  const jobs = f.jobs();
  assert.ok(f.wallet.swearJar.apology(jobs[0].id)); assert.equal(f.wallet.swearJar.apology(jobs[1].id), undefined);
});

test("an accepted apology cancels a reminder while its retry is looking up the Discord channel", async t => {
  const f = fixture(t); f.link("alice"); await f.bot.handleMessage(f.message());
  f.failSend = true; await f.bot.handleMessage(f.message("my bad")); f.failSend = false;
  let release, fetching;
  const waiting = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { fetching = resolve; });
  f.client.channels.fetch = async () => { fetching(); await waiting; return f.channel("guild"); };
  const retry = f.bot.tick(); await started;
  await f.bot.handleMessage(f.message("sorry mommy"));
  release(); await retry; await f.bot.tick();
  assert.equal(f.sent.length, 2); assert.match(f.sent.at(-1).content, /^Thank you for apologizing/);
  assert.equal(f.calls.length, 1);
});

test("chat-generated reminders and thanks replace static replies while preserving examples and one fine", async t => {
  const f = fixture(t); f.link("alice"); await f.bot.handleMessage(f.message());
  const kinds = [];
  f.generate = async kind => { kinds.push(kind); return kind === "apology" ? "Such sweet manners, darling! Mommy accepts your apology." : "Act your age, darling; Mommy is waiting for a sweeter apology."; };
  await f.bot.handleMessage(f.message("my bad"));
  assert.match(f.sent.at(-1).content, /^Act your age, darling/);
  assert.match(f.sent.at(-1).content, /\*\*sorry mommy Sakura\*\*/);
  const apology = f.message("sorry mommybot");
  await f.bot.handleMessage(apology); await f.bot.handleMessage(apology); await f.bot.tick();
  assert.equal(f.sent.at(-1).content, "Such sweet manners, darling! Mommy accepts your apology.");
  assert.deepEqual(kinds, ["reminder", "apology"]);
  assert.equal(f.calls.length, 1); assert.equal(f.sent.length, 3);
});

test("chat failures fall back to the original apology and manners wording", async t => {
  const f = fixture(t); f.link("alice"); await f.bot.handleMessage(f.message());
  f.generate = async () => { throw new Error("chat offline"); };
  await f.bot.handleMessage(f.message("my bad"));
  assert.match(f.sent.at(-1).content, /act your age/);
  await f.bot.handleMessage(f.message("sorry mommy"));
  assert.match(f.sent.at(-1).content, /^Thank you for apologizing/);
  assert.equal(f.calls.length, 1);
});

test("a proper apology during reminder generation cancels the stale scolding", async t => {
  const f = fixture(t); f.link("alice"); await f.bot.handleMessage(f.message());
  let release, started;
  const waiting = new Promise(resolve => { release = resolve; });
  const generating = new Promise(resolve => { started = resolve; });
  f.generate = async kind => {
    if (kind === "apology") return "Mommy accepts your sweet apology!";
    started(); await waiting; return "Act your age, sweet girl. STALE REMINDER";
  };
  const reminder = f.bot.handleMessage(f.message("my bad")); await generating;
  await f.bot.handleMessage(f.message("sorry mommy"));
  release(); await reminder; await f.bot.tick();
  assert.equal(f.sent.length, 2); assert.equal(f.sent.at(-1).content, "Mommy accepts your sweet apology!");
  assert.ok(f.sent.every(message => !message.content.includes("STALE REMINDER")));
  assert.equal(f.calls.length, 1);
});

test("each advertised direct apology goes straight to positive chat generation without a router call", async t => {
  const f = fixture(t); f.link("alice");
  let routerCalls = 0;
  const kinds = [];
  f.classify = (text, options) => classifySwearApology(text, { ...options, fetcher: async () => {
    routerCalls++;
    return { ok: true, json: async () => ({ choices: [{ message: { content: "reject" } }] }) };
  } });
  f.generate = async kind => { kinds.push(kind); return kind === "apology" ? "Mommy accepts your sweet apology!" : null; };
  for (const text of ["**sorry mommy**", "**sorry mommy Sakura**", "**sorry mommybot**"]) {
    f.now++;
    await f.bot.handleMessage(f.message());
    assert.equal(await f.bot.handleMessage(f.message(text)), true);
    assert.equal(f.sent.at(-1).content, "Mommy accepts your sweet apology!");
  }
  assert.equal(routerCalls, 0);
  assert.deepEqual(kinds, ["debit", "apology", "debit", "apology", "debit", "apology"]);
  assert.equal(f.calls.length, 3); assert.equal(f.balances.get("alice"), 7);
});

test("sorry momma passes the message gate and selects positive chat without calling the classifier", async t => {
  const f = fixture(t); f.link("alice"); await f.bot.handleMessage(f.message());
  let routerCalls = 0;
  const kinds = [];
  f.classify = (text, options) => classifySwearApology(text, { ...options, fetcher: async () => {
    routerCalls++;
    return { ok: true, json: async () => ({ choices: [{ message: { content: "reject" } }] }) };
  } });
  f.generate = async kind => { kinds.push(kind); return "Momma accepts your sweet apology!"; };
  assert.equal(await f.bot.handleMessage(f.message("sorry momma")), true);
  assert.equal(f.sent.at(-1).content, "Momma accepts your sweet apology!");
  assert.deepEqual(kinds, ["apology"]); assert.equal(routerCalls, 0);
  assert.equal(f.calls.length, 1); assert.equal(f.balances.get("alice"), 9);
});
