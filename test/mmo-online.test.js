import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onlineConfig, createOnlinePublisher, joinMessage } from "../src/mmo/online.js";

const stream = "11111111-1111-4111-8111-111111111111", secondStream = "22222222-2222-4222-8222-222222222222";
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "mommybot-online-"));
  const f = { now: 1000000, events: [], sent: [], posts: new Map(), logs: [], stream, requests: [] };
  f.config = { url: "http://10.1.1.23:4191/integrations/mommybot/joins", token: "x".repeat(43), channel: "1550612967253352528", filename: join(directory, "online.db") };
  f.channel = { guildId: "guild", isTextBased: () => true, messages: { fetch: async () => f.posts }, send: async payload => {
    if (f.beforeSend) await f.beforeSend();
    if (f.failSend) throw Error("PRIVATE");
    const message = { id: String(f.sent.length + 1), author: { id: "bot" }, embeds: payload.embeds };
    f.sent.push(payload); f.posts.set(message.id, message);
    if (f.loseReceipt) throw Error("PRIVATE lost receipt");
    return message;
  } };
  f.role = { id: "1550612967253352529", name: "lidollmmo", mentionable: true };
  f.roles = new Map([[f.role.id, f.role]]);
  f.channel.guild = { roles: { fetch: async () => f.roles }, members: { fetchMe: async () => ({}) } };
  f.channel.permissionsFor = () => ({ has: () => false });
  f.client = { user: { id: "bot" }, channels: { fetch: async id => { assert.equal(id, f.config.channel); return f.channel; } } };
  f.fetcher = async (url, options) => {
    f.requests.push({ url: String(url), options });
    assert.equal(options.headers.Authorization, `Bearer ${f.config.token}`); assert.equal(options.redirect, "error");
    if (f.failFeed) return new Response("PRIVATE", { status: 401 });
    if (f.raw) return new Response(f.raw);
    const after = Number(url.searchParams.get("after")), events = f.events.filter(event => event.id > after).slice(0, 20);
    const latest = f.events.at(-1)?.id ?? 0, next = events.at(-1)?.id ?? Math.max(after, latest);
    return Response.json({ stream: f.stream, events, latest_cursor: latest, next_cursor: next, has_more: next < latest });
  };
  f.start = () => { f.publisher = createOnlinePublisher(f.client, { config: f.config, fetcher: f.fetcher, now: () => f.now, logger: { error: line => f.logs.push(line) } }); };
  f.add = (extra = {}) => f.events.push({ id: (f.events.at(-1)?.id ?? 0) + 1, name: "Friend", joined_at: f.now, online: 1, ...extra });
  f.start();
  t.after(async () => { await f.publisher.stop(); rmSync(directory, { recursive: true, force: true }); });
  return f;
}

test("online announcements require opt-in and a dedicated token, and permit private LAN access", () => {
  assert.equal(onlineConfig({}), null);
  const env = { LIDOLLMMO_ONLINE_ENABLED: "true", LIDOLLMMO_ONLINE_URL: "http://10.1.1.23:4191/integrations/mommybot/joins", MOMMYBOT_ONLINE_TOKEN: "x".repeat(43) };
  assert.equal(onlineConfig(env).channel, "1550612967253352528");
  for (const url of ["http://public.example/", "https://user:pass@example.com/", "https://example.com/?token=secret"]) assert.throws(() => onlineConfig({ ...env, LIDOLLMMO_ONLINE_URL: url }));
  assert.throws(() => onlineConfig({ ...env, MOMMYBOT_ONLINE_TOKEN: "short" }));
  assert.equal(createOnlinePublisher({}, { env: { ...env, MOMMYBOT_ONLINE_TOKEN: "" }, logger: { error() {} } }), null);
});

test("future-only initialization and durable cursors post each new signed-in arrival once across restart", async t => {
  const f = fixture(t); f.add(); await f.publisher.poll(); assert.equal(f.sent.length, 0);
  f.add({ name: "New friend" }); await Promise.all([f.publisher.poll(), f.publisher.poll()]);
  assert.equal(f.sent.length, 1); assert.match(f.sent[0].embeds[0].description, /New friend.*joined/);
  assert.equal(f.sent[0].content, `<@&${f.role.id}>`);
  assert.deepEqual(f.sent[0].allowedMentions, { parse: [], users: [], roles: [f.role.id] });
  await f.publisher.stop(); f.start(); await f.publisher.poll(); assert.equal(f.sent.length, 1);
  f.add(); await f.publisher.poll(); assert.equal(f.sent.length, 2);
});

test("lost Discord receipts reconcile after restart and retryable failures retain pending joins", async t => {
  const f = fixture(t); await f.publisher.poll(); f.add(); f.loseReceipt = true;
  await f.publisher.poll(); assert.equal(f.sent.length, 1);
  await f.publisher.stop(); f.start(); f.loseReceipt = false; await f.publisher.poll();
  assert.equal(f.sent.length, 1);
  f.add(); f.failSend = true; await f.publisher.poll(); f.failSend = false; await f.publisher.poll();
  assert.equal(f.sent.length, 2); assert.doesNotMatch(f.logs.join(""), /PRIVATE|x{43}/);
});

test("offline and stale joins are skipped, feed failures keep cursors and replaced sources reinitialize", async t => {
  const f = fixture(t); await f.publisher.poll();
  f.add({ online: 0 }); f.add({ joined_at: f.now - 120001 }); f.add();
  f.failFeed = true; await f.publisher.poll(); assert.equal(f.sent.length, 0);
  f.failFeed = false; await f.publisher.poll(); assert.equal(f.sent.length, 1);
  f.stream = secondStream; f.events = []; f.add(); await f.publisher.poll(); assert.equal(f.sent.length, 1);
  f.add(); await f.publisher.poll(); assert.equal(f.sent.length, 2);
});

test("bounded pages drain without dropping events and malformed responses never post", async t => {
  const f = fixture(t); await f.publisher.poll();
  for (let i = 0; i < 23; i++) f.add();
  for (const raw of ["PRIVATE", "x".repeat(65537), JSON.stringify({ stream, events: [{ id: 2 }, { id: 1 }], latest_cursor: 2, next_cursor: 1, has_more: false })]) {
    f.raw = raw; await f.publisher.poll(); assert.equal(f.sent.length, 0);
  }
  f.raw = null; await f.publisher.poll(); assert.equal(f.sent.length, 20);
  await f.publisher.poll(); assert.equal(f.sent.length, 23);
});

test("names cannot inject mentions or markdown and shutdown drains active delivery", async t => {
  const payload = joinMessage(stream, { id: 1, name: "@everyone **hi** <@123>\nhello" });
  assert.deepEqual(payload.allowedMentions, { parse: [], users: [], roles: [] });
  assert.match(payload.embeds[0].description, /\\\*\\\*hi/); assert.ok(payload.nonce.length <= 25);
  const f = fixture(t); await f.publisher.poll(); f.add();
  let release, entered; const ready = new Promise(resolve => { entered = resolve; });
  f.beforeSend = async () => { entered(); await new Promise(resolve => { release = resolve; }); };
  const pending = f.publisher.poll(); await ready;
  let stopped = false; const stop = f.publisher.stop().then(() => { stopped = true; });
  await Promise.resolve(); assert.equal(stopped, false); release(); await pending; await stop;
  f.start(); await f.publisher.poll(); assert.equal(f.sent.length, 1);
});

test("only the destination server's unique mentionable lidollmmo role can be pinged", async t => {
  const f = fixture(t); await f.publisher.poll(); f.add();
  f.role.name = "different"; await f.publisher.poll(); assert.equal(f.sent.length, 0);
  f.role.name = "LiDollMMO"; f.roles.set("duplicate", { ...f.role, id: "duplicate" });
  await f.publisher.poll(); assert.equal(f.sent.length, 0);
  f.roles.delete("duplicate"); f.role.mentionable = false;
  await f.publisher.poll(); assert.equal(f.sent.length, 0); assert.match(f.logs.at(-1), /mentionable/);
  f.channel.permissionsFor = () => ({ has: () => true });
  await f.publisher.poll(); assert.equal(f.sent.length, 1);
  assert.deepEqual(f.sent[0].allowedMentions.roles, [f.role.id]);
});

test("a return from away is announced differently from a join and never pings the role", async t => {
  const f = fixture(t);
  await f.publisher.poll(); // The first pass only establishes the future-only baseline.
  f.add({ kind: "return" });
  await f.publisher.poll();
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].content, undefined); // Coming back from away is worth noting, not worth a role ping.
  assert.deepEqual(f.sent[0].allowedMentions, { parse: [], users: [], roles: [] });
  assert.match(f.sent[0].embeds[0].title, /Back again/);
  assert.match(f.sent[0].embeds[0].description, /is back at the keyboard/);
  assert.match(f.sent[0].embeds[0].footer.text, /LiDollMMO return/);
  f.add({ kind: "join" });
  await f.publisher.poll();
  assert.equal(f.sent.length, 2);
  assert.equal(f.sent[1].content, `<@&${f.role.id}>`);
  assert.match(f.sent[1].embeds[0].description, /just joined/);
  assert.match(f.sent[1].embeds[0].footer.text, /LiDollMMO join/);
  assert.notEqual(f.sent[0].nonce, f.sent[1].nonce);
});

test("an older game server without arrival kinds still announces joins, and a bad kind is rejected", async t => {
  const f = fixture(t);
  await f.publisher.poll();
  f.add(); // No kind field at all.
  await f.publisher.poll();
  assert.equal(f.sent.length, 1);
  assert.match(f.sent[0].embeds[0].description, /just joined/);
  assert.equal(f.sent[0].content, `<@&${f.role.id}>`);
  f.add({ kind: "afk" });
  await f.publisher.poll();
  assert.equal(f.sent.length, 1); // An unrecognized kind is a feed error, never a guess.
  assert.ok(f.logs.some(line => /feed_invalid_data/.test(line)));
});

test("joinMessage keeps both wordings free of injected mentions", () => {
  const stream = "00000000-0000-4000-8000-000000000000";
  for (const kind of ["join", "return"]) {
    const payload = joinMessage(stream, { id: 1, name: "@everyone <@123>", kind }, "999");
    assert.deepEqual(payload.allowedMentions.parse, []); // Neither wording can resolve an injected mention.
    assert.deepEqual(payload.allowedMentions.users, []);
    assert.deepEqual(payload.allowedMentions.roles, kind === "return" ? [] : ["999"]);
  }
});
