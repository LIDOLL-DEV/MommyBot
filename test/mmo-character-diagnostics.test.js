import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { inspectCharacter } from "../src/mmo/characterDiagnostics.js";

const TOKEN = "x".repeat(43), ACCOUNT = "a".repeat(64), GAME_ACCOUNT = "b".repeat(64), DISCORD = "123456789012345678";
const ENV = { LIDOLLMMO_CHARACTERS_ENABLED: "true", LIDOLLMMO_ONLINE_URL: "http://10.1.1.23:4191/integrations/mommybot/joins",
  MOMMYBOT_ONLINE_TOKEN: TOKEN, LIDOLLCOIN_API_URL: "https://tracker.example/v1/" };

function walletDb(t, { account = ACCOUNT, base = "https://tracker.example/v1/" } = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "mommybot-chardiag-"));
  const filename = path.join(directory, "wallet.db");
  const db = new Database(filename);
  db.exec(`CREATE TABLE online_wallets (discord_id TEXT PRIMARY KEY, token TEXT NOT NULL, expires INTEGER NOT NULL,
    account_id TEXT NOT NULL, base_url TEXT NOT NULL, client_id TEXT NOT NULL);`);
  db.prepare("INSERT INTO online_wallets VALUES (?,?,?,?,?,?)").run(DISCORD, "secret-token", 9e12, account, base, "lidollbot");
  db.close();
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return filename;
}

const gameLink = () => new Response(JSON.stringify({ account_id: GAME_ACCOUNT, wallet_account_id: ACCOUNT, client_id: "lidollquest" }), { status: 200 });
const reply = (status, body) => async url => url.pathname.endsWith("/quest-account") ? gameLink() : new Response(JSON.stringify(body), { status });
const find = (result, name) => result.checks.find(check => check.name === name);

test("a healthy setup reports every stage as passing", async t => {
  const filename = walletDb(t);
  let asked;
  const result = await inspectCharacter(ENV, DISCORD, { filename, fetcher: async url => {
    if(url.pathname.endsWith("/quest-account"))return gameLink();
    asked = new URL(url);
    return { status: 200, ok: true, async text() { return JSON.stringify({ name: "Friend", characters: [{ id: "c1", name: "Friend" }] }); } };
  } });
  assert.equal(result.ok, true);
  assert.equal(asked.pathname, "/integrations/mommybot/character");
  assert.equal(asked.searchParams.get("account_id"), GAME_ACCOUNT);
  assert.match(find(result, "game server").detail, /Friend/);
});

test("a missing character is reported after resolving the game account", async t => {
  const filename = walletDb(t);
  const result = await inspectCharacter(ENV, DISCORD, { filename, fetcher: reply(404, { error: "character_unavailable" }) });
  assert.equal(result.ok, false);
  assert.match(find(result, "character").detail, /no character owned by the translated game account_id/);
  assert.doesNotMatch(find(result, "character").detail, /usual cause|not the one the character was made under/);
});

test("a game server without the endpoint is distinguished from a missing character", async t => {
  const filename = walletDb(t);
  const result = await inspectCharacter(ENV, DISCORD, { filename, fetcher: reply(404, { error: "not_found" }) });
  assert.match(find(result, "game server").detail, /not running a build with/);
  assert.equal(find(result, "character"), undefined);
});

test("credential, disabled-sharing and unreachable game servers each get their own explanation", async t => {
  const filename = walletDb(t);
  assert.match(find(await inspectCharacter(ENV, DISCORD, { filename, fetcher: reply(401, {}) }), "game server").detail, /same MOMMYBOT_ONLINE_TOKEN/);
  assert.match(find(await inspectCharacter(ENV, DISCORD, { filename, fetcher: reply(503, {}) }), "game server").detail, /disabled on the game server/);
  assert.match(find(await inspectCharacter(ENV, DISCORD, { filename, fetcher: reply(500, {}) }), "game server").detail, /HTTP 500/);
  const offline = await inspectCharacter(ENV, DISCORD, { filename, fetcher: async url => { if(url.pathname.endsWith("/quest-account"))return gameLink();throw new Error("no route"); } });
  assert.match(find(offline, "game server").detail, /Could not reach the game server/);
});

test("a wallet connected against a different tracker is flagged, because the account id would differ", async t => {
  const filename = walletDb(t, { base: "https://old-tracker.example/v1/" });
  const result = await inspectCharacter(ENV, DISCORD, { filename, fetcher: reply(200, { name: "Friend", characters: [] }) });
  assert.equal(find(result, "wallet origin").ok, false);
  assert.match(find(result, "wallet origin").detail, /different tracker yields a different account_id/);
});

test("an unconnected member and an off or misdirected configuration stop before contacting the game", async t => {
  const filename = walletDb(t);
  let called = 0;
  const counting = async () => { called++; return { status: 200, ok: true, async text() { return "{}"; } }; };
  assert.match(find(await inspectCharacter(ENV, "999999999999999999", { filename, fetcher: counting }), "wallet link").detail, /no connected wallet/);
  assert.match(find(await inspectCharacter(ENV, "not-an-id", { filename, fetcher: counting }), "wallet link").detail, /17-20 digit/);
  assert.match(find(await inspectCharacter({}, DISCORD, { filename, fetcher: counting }), "configuration").detail, /LIDOLLMMO_CHARACTERS_ENABLED/);
  const misdirected = { ...ENV, LIDOLLMMO_CHARACTER_URL: "http://10.1.1.23:4191/integrations/mommybot/joins" };
  assert.match(find(await inspectCharacter(misdirected, DISCORD, { filename, fetcher: counting }), "endpoint path").detail, /does not end in/);
  assert.equal(called, 0); // None of these should reach the game server at all.
});

test("the report never contains the bridge token or a whole account id", async t => {
  const filename = walletDb(t);
  const result = await inspectCharacter(ENV, DISCORD, { filename, fetcher: reply(404, { error: "character_unavailable" }) });
  const text = JSON.stringify(result);
  assert.doesNotMatch(text, new RegExp(TOKEN));
  assert.doesNotMatch(text, new RegExp(ACCOUNT));
  assert.doesNotMatch(text, new RegExp(GAME_ACCOUNT));
  assert.doesNotMatch(text, /secret-token/);
  assert.match(text, /aaaaaa…aaaa \(64 chars\)/); // Enough to compare against the game server by eye.
});


test("an older tracker stops at account translation and never queries the game with a bot ID",async t=>{
 const filename=walletDb(t),calls=[];
 const result=await inspectCharacter(ENV,DISCORD,{filename,fetcher:async(url,options)=>{
  calls.push(url.pathname);assert.equal(options.headers.Authorization,"Bearer secret-token");
  return new Response(JSON.stringify({error:"not_found"}),{status:404});
 }});
 assert.equal(result.ok,false);assert.match(find(result,"game account link").detail,/deploy the updated tracker/);
 assert.deepEqual(calls,["/v1/quest-account"]);
});

test("diagnostic rejects a tracker link for another wallet before contacting the game",async t=>{
 const filename=walletDb(t),calls=[];
 const result=await inspectCharacter(ENV,DISCORD,{filename,fetcher:async url=>{
  calls.push(url.pathname);return new Response(JSON.stringify({account_id:GAME_ACCOUNT,wallet_account_id:"c".repeat(64),client_id:"lidollquest"}));
 }});
 assert.equal(result.ok,false);assert.match(find(result,"game account link").detail,/does not match the saved connection/);
 assert.deepEqual(calls,["/v1/quest-account"]);
});
