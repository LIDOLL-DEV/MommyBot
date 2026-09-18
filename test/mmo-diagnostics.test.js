import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { PermissionFlagsBits as P } from "discord.js";
import { inspectOnline, channelPermissions } from "../src/mmo/diagnostics.js";
import { onlinePage, onlineFailure } from "../src/mmo/feed.js";

const guild = "111111111111111111", bot = "222222222222222222", role = "333333333333333333";
const required = P.ViewChannel | P.SendMessages | P.EmbedLinks | P.ReadMessageHistory;
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "mommybot-online-diagnostic-")); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const f = { filename: join(directory, "online.db"), requests: [], now: 1000000,
    env: { LIDOLLMMO_ONLINE_ENABLED: "true", LIDOLLMMO_ONLINE_URL: "http://10.1.1.23:4191/integrations/mommybot/joins", MOMMYBOT_ONLINE_TOKEN: "x".repeat(43), DISCORD_TOKEN: "PRIVATE-BOT-TOKEN" },
    channel: { guild_id: guild, type: 0, permission_overwrites: [] }, roles: [{ id: guild, name: "@everyone", permissions: String(required) }, { id: role, name: "lidollmmo", mentionable: true, permissions: "0" }] };
  f.fetcher = async (input, options) => {
    const url = new URL(input); f.requests.push(url.pathname); assert.equal(options.method, undefined); assert.equal(options.redirect, "error");
    if (url.hostname === "10.1.1.23") {
      assert.equal(options.headers.Authorization, `Bearer ${f.env.MOMMYBOT_ONLINE_TOKEN}`);
      return f.feedStatus ? new Response("PRIVATE REMOTE BODY", { status: f.feedStatus }) : Response.json({ stream: "11111111-1111-4111-8111-111111111111", events: [], latest_cursor: 0, next_cursor: 0, has_more: false });
    }
    assert.equal(url.origin, "https://discord.com"); assert.equal(options.headers.Authorization, `Bot ${f.env.DISCORD_TOKEN}`);
    if (f.discordStatus) return new Response("PRIVATE REMOTE BODY", { status: f.discordStatus });
    if (url.pathname.includes("/channels/")) return Response.json(f.channel);
    if (url.pathname.endsWith("/roles")) return Response.json(f.roles);
    if (url.pathname.endsWith("/users/@me")) return Response.json({ id: bot });
    assert.equal(url.pathname, `/api/v10/guilds/${guild}/members/${bot}`);
    return Response.json({ roles: [] });
  };
  f.inspect = () => inspectOnline(f.env, { filename: f.filename, fetcher: f.fetcher, now: () => f.now });
  return f;
}

test("diagnostic probes authenticated feed and Discord without creating a database or sending messages", async t => {
  const f = fixture(t), result = await f.inspect();
  assert.equal(result.ok, true); assert.equal(existsSync(f.filename), false);
  assert.equal(result.checks.find(check => check.check === "saved_progress").initialized, false);
  assert.match(result.checks.find(check => check.check === "join_feed").detail, /no arrivals/);
  assert.equal(result.checks.find(check => check.check === "discord").canPingRole, true);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|x{43}/);
});

test("diagnostic distinguishes disabled config, missing endpoint, wrong token, disabled feed and Discord access", async t => {
  const f = fixture(t);
  f.env.LIDOLLMMO_ONLINE_ENABLED = "false"; assert.equal((await f.inspect()).checks[0].ok, false);
  f.env.LIDOLLMMO_ONLINE_ENABLED = "true";
  for (const [status, hint] of [[401, /Shared secret rejected/], [404, /endpoint missing/], [503, /Feed disabled/]]) {
    f.feedStatus = status; const result = await f.inspect();
    assert.equal(result.ok, false); assert.match(result.checks.find(check => check.check === "join_feed").detail, hint);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|x{43}/);
  }
  f.feedStatus = null; f.discordStatus = 403;
  assert.match((await f.inspect()).checks.find(check => check.check === "discord").detail, /discord_http_403/);
  f.env.MOMMYBOT_ONLINE_TOKEN = "bad";
  assert.equal((await f.inspect()).checks.find(check => check.check === "configuration").ok, false);
});

test("diagnostic reports missing channel permissions, ambiguous roles and mentionability", async t => {
  const f = fixture(t); f.channel.permission_overwrites = [{ id: guild, type: 0, deny: String(P.SendMessages), allow: "0" }];
  let result = (await f.inspect()).checks.find(check => check.check === "discord");
  assert.deepEqual(result.missingPermissions, ["SendMessages"]);
  f.channel.permission_overwrites = []; f.roles[1].mentionable = false;
  result = (await f.inspect()).checks.find(check => check.check === "discord"); assert.equal(result.ok, false); assert.match(result.detail, /mentionable/);
  f.roles[0].permissions = String(required | P.MentionEveryone); assert.equal((await f.inspect()).ok, true);
  f.roles.push({ ...f.roles[1], id: "444444444444444444" });
  assert.equal((await f.inspect()).checks.find(check => check.check === "discord").matchingRoles, 2);
});

test("effective Discord permissions apply combined role and member overrides and administrator bypass", () => {
  const roles = [{ id: guild, permissions: String(required) }, { id: role, permissions: "0" }];
  const channel = { permission_overwrites: [{ id: guild, type: 0, deny: String(P.SendMessages), allow: "0" },
    { id: role, type: 0, deny: "0", allow: String(P.SendMessages) }, { id: bot, type: 1, deny: String(P.EmbedLinks), allow: "0" }] };
  let permissions = channelPermissions(channel, roles, { roles: [role] }, bot, guild);
  assert.equal(permissions.has(P.SendMessages), true); assert.equal(permissions.has(P.EmbedLinks), false);
  roles[1].permissions = String(P.Administrator);
  permissions = channelPermissions(channel, roles, { roles: [role] }, bot, guild); assert.equal(permissions.has(required), true);
});

test("diagnostic reads saved progress without changing cursors or pending deliveries", async t => {
  const f = fixture(t), db = new Database(f.filename);
  db.exec("CREATE TABLE online_feeds(url TEXT,channel TEXT,stream TEXT,cursor INTEGER); CREATE TABLE online_attempts(url TEXT,channel TEXT,stream TEXT,event INTEGER);");
  db.prepare("INSERT INTO online_feeds VALUES (?,?,?,?)").run(f.env.LIDOLLMMO_ONLINE_URL, "1550612967253352528", "11111111-1111-4111-8111-111111111111", 0);
  db.prepare("INSERT INTO online_attempts VALUES (?,?,?,?)").run(f.env.LIDOLLMMO_ONLINE_URL, "1550612967253352528", "11111111-1111-4111-8111-111111111111", 1);
  try {
    const result = await f.inspect(); assert.equal(result.checks.find(check => check.check === "saved_progress").pendingAttempts, 1);
    assert.equal(db.prepare("SELECT cursor FROM online_feeds").get().cursor, 0); assert.equal(db.prepare("SELECT COUNT(*) n FROM online_attempts").get().n, 1);
  } finally { db.close(); }
});

test("feed diagnostics never echo proxy bodies and preserve useful nested network error codes", async () => {
  await assert.rejects(onlinePage({ url: "http://localhost/", token: "secret" }, 0, async () => new Response("PRIVATE proxy HTML")), error => {
    assert.match(onlineFailure(error), /feed_invalid_json/); assert.doesNotMatch(onlineFailure(error), /PRIVATE/); return true;
  });
  assert.match(onlineFailure(new Error("PRIVATE", { cause: { code: "ECONNREFUSED" } })), /ECONNREFUSED/);
  assert.doesNotMatch(onlineFailure(new Error("PRIVATE")), /PRIVATE/);
});
