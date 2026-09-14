import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { WalletClient, WalletError, walletConfig } from "../src/wallet/client.js";
import { WalletService } from "../src/wallet/service.js";
import { OnlineAdoptions } from "../src/wallet/adoptions.js";
import { TouhouStore, MOMIJI_OWNER_ID } from "../src/touhou/store.js";
import { createTouhouHandlers } from "../src/touhou/commands.js";
import { createIdentityHandler } from "../src/auth/index.js";

const scopes = "wallet:read wallet:write stars:read stars:write";
const catalog = ["Reimu Hakurei", "Marisa Kirisame", "Cirno", "Momiji Inubashiri", ...Array.from({ length: 8 }, (_, i) => `Extra ${i}`)]
  .map(name => ({ name, filename: `${name}.png`, baseRarity: 0 }));

function provider() {
  const api = { now: 1000, account: "account-a", funds: { stars: 10, coins: 100 }, receipts: new Map(), grants: new Map(),
    calls: [], approved: true, failAfterDebit: false, failAfterRefund: false, failBalance: false, badReceipt: false, delayDebit: null };
  api.fetch = async (url, options) => {
    assert.equal(url.searchParams.get("client_id"), "lidollbot");
    assert.equal(options.redirect, "manual");
    const route = url.pathname.split("/").at(-1);
    const body = options.body ? JSON.parse(options.body) : null;
    api.calls.push({ route, body });
    const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
    if (route === "device") {
      assert.equal(body.scope, scopes);
      return json({ device_code: "d".repeat(43), user_code: "ABCDEF-123456", verification_uri: "https://lidoll.dev/tracker/coins/", expires_in: 600, interval: 5 });
    }
    if (route === "token") {
      assert.equal(body.grant_type, "urn:ietf:params:oauth:grant-type:device_code");
      if (api.slow) return json({ error: "slow_down" }, 400);
      if (!api.approved) return json({ error: "authorization_pending" }, 400);
      const token = `grant_${api.grants.size}`.padEnd(43, "x");
      api.grants.set(token, api.account);
      return json({ access_token: token, token_type: "Bearer", expires_in: 2592000, scope: scopes });
    }
    const token = options.headers.Authorization?.slice(7);
    if (!api.grants.has(token)) return json({ error: "invalid_token", error_description: "PRIVATE PROVIDER RESPONSE" }, 401);
    if (route === "wallet") {
      if (api.failBalance) throw new Error("network interrupted");
      return json({ account_id: api.grants.get(token), balance: api.funds.coins, stars: api.funds.stars, stars_enabled: true });
    }
    if (route === "revoke") { api.grants.delete(token); return json({ ok: true }); }
    assert.equal(route, "operations");
    const key = `${api.grants.get(token)}:${body.request_id}`;
    assert.match(body.request_id, /^[\w-]{1,80}$/);
    const old = api.receipts.get(key);
    if (old) {
      assert.deepEqual(old.body, body);
      return json(old.receipt);
    }
    const amount = body.kind === "refund" ? api.receipts.get(`${api.grants.get(token)}:${body.original_id}`).receipt.amount : body.amount;
    if (body.kind === "debit" && api.funds[body.asset] < amount) return json({ error: "invalid_request" }, 409);
    api.funds[body.asset] += body.kind === "debit" ? -amount : amount;
    const receipt = { operation_id: "server-operation", request_id: body.request_id, kind: body.kind, amount,
      balance: api.funds[body.asset], asset: body.asset, currency: body.asset === "stars" ? "Stars" : "LiDollCoin" };
    api.receipts.set(key, { receipt, body });
    if (body.kind === "debit" && api.delayDebit) await api.delayDebit();
    if (body.kind === "debit" && api.failAfterDebit || body.kind === "refund" && api.failAfterRefund) throw new Error("response lost after commit");
    return json(api.badReceipt ? { ...receipt, amount: amount + 1 } : receipt);
  };
  return api;
} // Model the inspected Little Log device/receipt contract without using real accounts or spending live funds.

function setup(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "mommybot-wallet-"));
  const api = provider();
  const client = new WalletClient(walletConfig({ LIDOLLCOIN_ENABLED: "true" }), api.fetch);
  const fixture = { api, client };
  const open = () => {
    fixture.store = new TouhouStore(path.join(directory, "trader.db"), catalog);
    fixture.wallet = new WalletService(path.join(directory, "wallet.db"), client, { now: () => api.now });
    fixture.adoptions = new OnlineAdoptions(fixture.store, fixture.wallet);
  };
  fixture.reopen = async () => { await fixture.wallet.close(); fixture.store.close(); open(); };
  fixture.connect = async (user = "alice") => {
    const approval = await fixture.wallet.begin(user);
    api.now += 5000;
    await fixture.wallet.finish(user, approval.generation);
  };
  open();
  t.after(async () => { await fixture.wallet.close(); fixture.store.close(); rmSync(directory, { recursive: true, force: true }); });
  return fixture;
} // Reopen both databases to test crash recovery with real persisted grants, reservations and receipts.

test("online adoption spends exactly one star or 25 coins, preserving local balances and Momiji", async t => {
  const f = setup(t); await f.connect();
  const stars = await f.adoptions.adopt("guild", "alice", "stars", "star-click");
  assert.equal(stars.price, 1);
  assert.deepEqual(f.api.funds, { stars: 9, coins: 100 });
  assert.deepEqual(await f.adoptions.adopt("guild", "alice", "stars", "star-click"), stars);
  await assert.rejects(f.adoptions.adopt("guild", "alice", "coins", "star-click"), /already been used/);
  await f.adoptions.adopt("guild", "alice", "coins", "coin-click");
  assert.deepEqual(await f.wallet.balance("alice"), { accountId: "account-a", stars: 9, coins: 75 });
  assert.deepEqual(f.store.wallet("guild", "alice"), { stars: 0, coins: 0 });
  assert.equal(f.store.character("guild", "Momiji Inubashiri").owner_id, MOMIJI_OWNER_ID);
  assert.equal(f.store.collection("guild", "alice").length, 2);
  await f.reopen();
  assert.deepEqual(await f.adoptions.adopt("guild", "alice", "stars", "star-click"), stars);
  assert.equal(f.api.receipts.size, 2);
});

test("insufficient funds, missing consent and full parties never fall back to local money", async t => {
  const f = setup(t);
  f.store.award("guild", "admin", "alice", "stars", 100, "local");
  await assert.rejects(f.adoptions.adopt("guild", "alice", "stars", "unlinked"), /Connect your Little Log/);
  await f.connect();
  f.api.funds.stars = 0;
  await assert.rejects(f.adoptions.adopt("guild", "alice", "stars", "poor"), /refused/);
  assert.equal(f.adoptions.pending("alice"), undefined);
  assert.equal(f.store.collection("guild", "alice").length, 0);
  assert.equal(f.store.wallet("guild", "alice").stars, 100);
  f.api.funds.stars = 10;
  for (let i = 0; i < 6; i++) await f.adoptions.adopt("guild", "alice", "stars", `full-${i}`);
  await assert.rejects(f.adoptions.adopt("guild", "alice", "coins", "seventh"), /party is full/);
  assert.equal(f.api.funds.coins, 100);
});

for (const asset of ["stars", "coins"]) test(`${asset}: lost debit response survives restart and holds reservation until one delivery`, async t => {
  const f = setup(t); await f.connect(); f.api.failAfterDebit = true;
  await assert.rejects(f.adoptions.adopt("guild", "alice", asset, "lost"), /not confirmed/);
  const pending = f.adoptions.pending("alice");
  assert.equal(f.store.collection("guild", "alice").length, 0);
  assert.ok(!f.store.market("guild").some(c => c.name === pending.name));
  assert.throws(() => f.store.adopt("guild", "alice", "stars", "local-fallback"), /online wallet/);
  await assert.rejects(f.wallet.disconnect("alice"), { code: "pending_purchase" }); // The shared guard covers every game and gift, not only adoptions.
  await f.reopen();
  await assert.rejects(f.adoptions.adopt("guild", "alice", "coins", "another"), /earlier adoption/);
  const result = await f.adoptions.retry("alice");
  assert.equal(result.character.name, pending.name);
  assert.equal(f.api.receipts.size, 1);
  assert.equal(f.store.collection("guild", "alice").length, 1);
  assert.equal(f.adoptions.pending("alice"), undefined);
});

for (const asset of ["stars", "coins"]) test(`${asset}: delivery conflict refunds once, including a lost refund response`, async t => {
  const f = setup(t); await f.connect(); f.api.failAfterDebit = true;
  await assert.rejects(f.adoptions.adopt("guild", "alice", asset, "lost"));
  const job = f.adoptions.pending("alice");
  f.store.db.prepare("UPDATE characters SET revision=revision+1 WHERE guild_id=? AND name=?").run("guild", job.name);
  f.api.failAfterRefund = true;
  await assert.rejects(f.adoptions.retry("alice"), /refund is waiting/);
  await f.reopen();
  await assert.rejects(f.adoptions.retry("alice"), /full payment was refunded/);
  assert.deepEqual(f.api.funds, { stars: 10, coins: 100 });
  assert.equal(f.api.receipts.size, 2);
  assert.equal(f.store.collection("guild", "alice").length, 0);
  assert.equal(f.adoptions.pending("alice"), undefined);
});

test("a malformed receipt cannot deliver a Touhou; valid replay recovers it", async t => {
  const f = setup(t); await f.connect(); f.api.badReceipt = true;
  await assert.rejects(f.adoptions.adopt("guild", "alice", "coins", "bad"), /not confirmed/);
  assert.equal(f.store.collection("guild", "alice").length, 0);
  await f.adoptions.retry("alice");
  assert.equal(f.api.funds.coins, 75);
  assert.equal(f.store.collection("guild", "alice").length, 1);
});

test("SQLite delivery failure retains the confirmed debit and retries the atomic ownership commit", async t => {
  const f = setup(t); await f.connect();
  f.store.db.exec("CREATE TRIGGER fail_delivery BEFORE INSERT ON receipts BEGIN SELECT RAISE(ABORT, 'disk write failed'); END;");
  await assert.rejects(f.adoptions.adopt("guild", "alice", "coins", "disk"), /disk write failed/);
  assert.equal(f.adoptions.pending("alice").state, "paid");
  assert.equal(f.store.collection("guild", "alice").length, 0);
  assert.equal(f.api.funds.coins, 75);
  f.store.db.exec("DROP TRIGGER fail_delivery");
  await f.reopen();
  await f.adoptions.retry("alice");
  assert.equal(f.store.collection("guild", "alice").length, 1);
  assert.equal(f.api.calls.filter(c => c.route === "operations").length, 1);
});

test("a party filled during payment receives a refund instead of a seventh Touhou", async t => {
  const f = setup(t); await f.connect(); f.api.failAfterDebit = true;
  await assert.rejects(f.adoptions.adopt("guild", "alice", "stars", "party-race"));
  for (const character of f.store.market("guild").filter(c => !c.owner_id).slice(0, 6)) {
    f.store.db.prepare("UPDATE characters SET owner_id='alice' WHERE guild_id='guild' AND name=?").run(character.name);
  }
  await assert.rejects(f.adoptions.retry("alice"), /full payment was refunded/);
  assert.equal(f.api.funds.stars, 10);
  assert.equal(f.store.collection("guild", "alice").length, 6);
});

test("revoking permission after an uncertain charge preserves its reservation until reconnection", async t => {
  const f = setup(t); await f.connect(); f.api.failAfterDebit = true;
  await assert.rejects(f.adoptions.adopt("guild", "alice", "stars", "revoked"));
  f.api.grants.delete(f.wallet.connection("alice").token);
  await assert.rejects(f.adoptions.retry("alice"), /not confirmed/);
  assert.ok(f.adoptions.pending("alice"));
  await f.connect();
  await f.adoptions.retry("alice");
  assert.equal(f.api.funds.stars, 9);
  assert.equal(f.api.receipts.size, 1);
});

test("consent polling backs off, persists the one-time grant and blocks cross-account recovery", async t => {
  const f = setup(t);
  const attempt = await f.wallet.begin("alice");
  await assert.rejects(f.wallet.finish("alice", attempt.generation), /Wait a few seconds/);
  f.api.now += 5000; f.api.slow = true;
  await assert.rejects(f.wallet.finish("alice", attempt.generation), /wait/i);
  f.api.slow = false; f.api.now += 5000;
  await assert.rejects(f.wallet.finish("alice", attempt.generation), /Wait a few seconds/);
  f.api.now += 5000; f.api.approved = false;
  await assert.rejects(f.wallet.finish("alice", attempt.generation), /still waiting/);
  f.api.now += 10000; f.api.approved = true; f.api.failBalance = true;
  await assert.rejects(f.wallet.finish("alice", attempt.generation), /could not be reached/);
  const polls = f.api.calls.filter(c => c.route === "token").length;
  await f.reopen(); f.api.failBalance = false;
  await f.wallet.finish("alice", attempt.generation);
  assert.equal(f.api.calls.filter(c => c.route === "token").length, polls);
  f.api.failAfterDebit = true;
  await assert.rejects(f.adoptions.adopt("guild", "alice", "stars", "pending"));
  f.api.account = "account-b";
  await assert.rejects(f.connect(), /same Little Log account/);
  assert.equal(f.wallet.connection("alice").account_id, "account-a");
  f.api.account = "account-a"; await f.connect();
  await f.adoptions.retry("alice");
  await f.wallet.disconnect("alice");
  assert.equal(f.wallet.connection("alice"), undefined);
});

test("credentials stay pinned to their API and concurrent purchases cannot spend twice", async t => {
  const f = setup(t); await f.connect();
  const original = f.client.config.baseUrl;
  f.client.config.baseUrl = "https://other.example/api/";
  await assert.rejects(f.wallet.balance("alice"), /different API settings/);
  f.client.config.baseUrl = original;
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  f.api.delayDebit = async () => { entered(); await new Promise(resolve => { release = resolve; }); };
  const purchase = f.adoptions.adopt("guild", "alice", "coins", "slow");
  await started;
  await assert.rejects(f.adoptions.adopt("guild", "alice", "stars", "parallel"), /Another wallet action/);
  release(); await purchase;
  assert.equal(f.api.receipts.size, 1);
});

function interaction(action, values = {}, extra = {}) {
  return { id: `click-${action}`, guildId: "guild", channelId: "channel", guild: {}, user: { id: "alice" }, commandName: "touhou",
    isChatInputCommand: () => true, isButton: () => false,
    options: { getSubcommand: () => action, getUser: key => values[key] || null, getString: key => values[key] || null },
    async deferReply(options) { this.flags = options?.flags; this.deferred = true; },
    async deferUpdate() { this.deferred = true; }, async editReply(body) { this.output = body; }, async reply(body) { this.output = body; }, ...extra };
}

test("Discord slash, prefix and clickable adoption all use online balances; balance replies are private", async t => {
  const f = setup(t); await f.connect();
  const handlers = createTouhouHandlers(f.store, { wallet: f.wallet, adoptions: f.adoptions });
  const slash = interaction("adopt", { payment: "stars" });
  await handlers.handleInteraction(slash);
  assert.match(slash.output.embeds[0].toJSON().description, /1 star/);
  const prefix = { id: "prefix", guildId: "guild", author: { id: "alice" }, content: "!touhou adopt coins", async reply(body) { this.output = body; } };
  await handlers.handleMessage(prefix);
  const menu = interaction("menu"); await handlers.handleInteraction(menu);
  const buttons = menu.output.components.flatMap(r => r.toJSON().components);
  const balance = interaction("button", {}, { isChatInputCommand: () => false, isButton: () => true, customId: buttons.find(b => b.custom_id.endsWith(":online-balance")).custom_id });
  await handlers.handleInteraction(balance);
  assert.equal(balance.flags, 64);
  assert.match(balance.output.content, /9 stars.*75 LiDollcoins/);
  const click = interaction("button", {}, { isChatInputCommand: () => false, isButton: () => true, customId: buttons.find(b => b.custom_id.endsWith(":adopt-stars")).custom_id });
  await handlers.handleInteraction(click);
  assert.deepEqual(f.api.funds, { stars: 8, coins: 75 });
  const read = interaction("wallet"); await handlers.handleInteraction(read);
  assert.equal(read.flags, 64); assert.match(read.output.content, /8 stars.*75 LiDollcoins/);
  const other = interaction("wallet", { user: { id: "bob" } }); await handlers.handleInteraction(other);
  assert.match(other.output.content, /private/);
  assert.deepEqual(f.store.wallet("guild", "alice"), { stars: 0, coins: 0 });
});

test("legacy wallet approval buttons belong to their Discord user; unlink revokes wallet access", async t => {
  const f = setup(t); let unlinked = false;
  const identities = { get: () => ({ username: "alice" }), unlink: () => { unlinked = true; } };
  const handler = createIdentityHandler(identities, {}, f.wallet);
  const connect = interaction("connect", {}, { commandName: "lidollid" });
  connect.options.getSubcommandGroup = () => "wallet";
  const { handleWalletInteraction } = await import("../src/wallet/commands.js");
  await handleWalletInteraction(connect, f.wallet, identities);
  assert.equal(connect.flags, 64);
  const customId = connect.output.components[0].toJSON().components[0].custom_id;
  const thief = interaction("button", {}, { customId, isChatInputCommand: () => false, user: { id: "bob" } });
  await handler(thief); assert.match(thief.output.content, /own connection/);
  f.api.now += 5000;
  const approve = interaction("button", {}, { customId, isChatInputCommand: () => false });
  await handler(approve); assert.match(approve.output.content, /Wallet connected/);
  const unlink = interaction("unlink", {}, { commandName: "lidollid" });
  await handler(unlink);
  assert.equal(unlinked, true); assert.equal(f.wallet.connection("alice"), undefined);
  assert.equal(f.api.grants.size, 0);
});

test("wallet config rejects insecure production URLs and provider errors never expose response text", async () => {
  assert.equal(walletConfig({}), null);
  for (const url of ["http://lidoll.dev/api/", "https://user:secret@lidoll.dev/api/", "https://lidoll.dev/api/?token=secret"]) {
    assert.throws(() => walletConfig({ LIDOLLCOIN_ENABLED: "true", NODE_ENV: "production", LIDOLLCOIN_API_URL: url }));
  }
  const client = new WalletClient(walletConfig({ LIDOLLCOIN_ENABLED: "true" }), async () => new Response(JSON.stringify({ error: "unknown", error_description: "PRIVATE SECRET" }), { status: 401 }));
  await assert.rejects(client.balance("secret"), error => error instanceof WalletError && !error.message.includes("PRIVATE"));
});

test("wallet diagnostics distinguish DNS, redirects and proxy HTML without exposing secrets", async () => {
  const config = walletConfig({ LIDOLLCOIN_ENABLED: "true" });
  const dns = new WalletClient(config, async () => { throw new Error("SECRET URL", { cause: Object.assign(new Error("SECRET TOKEN"), { code: "ENOTFOUND" }) }); });
  await assert.rejects(dns.begin(), error => error.message.includes("ENOTFOUND") && !error.message.includes("SECRET"));
  const redirect = new WalletClient(config, async () => new Response(null, { status: 302, headers: { Location: "https://example.com/SECRET" } }));
  await assert.rejects(redirect.begin(), error => error.message.includes("HTTP 302") && !error.message.includes("SECRET"));
  for (const status of [200, 403, 502]) {
    const html = new WalletClient(config, async () => new Response("<html>SECRET</html>", { status }));
    await assert.rejects(html.begin(), error => error.message.includes(`HTTP ${status}`) && !error.message.includes("SECRET") && error.status === 0);
  }
});

test("aggregate socket and permission failures expose only allowlisted diagnostic codes", async () => {
  const config = walletConfig({ LIDOLLCOIN_ENABLED: "true" });
  for (const code of ["ECONNREFUSED", "ETIMEDOUT", "EACCES", "EPERM", "EPROTO", "ERR_SSL_WRONG_VERSION_NUMBER", "UND_ERR_SOCKET"]) {
    const client = new WalletClient(config, async () => {
      const aggregate = new AggregateError([Object.assign(new Error("PRIVATE TOKEN AND ADDRESS"), { code })], "PRIVATE URL");
      throw new TypeError("fetch failed", { cause: aggregate });
    });
    await assert.rejects(client.begin(), error => error.message.includes(`(${code})`) && !error.message.includes("PRIVATE"));
  }
  const cycle = new Error("PRIVATE"); cycle.cause = cycle; cycle.errors = [cycle];
  const client = new WalletClient(config, async () => { throw cycle; });
  await assert.rejects(client.begin(), error => error.message.includes("NETWORK_ERROR") && !error.message.includes("PRIVATE"));
});

test("the production LAN wallet uses the private API and the public HTTPS approval page", async () => {
  const config = walletConfig({ NODE_ENV: "production", LIDOLLCOIN_ENABLED: "true",
    LIDOLLCOIN_API_URL: "http://10.1.1.23:4173/tracker/api/lidollcoin/v1/", LIDOLLCOIN_PUBLIC_ORIGIN: "https://lidoll.dev" });
  const api = provider();
  const client = new WalletClient(config, (url, options) => {
    assert.equal(url.origin, "http://10.1.1.23:4173");
    return api.fetch(url, options);
  });
  assert.equal((await client.begin()).verification_uri, "https://lidoll.dev/tracker/coins/");
  for (const uri of ["http://10.1.1.23:4173/tracker/coins/", "https://other.example/tracker/coins/"]) {
    const wrong = new WalletClient(config, async () => new Response(JSON.stringify({ device_code: "x".repeat(43),
      user_code: "ABCDEF-123456", expires_in: 600, interval: 5, verification_uri: uri })));
    await assert.rejects(wrong.begin(), /approval response was invalid/);
  }
  for (const host of ["127.0.0.1", "10.1.1.23", "172.16.0.1", "172.31.255.254", "192.168.1.1"]) {
    assert.ok(walletConfig({ NODE_ENV: "production", LIDOLLCOIN_ENABLED: "true", LIDOLLCOIN_API_URL: `http://${host}:4173/tracker/api/lidollcoin/v1/` }));
  }
  for (const host of ["68.116.17.162", "172.15.0.1", "172.32.0.1", "192.169.1.1", "10.1.1.23.example.com"]) {
    assert.throws(() => walletConfig({ NODE_ENV: "production", LIDOLLCOIN_ENABLED: "true", LIDOLLCOIN_API_URL: `http://${host}:4173/tracker/api/lidollcoin/v1/` }));
  }
  assert.throws(() => walletConfig({ NODE_ENV: "production", LIDOLLCOIN_ENABLED: "true", LIDOLLCOIN_PUBLIC_ORIGIN: "http://10.1.1.23:4173" }));
});

test("wallet checker uses a token-free GET and reports registration without starting consent", async t => {
  const folder = mkdtempSync(path.join(os.tmpdir(), "mommybot-wallet-check-"));
  let providerError = "invalid_token";
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method, path: request.url, token: request.headers.authorization });
    response.writeHead(401, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: providerError, error_description: "PRIVATE PROVIDER BODY" }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); rmSync(folder, { recursive: true, force: true }); });
  const configFile = path.join(folder, "wallet.env");
  writeFileSync(configFile, `LIDOLLCOIN_ENABLED=true\nLIDOLLCOIN_API_URL=http://127.0.0.1:${server.address().port}/tracker/api/lidollcoin/v1/\nDISCORD_TOKEN=PRIVATE_CONFIG_SECRET\n`);
  const command = () => promisify(execFile)(process.execPath, [fileURLToPath(new URL("../scripts/check-wallet.mjs", import.meta.url)), configFile], { env: { ...process.env, NODE_ENV: "test" } });
  const success = await command();
  assert.match(success.stdout, /PASS:.*recognizes this app/);
  assert.doesNotMatch(success.stdout + success.stderr, /PRIVATE/);
  providerError = "invalid_client";
  await assert.rejects(command(), error => error.code === 1 && /not registered/.test(error.stderr) && !/PRIVATE/.test(error.stdout + error.stderr));
  assert.deepEqual(requests, Array.from({ length: 2 }, () => ({ method: "GET", path: "/tracker/api/lidollcoin/v1/wallet?client_id=lidollbot", token: undefined })));
});
