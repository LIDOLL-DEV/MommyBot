import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DiaperStore } from "../src/gacha/store.js";
import { gachaConfig, loadDiaperCatalog, tiers } from "../src/gacha/catalog.js";
import { GachaSessions } from "../src/gacha/sessions.js";
import { createGachaWeb } from "../src/gacha/web.js";
import { WalletService } from "../src/wallet/service.js";
import { WalletError } from "../src/wallet/client.js";
import { IdentityStore } from "../src/auth/store.js";
import { createAuthServer } from "../src/auth/server.js";
import { OnlineAdoptions } from "../src/wallet/adoptions.js";
import { TouhouStore } from "../src/touhou/store.js";
import { handleWalletInteraction } from "../src/wallet/commands.js";
import { createIdentityHandler } from "../src/auth/index.js";

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "diaper-gacha-test-"));
  const f = { funds: { alice: 500, bob: 500 }, ledger: new Map(), lose: null, paused: false, hold: null, now: 1000 };
  f.client = { config: { baseUrl: "https://wallet.example/api/", clientId: "lidollbot" },
    balance: async user => ({ accountId: `wallet-${user}`, coins: f.funds[user], stars: 7 }), revoke: async () => {},
    operation: async (user, body) => {
      assert.equal(body.asset, "coins");
      const key = `${user}:${body.request_id}`, existing = f.ledger.get(key);
      if (existing) { assert.deepEqual(existing.body, body); return existing.receipt; }
      if (f.paused) throw new WalletError("daily_limit", "Daily limit; retry later.", 429);
      const delta = body.kind === "credit" ? body.amount : -body.amount;
      if (f.funds[user] + delta < 0) throw new WalletError("insufficient_funds", "Not enough coins.", 409);
      f.funds[user] += delta;
      const receipt = { ...body, currency: "LiDollCoin", balance: f.funds[user] };
      f.ledger.set(key, { body, receipt });
      if (f.hold) await f.hold();
      if (f.lose === body.kind) throw new WalletError("unavailable", "Response lost.");
      return receipt;
    } };
  const open = seed => {
    f.wallet = new WalletService(join(directory, "wallet.db"), f.client, { now: () => f.now });
    f.game = new DiaperStore(join(directory, "diapers.db"), loadDiaperCatalog(), f.wallet, { enabled: true, price: 25 }, () => 0);
    if (seed) for (const user of ["alice", "bob"]) f.wallet.db.prepare("INSERT INTO online_wallets VALUES (?,?,?,?,?,?)").run(user, user, 999999999, `wallet-${user}`, f.client.config.baseUrl, f.client.config.clientId);
  };
  open(true);
  f.act = (action, design, user = "alice", request = randomUUID(), amount = null) => f.game.act(user, action, design, request, amount);
  f.reopen = async () => { await f.wallet.close(); f.game.close(); open(false); };
  t.after(async () => { await f.wallet.close(); f.game.close(); rmSync(directory, { recursive: true, force: true }); });
  return f;
} // A durable local game and fake idempotent wallet exercise failures without touching any real balances.

test("catalog contains reviewed art, exact tier odds, and bounded coin configuration", () => {
  const catalog = loadDiaperCatalog();
  assert.equal(catalog.length, 58);
  assert.equal(new Set(catalog.map(item => item.image)).size, catalog.length);
  assert.equal(Object.values(tiers).reduce((sum, tier) => sum + tier.chance, 0), 100);
  assert.equal(catalog.find(item => item.id === "princess-ribbon").rarity, "legendary");
  assert.equal(gachaConfig({ LIDOLLID_ENABLED: "true", LIDOLLCOIN_ENABLED: "true" }).price, 3);
  assert.throws(() => gachaConfig({ DIAPER_GACHA_ENABLED: "true" }), /requires/);
  assert.throws(() => gachaConfig({ DIAPER_GACHA_ROLL_PRICE: "-1" }), /whole number/);
});

test("roll, sell, shared bank buy and seller buyback move exactly one copy and online coins", async t => {
  const f = fixture(t), request = randomUUID();
  const first = await f.act("roll", null, "alice", request);
  assert.equal(f.funds.alice, 475);
  assert.deepEqual(await f.act("roll", null, "alice", request), first);
  assert.equal(f.funds.alice, 475); assert.equal(f.game.snapshot("alice").owned[0].quantity, 1);
  await f.act("sell", first.item.id);
  assert.equal(f.funds.alice, 480); assert.equal(f.game.snapshot("alice").owned.length, 0);
  assert.equal(f.game.snapshot("bob").bank[0].quantity, 1);
  await f.act("buy", first.item.id, "bob"); assert.equal(f.funds.bob, 490);
  await f.act("sell", first.item.id, "bob");
  await f.act("buy", first.item.id, "bob"); assert.equal(f.funds.bob, 485);
  assert.equal(f.game.snapshot("bob").owned[0].quantity, 1); assert.equal(f.game.snapshot("alice").bank.length, 0);
  assert.equal(f.game.snapshot("alice").history.length, 2);
  await f.reopen(); assert.equal(f.game.snapshot("bob").owned[0].quantity, 1);
});

test("tier selection uses published boundaries and duplicates are retained", async t => {
  const f = fixture(t);
  for (const [draw, rarity] of [[0,"common"],[54,"common"],[55,"uncommon"],[79,"uncommon"],[80,"rare"],[93,"rare"],[94,"epic"],[98,"epic"],[99,"legendary"]]) {
    let first = true; f.game.draw = max => { if (first) { first = false; return draw; } return max - 1; };
    assert.equal(f.game.pick().rarity, rarity);
  }
  f.game.draw = () => 0;
  await f.act("roll"); await f.act("roll");
  assert.equal(f.game.snapshot("alice").owned[0].quantity, 2);
  assert.equal(f.game.snapshot("alice").owned[0].available, 2);
});

test("the default roll costs three LiDollcoins and never consumes stars", async t => {
  const f = fixture(t); f.game.config = gachaConfig({ LIDOLLID_ENABLED: "true", LIDOLLCOIN_ENABLED: "true" });
  const result = await f.act("roll", null, "alice", randomUUID(), 3);
  assert.equal(result.amount, 3); assert.equal(f.funds.alice, 497);
  assert.equal((await f.wallet.balance("alice")).stars, 7);
  assert.equal(f.game.snapshot("alice").rollPrice, 3);
});

test("bank stock lowers quotes, stale quotes are refused, and buying then selling cannot profit", async t => {
  const f = fixture(t); f.game.config.price = 3;
  f.game.draw = max => max === 100 ? 99 : 0;
  const prize = await f.act("roll"), scarce = f.game.prices(prize.item);
  for (let index = 0; index < 20; index++) f.game.db.prepare("INSERT INTO diaper_items VALUES (?,?,NULL,NULL,?)").run(randomUUID(), prize.item.id, Date.now());
  const plentiful = f.game.prices(prize.item);
  assert.ok(plentiful.buy < scarce.buy); assert.ok(plentiful.sell < scarce.sell);
  assert.equal(plentiful.stock, 20);
  await assert.rejects(f.act("sell", prize.item.id, "alice", randomUUID(), scarce.sell), /price changed/);
  assert.equal(f.funds.alice, 497);
  const initial = f.funds.bob;
  await f.act("buy", prize.item.id, "bob", randomUUID(), plentiful.buy);
  const sellQuote = f.game.prices(prize.item).sell;
  await f.act("sell", prize.item.id, "bob", randomUUID(), sellQuote);
  assert.ok(f.funds.bob < initial); assert.equal(f.game.prices(prize.item).stock, 20);
  assert.equal(f.game.snapshot("bob").owned.length, 0);
});

test("a pending bank trade keeps its quoted price even if stock changes before recovery", async t => {
  const f = fixture(t); f.game.config.price = 3; f.game.draw = max => max === 100 ? 99 : 0;
  const prize = await f.act("roll"), quote = f.game.prices(prize.item).sell;
  f.lose = "credit";
  await assert.rejects(f.act("sell", prize.item.id, "alice", randomUUID(), quote), /Response lost/);
  for (let index = 0; index < 20; index++) f.game.db.prepare("INSERT INTO diaper_items VALUES (?,?,NULL,NULL,?)").run(randomUUID(), prize.item.id, Date.now());
  f.lose = null; const result = await f.game.retry("alice");
  assert.equal(result.amount, quote); assert.equal(f.funds.alice, 497 + quote); assert.equal(f.ledger.size, 2);
});

test("lost debit survives restart without redrawing or debiting twice and blocks unlink", async t => {
  const f = fixture(t); f.lose = "debit";
  await assert.rejects(f.act("roll"), /Response lost/);
  const selected = f.game.pending("alice").design;
  assert.equal(f.game.snapshot("alice").owned.length, 0);
  assert.deepEqual(f.game.snapshot("alice").pending, { action: "roll", amount: 25 });
  await assert.rejects(f.wallet.disconnect("alice"), /pending/);
  await assert.rejects(f.act("roll"), /pending/);
  await f.reopen(); f.lose = null; f.game.config.enabled = false;
  f.game.draw = () => { throw new Error("Must not draw during recovery"); };
  const result = await f.game.retry("alice");
  assert.equal(result.item.id, selected); assert.equal(f.funds.alice, 475); assert.equal(f.ledger.size, 1);
  assert.equal(f.game.snapshot("alice").owned[0].quantity, 1);
  await assert.rejects(f.act("roll"), /paused/);
});

test("a lost sale credit reserves the copy until replay confirms one credit and one bank deposit", async t => {
  const f = fixture(t), prize = await f.act("roll"); f.lose = "credit";
  await assert.rejects(f.act("sell", prize.item.id), /Response lost/);
  assert.equal(f.game.snapshot("alice").owned[0].available, 0);
  assert.equal(f.game.snapshot("bob").bank.length, 0);
  await f.reopen(); f.lose = null; await f.game.retry("alice");
  assert.equal(f.funds.alice, 480); assert.equal(f.game.snapshot("bob").bank[0].quantity, 1);
});

test("only one buyer can reserve the last bank copy while a debit is in flight", async t => {
  const f = fixture(t), prize = await f.act("roll"); await f.act("sell", prize.item.id);
  let release; f.hold = () => new Promise(resolve => { release = resolve; });
  const purchase = f.act("buy", prize.item.id);
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(f.act("buy", prize.item.id, "bob"), /last available/);
  assert.equal(f.funds.bob, 500);
  release(); f.hold = null; await purchase;
  assert.equal(f.game.snapshot("alice").owned[0].quantity, 1);
});

test("ownership, price changes, insufficient funds and request reuse cannot mint copies", async t => {
  const f = fixture(t), prize = await f.act("roll");
  await assert.rejects(f.act("sell", prize.item.id, "bob"), /no available copy/);
  await assert.rejects(f.act("sell", prize.item.id, "alice", randomUUID(), 500), /price changed/);
  f.funds.bob = 0;
  await assert.rejects(f.act("roll", null, "bob"), /Not enough/);
  assert.equal(f.game.pending("bob"), undefined); assert.equal(f.game.snapshot("bob").owned.length, 0);
  const request = randomUUID(); await f.act("sell", prize.item.id, "alice", request);
  await assert.rejects(f.act("buy", prize.item.id, "alice", request), /another action/);
  await assert.rejects(f.act("buy", prize.item.id, "bob"), /Not enough/);
  assert.equal(f.game.snapshot("alice").bank[0].quantity, 1);
});

test("failed item delivery retains paid job and recovers after storage is repaired", async t => {
  const f = fixture(t);
  f.game.db.exec("CREATE TRIGGER fail_delivery BEFORE INSERT ON diaper_items BEGIN SELECT RAISE(ABORT, 'test failure'); END");
  await assert.rejects(f.act("roll"), /test failure/);
  assert.equal(f.game.pending("alice").state, "paid");
  f.game.db.exec("DROP TRIGGER fail_delivery"); await f.game.retry("alice");
  assert.equal(f.funds.alice, 475); assert.equal(f.ledger.size, 1); assert.equal(f.game.snapshot("alice").owned[0].quantity, 1);
});

test("pending payments pin the original account and survive an uncertain rejection", async t => {
  const f = fixture(t); f.lose = "debit";
  await assert.rejects(f.act("roll"), /Response lost/);
  f.wallet.db.prepare("UPDATE online_wallets SET account_id='wrong' WHERE discord_id='alice'").run();
  await assert.rejects(f.game.retry("alice"), /original wallet/);
  f.wallet.db.prepare("UPDATE online_wallets SET account_id='wallet-alice' WHERE discord_id='alice'").run();
  const operation = f.client.operation;
  f.client.operation = async () => { throw new WalletError("request_failed", "Temporary rejection", 403); };
  await assert.rejects(f.game.retry("alice"), /Temporary rejection/);
  assert.ok(f.game.pending("alice"));
  f.client.operation = operation; f.lose = null; await f.game.retry("alice");
  assert.equal(f.funds.alice, 475);
});

test("adoption initialization preserves gacha reservations and Discord wallet retry recovers them", async t => {
  const f = fixture(t), trader = new TouhouStore(":memory:", [{ name: "Reimu", filename: "Reimu.png", baseRarity: 9 }]);
  t.after(() => trader.close()); const adoptions = new OnlineAdoptions(trader, f.wallet);
  f.lose = "debit"; await assert.rejects(f.act("roll"));
  await assert.rejects(adoptions.adopt("guild", "alice", "coins", "adopt"), /earlier adoption or payment/);
  f.lose = null; let response;
  await handleWalletInteraction({ user: { id: "alice" }, commandName: "lidollid", isChatInputCommand: () => true,
    options: { getSubcommandGroup: () => "wallet", getSubcommand: () => "retry" }, deferReply: async () => {}, editReply: async body => { response = body; } }, f.wallet, null);
  assert.match(response.content, /Diaper roll completed/); assert.equal(f.funds.alice, 475);
});

function identityFixture(t, game) {
  const identities = new IdentityStore(":memory:"); t.after(() => identities.close());
  const link = user => {
    const ticket = identities.begin(user), browser = identities.start(ticket, { state: "s", nonce: "n", verifier: "v" });
    identities.confirm(user, identities.verified(identities.take(browser), { issuer: "https://auth.example", subject: user, username: `${user}<script>` }));
  };
  link("alice"); link("bob");
  let now = 1000;
  const sessions = new GachaSessions(game.db, identities, () => now);
  return { identities, sessions, link, advance: amount => { now += amount; } };
}

test("Discord unlink revokes atelier sessions without deleting collectibles", async t => {
  const f = fixture(t), s = identityFixture(t, f.game); await f.act("roll");
  const token = s.sessions.open(s.sessions.begin("alice"));
  const handler = createIdentityHandler(s.identities, { origin: "https://bot.example" }, f.wallet,
    { handleInteraction: async () => false, revoke: user => s.sessions.revoke(user) });
  await handler({ user: { id: "alice" }, commandName: "lidollid", isChatInputCommand: () => true,
    options: { getSubcommand: () => "unlink" }, deferReply: async () => {}, editReply: async () => {} });
  assert.equal(s.sessions.get(token), null); assert.equal(s.identities.get("alice"), undefined);
  assert.equal(f.game.snapshot("alice").owned[0].quantity, 1); assert.equal(f.wallet.connection("alice"), undefined);
});

test("game tickets survive previews, are single use, expire, and sessions follow unlink/relink", t => {
  const f = fixture(t), s = identityFixture(t, f.game);
  const ticket = s.sessions.begin("alice"); assert.ok(s.sessions.ticket(ticket)); assert.ok(s.sessions.ticket(ticket));
  const token = s.sessions.open(ticket); assert.throws(() => s.sessions.open(ticket), /expired or was used/);
  assert.equal(s.sessions.get(token).user_id, "alice");
  s.sessions.revoke("alice"); s.identities.unlink("alice"); s.link("alice"); assert.equal(s.sessions.get(token), null);
  const expired = s.sessions.begin("alice"); s.advance(600001); assert.equal(s.sessions.ticket(expired), null);
  const current = s.sessions.open(s.sessions.begin("alice")); s.advance(8 * 3600000 + 1); assert.equal(s.sessions.get(current), null);
});

test("browser handoff, CSRF, private collection, static path allowlist and logout work through the real HTTP server", async t => {
  const f = fixture(t), s = identityFixture(t, f.game), config = { origin: "http://127.0.0.1", issuer: "https://auth.example" };
  const server = createAuthServer(config, s.identities, {}, f.wallet, createGachaWeb(config, f.game, s.sessions));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); config.origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const fetchAt = (path, options) => fetch(`${config.origin}/diapers/${path}`, options);
  assert.equal((await fetchAt("api/state")).status, 401);
  const ticket = s.sessions.begin("alice"), landing = await fetchAt(`open?ticket=${ticket}`), html = await landing.text();
  assert.equal(landing.headers.get("referrer-policy"), "origin");
  const formCookie = landing.headers.getSetCookie()[0].split(";")[0], csrf = html.match(/name="csrf" value="([a-f0-9]+)"/)[1];
  assert.ok(s.sessions.ticket(ticket));
  const opened = await fetchAt("open", { method: "POST", redirect: "manual", headers: { Origin: config.origin, Cookie: formCookie, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ticket, csrf }) });
  assert.equal(opened.status, 303); assert.equal(opened.headers.get("location"), "/diapers/");
  const sessionCookie = opened.headers.getSetCookie()[0].split(";")[0];
  assert.match(opened.headers.getSetCookie()[0], /HttpOnly; SameSite=Lax/);
  let state = await (await fetchAt("api/state", { headers: { Cookie: sessionCookie } })).json();
  assert.equal(state.coins, 500); assert.equal(state.username, "alice<script>");
  assert.equal(state.catalog.length, 58); assert.equal(state.token, undefined); assert.equal(state.user_id, undefined);
  const action = { action: "roll", amount: 25, request: randomUUID() };
  const headers = { Origin: config.origin, Cookie: sessionCookie, "Content-Type": "application/json", "X-CSRF-Token": state.csrf };
  assert.equal((await fetchAt("api/action", { method: "POST", headers: { ...headers, Origin: "https://evil.example" }, body: JSON.stringify(action) })).status, 403);
  assert.equal((await fetchAt("api/action", { method: "POST", headers: { ...headers, "X-CSRF-Token": "wrong" }, body: JSON.stringify(action) })).status, 403);
  assert.equal(f.ledger.size, 0);
  const result = await (await fetchAt("api/action", { method: "POST", headers, body: JSON.stringify({ ...action, user_id: "bob" }) })).json();
  assert.equal(result.action, "roll"); assert.equal(f.funds.alice, 475); assert.equal(f.funds.bob, 500);
  state = await (await fetchAt("api/state", { headers: { Cookie: sessionCookie } })).json(); assert.equal(state.owned[0].quantity, 1);
  assert.equal((await fetchAt("art/catalog.json")).status, 404);
  assert.equal((await fetchAt("art/diaper10a.png")).headers.get("content-type"), "image/png");
  const app = await fetchAt(""); assert.match(app.headers.get("content-security-policy"), /script-src 'self'/);
  assert.doesNotMatch(await app.text(), /alice<script>/);
  await fetchAt("api/logout", { method: "POST", headers, body: "{}" });
  assert.equal((await fetchAt("api/state", { headers: { Cookie: sessionCookie } })).status, 401);
});
