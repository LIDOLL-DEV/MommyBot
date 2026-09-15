import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { BallDropStore, BallDropError } from "../src/balldrop/store.js";
import { BETS, OBSTACLES, BLAST_DIRECTIONS, ballPath, obstacleDrop, payout } from "../src/balldrop/rules.js";
import { WalletService } from "../src/wallet/service.js";
import { WalletError } from "../src/wallet/client.js";
import { IdentityStore } from "../src/auth/store.js";
import { GameSessions } from "../src/games/sessions.js";
import { createBallDropWeb } from "../src/balldrop/web.js";
import { createBallDropCommands } from "../src/balldrop/index.js";
import { createAuthServer } from "../src/auth/server.js";
import { createIdentityHandler } from "../src/auth/index.js";
import { runWalletAction } from "../src/wallet/commands.js";
import { createGameLogin } from "../src/games/login.js";

function fixture(t, { obstacles = [] } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "prism-drop-"));
  const f = { funds: { alice: 5000, bob: 5000 }, ledger: new Map(), lose: null, rolls: 0 };
  f.client = { config: { baseUrl: "https://wallet.example/", clientId: "lidollbot" }, revoke: async () => {},
    balance: async user => ({ accountId: user, coins: f.funds[user], stars: 5 }),
    operation: async (user, input) => {
      assert.equal(input.asset, "coins"); assert.ok(Number.isSafeInteger(input.amount) && input.amount > 0);
      if (f.reject) throw f.reject;
      await f.hold?.();
      const key = `${user}:${input.request_id}`;
      let receipt = f.ledger.get(key);
      if (!receipt) {
        const delta = input.kind === "credit" ? input.amount : -input.amount;
        if (f.funds[user] + delta < 0) throw new WalletError("funds", "Not enough coins.", 409);
        f.funds[user] += delta;
        receipt = { ...input, currency: "LiDollCoin", balance: f.funds[user] }; f.ledger.set(key, receipt);
        if (f.lose === input.kind) throw new WalletError("lost", "Response lost.");
      }
      return f.badReceipt ? { ...receipt, ...f.badReceipt } : receipt;
    } };
  const open = seed => {
    f.wallet = new WalletService(join(directory, "wallet.db"), f.client);
    f.game = new BallDropStore(join(directory, "game.db"), f.wallet, { enabled: true }, { obstacles, draw: () => { f.rolls++; return 0; } });
    if (seed) for (const user of ["alice", "bob"]) f.wallet.db.prepare("INSERT INTO online_wallets VALUES (?,?,?,?,?,?)").run(user, user, Date.now() + 86400000, user, f.client.config.baseUrl, f.client.config.clientId);
  };
  open(true);
  f.act = (extra = {}, user = "alice") => f.game.act(user, { action: "drop", request: randomUUID(), bet: 5, guess: 2, ...extra });
  f.reopen = async () => { await f.wallet.close(); f.game.close(); open(false); };
  t.after(async () => { await f.wallet.close(); f.game.close(); rmSync(directory, { recursive: true, force: true }); });
  return f;
} // Test real durable game/wallet storage with idempotent fake coins and deterministic bounce choices.

test("all four entry pins, 20 bounces and reflecting walls keep the route on a 10-wide field", () => {
  for (let entry = 0; entry < 4; entry++) for (const direction of [0, 1]) {
    let first = true;
    const route = ballPath(max => { const next = first ? entry : direction; first = false; assert.ok(next < max); return next; });
    assert.equal(route[0], entry + 4); assert.equal(route.length, 21);
    route.forEach((column, index) => { assert.ok(column >= 1 && column <= 10); if (index) assert.equal(Math.abs(column - route[index - 1]), 1); });
  }
});

test("bombs launch in every compass direction, fire only once, and gravity always reaches a pocket", () => {
  for (let direction = 0; direction < 8; direction++) {
    const layout = [{ row: 1, column: 3, type: "bomb" }];
    const drop = obstacleDrop(max => max === 8 ? direction : 0, layout);
    const at = drop.trajectory.findIndex(point => point.hit === "bomb"), next = drop.trajectory[at + 1];
    const [dx, dy] = BLAST_DIRECTIONS[direction];
    assert.equal(next.column, 3 + dx * 2); assert.equal(next.row, Math.abs(1 + dy * 2));
    assert.equal(drop.trajectory.filter(point => point.hit === "bomb").length, 1);
    assert.equal(drop.trajectory.at(-1).row, 20);
  }
  const upward = obstacleDrop(() => 0, [{ row: 3, column: 1, type: "bomb" }]);
  const index = upward.trajectory.findIndex(point => point.hit === "bomb");
  assert.ok(upward.trajectory[index + 1].row < upward.trajectory[index].row);
  assert.ok(upward.trajectory.filter(point => point.row === 3 && point.column === 1).length > 1);
  const downward = obstacleDrop(max => max === 8 ? 6 : 0, [{ row: 19, column: 1, type: "bomb" }]);
  const bottom = downward.trajectory.findIndex(point => point.hit === "bomb");
  assert.deepEqual(downward.trajectory[bottom + 1], { row: 20, column: 1 });
  for (let seed = 1; seed <= 150; seed++) {
    let state = seed;
    const drop = obstacleDrop(max => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % max; });
    assert.ok(drop.trajectory.length <= 20 + 4 * OBSTACLES.filter(peg => peg.type === "bomb").length + 1);
    assert.equal(drop.trajectory.at(-1).row, 20);
    for (const point of drop.trajectory) assert.ok(point.column >= 1 && point.column <= 10 && point.row >= 0 && point.row <= 20);
  }
});

test("blocked pegs shove two columns sideways and ignore client-invented obstacles", async t => {
  const layout = [{ row: 1, column: 3, type: "block" }], drop = obstacleDrop(() => 0, layout);
  assert.equal(drop.trajectory[1].hit, "block"); assert.deepEqual(drop.trajectory[2], { row: 2, column: 1 });
  const f = fixture(t, { obstacles: layout });
  const result = await f.act({ obstacles: [{ row: 1, column: 3, type: "coin" }], bonus: 99999 });
  assert.deepEqual(result.round.obstacles, layout); assert.equal(result.round.bonus, 0);
  assert.throws(() => obstacleDrop(() => 0, [...layout, ...layout]), /Invalid obstacle/);
});

test("coin pegs award 1-5 each once even when a bomb revisits a collected peg", () => {
  const layout = [{ row: 1, column: 3, type: "coin" }, { row: 3, column: 1, type: "bomb" }];
  for (const reward of [1, 2, 3, 4, 5]) {
    const drop = obstacleDrop(max => max === 5 ? reward - 1 : 0, layout);
    assert.equal(drop.bonus, reward);
    assert.ok(drop.trajectory.filter(point => point.row === 1 && point.column === 3).length > 1);
    assert.equal(drop.trajectory.filter(point => point.hit === "coin").length, 1);
    assert.equal(drop.trajectory.find(point => point.hit === "coin").coins, reward);
  }
});

test("peg bonuses pay on misses and are journaled together with winning returns", async t => {
  for (const guess of [2, 10]) {
    const f = fixture(t, { obstacles: OBSTACLES }), expected = obstacleDrop(() => 0);
    const result = await f.act({ guess });
    assert.equal(result.round.basePayout, payout(5, guess, expected.path.at(-1)));
    assert.equal(result.round.bonus, expected.bonus); assert.ok(result.round.bonus > 0);
    assert.equal(f.funds.alice, 5000 - 5 + result.round.basePayout + result.round.bonus);
    assert.equal(f.ledger.size, 2, "One combined credit pays the landing return plus all coin pegs");
  }
});

test("obstacles, bomb directions and coin rolls survive restart and changed level layouts", async t => {
  const f = fixture(t, { obstacles: OBSTACLES }); f.lose = "credit";
  await assert.rejects(f.act(), /payout is pending/);
  const before = f.game.snapshot("alice").round, funds = f.funds.alice, rolls = f.rolls;
  assert.ok(before.trajectory.some(point => point.hit === "coin")); assert.ok(before.trajectory.some(point => point.hit === "bomb"));
  await f.reopen(); f.game.obstacles = [];
  const result = await f.game.retry("alice");
  assert.deepEqual(result.round.trajectory, before.trajectory); assert.deepEqual(result.round.obstacles, before.obstacles);
  assert.equal(result.round.bonus, before.bonus); assert.equal(f.rolls, rolls); assert.equal(f.funds.alice, funds); assert.equal(f.ledger.size, 2);
});

test("legacy database migration leaves an unpaid original drop and its payout untouched", async t => {
  const f = fixture(t); f.lose = "debit";
  await assert.rejects(f.act(), /pending/);
  const original = f.game.pending("alice");
  for (const column of ["obstacles", "trajectory", "bonus"]) f.game.db.exec(`ALTER TABLE balldrop_rounds DROP COLUMN ${column}`);
  await f.reopen(); f.game.obstacles = OBSTACLES;
  const recovered = await f.game.retry("alice");
  assert.deepEqual(recovered.round.path, JSON.parse(original.path)); assert.deepEqual(recovered.round.obstacles, []); assert.deepEqual(recovered.round.trajectory, []);
  assert.equal(recovered.round.bonus, 0); assert.equal(recovered.round.payout, original.payout); assert.equal(f.funds.alice, 5005);
});

test("an uncertain entry reveals the public layout but hides its coin rolls and bomb directions", async t => {
  const f = fixture(t, { obstacles: OBSTACLES }); f.lose = "debit";
  await assert.rejects(f.act(), /pending/);
  const state = f.game.snapshot("alice");
  assert.deepEqual(state.obstacles, OBSTACLES); assert.equal(state.round, null);
  assert.doesNotMatch(JSON.stringify(state), /trajectory|landing|bonus|"hit"/);
  const saved = f.game.pending("alice"); await f.game.retry("alice");
  assert.equal(f.game.snapshot("alice").round.bonus, saved.bonus);
});

test("all allowed bets follow exact, adjacent, two-away and losing payouts with half coins rounded up", async t => {
  const f = fixture(t);
  assert.deepEqual([1, 5, 25].map(bet => payout(bet, 1, 2)), [2, 8, 38]);
  for (const bet of BETS) for (const guess of [2, 1, 3, 4, 5, 10]) {
    const before = f.funds.alice, result = await f.act({ bet, guess, landing: 10, payout: 9999, asset: "stars", path: [10] });
    assert.equal(result.round.path.length, 21); assert.equal(result.round.landing, 2);
    assert.equal(result.round.payout, payout(bet, guess, 2)); assert.equal(f.funds.alice, before - bet + result.round.payout);
    assert.equal(result.round.state, "done");
  }
  assert.equal(f.funds.bob, 5000); assert.equal(f.wallet.hasPending("alice"), false);
});

test("invalid bets and pockets cannot spend or draw; repeated wager IDs never debit or reroll", async t => {
  const f = fixture(t);
  for (const input of [{ bet: 0 }, { bet: 2 }, { bet: 1.5 }, { bet: "5" }, { guess: 0 }, { guess: 11 }, { guess: 2.5 }, { guess: "2" }, { request: "bad" }, { action: "win" }]) await assert.rejects(f.act(input), BallDropError);
  assert.equal(f.ledger.size, 0); assert.equal(f.rolls, 0);
  const request = randomUUID(), result = await f.act({ request });
  const rolls = f.rolls, funds = f.funds.alice;
  assert.equal((await f.act({ request })).round.id, result.round.id);
  assert.equal(f.rolls, rolls); assert.equal(f.funds.alice, funds);
  await assert.rejects(f.act({ request, bet: 10 }), /different bet/);
});

test("lost debit/credit receipts survive restart without revealing unpaid results or paying twice", async t => {
  for (const kind of ["debit", "credit"]) {
    const f = fixture(t); f.lose = kind;
    await assert.rejects(f.act(), /pending/);
    const saved = f.game.pending("alice"), route = saved.path;
    assert.equal(f.game.snapshot("alice").round === null, kind === "debit");
    if (kind === "debit") assert.doesNotMatch(JSON.stringify(f.game.snapshot("alice")), /landing|path/);
    await assert.rejects(f.wallet.disconnect("alice"), /pending/i);
    await f.reopen(); assert.ok(f.wallet.hasPending("alice"));
    await assert.rejects(f.act(), /pending wallet/);
    const result = await f.game.retry("alice");
    assert.equal(JSON.stringify(result.round.path), route); assert.equal(f.funds.alice, 5005); assert.equal(f.ledger.size, 2);
  }
});

test("a first refused debit cancels, but a later rejection cannot erase an uncertain debit", async t => {
  const f = fixture(t); f.funds.alice = 0;
  await assert.rejects(f.act(), /Not enough/); assert.equal(f.game.pending("alice"), undefined); assert.equal(f.game.snapshot("alice").round, null);
  f.funds.alice = 100; f.lose = "debit";
  await assert.rejects(f.act(), /pending/);
  f.reject = new WalletError("denied", "Denied", 403);
  await assert.rejects(f.game.retry("alice"), /pending/); assert.ok(f.game.pending("alice"));
  f.reject = null; await f.game.retry("alice"); assert.equal(f.funds.alice, 105);
});

test("malformed receipts and post-payment database failures preserve stable payment IDs", async t => {
  for (const failure of ["receipt", "debit-state", "credit-state"]) {
    const f = fixture(t);
    if (failure === "receipt") f.badReceipt = { amount: 999 };
    else f.game.db.exec(`CREATE TRIGGER fail_state BEFORE UPDATE OF state ON balldrop_rounds WHEN NEW.state='${failure === "debit-state" ? "credit" : "done"}' BEGIN SELECT RAISE(FAIL,'fixture'); END`);
    await assert.rejects(f.act(), /pending/);
    assert.ok(f.wallet.hasPending("alice"));
    f.badReceipt = null; if (failure !== "receipt") f.game.db.exec("DROP TRIGGER fail_state");
    await f.game.retry("alice"); assert.equal(f.funds.alice, 5005); assert.equal(f.ledger.size, 2);
  }
});

test("paid drops remain pinned, paused games recover through the shared wallet command", async t => {
  const f = fixture(t); f.lose = "credit";
  await assert.rejects(f.act(), /payout is pending/);
  f.wallet.db.prepare("UPDATE online_wallets SET account_id='other' WHERE discord_id='alice'").run();
  await assert.rejects(f.game.retry("alice"), /payout is pending/);
  f.wallet.db.prepare("UPDATE online_wallets SET account_id='alice' WHERE discord_id='alice'").run();
  f.game.config.enabled = false;
  const reply = await runWalletAction({ user: { id: "alice" } }, f.wallet, {}, "retry");
  assert.match(reply.content, /ball drop is settled/); assert.equal(f.funds.alice, 5005);
  await assert.rejects(f.act(), /paused/);
});

test("concurrent requests and other games' reservations share the wallet lock", async t => {
  const f = fixture(t); let release, started;
  const ready = new Promise(resolve => { started = resolve; });
  f.hold = () => new Promise(resolve => { release = resolve; started(); });
  const first = f.act(); await ready;
  await assert.rejects(f.act(), /Another wallet action/);
  f.hold = null; release(); await first;
  const previous = f.wallet.hasPending; f.wallet.hasPending = user => user === "alice" || previous(user);
  await assert.rejects(f.act(), /pending wallet/); assert.equal(f.ledger.size, 2);
});

test("HTTP handoff, session isolation, CSRF and authenticated ownership protect bets", async t => {
  const f = fixture(t), identities = new IdentityStore(":memory:"); t.after(() => identities.close());
  identities.db.prepare("INSERT INTO identity_links VALUES (?,?,?,?,?)").run("alice", "issuer", "alice", "Alice<script>", Date.now());
  const sessions = new GameSessions(f.game.db, identities, { prefix: "balldrop", command: "/balldrop", ErrorClass: BallDropError });
  const other = new GameSessions(f.game.db, identities, { prefix: "other", command: "/other" }), otherToken = other.open(other.begin("alice"));
  const config = { origin: "http://127.0.0.1", issuer: "https://auth.example" };
  const login = createGameLogin(config, identities, {}, { balldrop: { sessions, title: "Prism Drop" } });
  const web = createBallDropWeb(config, f.game, sessions);
  const server = createAuthServer(config, identities, {}, f.wallet, async (req, res) => await login.route(req, res) || await web(req, res));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); config.origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const at = (path, options) => fetch(`${config.origin}/balldrop/${path}`, options);
  assert.equal((await at("api/state")).status, 401); assert.match(await (await at("login")).text(), /Prism Drop/);
  const ticket = sessions.begin("alice"), preview = await at(`open?ticket=${ticket}`), html = await preview.text();
  assert.ok(sessions.ticket(ticket));
  const formCookie = preview.headers.getSetCookie()[0].split(";")[0], csrf = html.match(/name="csrf" value="([a-f0-9]+)"/)[1];
  const opened = await at("open", { method: "POST", redirect: "manual", headers: { Origin: config.origin, Cookie: formCookie, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ticket, csrf }) });
  assert.equal(opened.status, 303); assert.equal(opened.headers.get("location"), "/balldrop/"); assert.equal(sessions.ticket(ticket), null);
  const cookie = opened.headers.getSetCookie()[0].split(";")[0];
  const state = await (await at("api/state", { headers: { Cookie: cookie } })).json();
  assert.equal(state.playerId, "alice"); assert.doesNotMatch(JSON.stringify(state), /token|base_url|account_id/);
  const headers = { Origin: config.origin, Cookie: cookie, "Content-Type": "application/json", "X-CSRF-Token": state.csrf };
  const input = { action: "drop", request: randomUUID(), bet: 5, guess: 2, user_id: "bob" };
  for (const extra of [{ Origin: "https://evil.example" }, { "X-CSRF-Token": "wrong" }]) assert.equal((await at("api/action", { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(input) })).status, 403);
  const result = await (await at("api/action", { method: "POST", headers, body: JSON.stringify(input) })).json();
  assert.equal(result.round.payout, 10); assert.equal(f.funds.bob, 5000);
  assert.equal((await at("store.js")).status, 404);
  assert.equal((await at("api/action", { method: "POST", headers, body: "null" })).status, 400);
  await at("api/logout", { method: "POST", headers, body: "{}" });
  assert.equal((await at("api/state", { headers: { Cookie: cookie } })).status, 401); assert.ok(other.get(otherToken));
});

test("Discord slash, prefix, menu and unlink use private ball-drop sessions", async t => {
  const f = fixture(t), identities = new IdentityStore(":memory:"); t.after(() => identities.close());
  identities.db.prepare("INSERT INTO identity_links VALUES (?,?,?,?,?)").run("alice", "issuer", "alice", "Alice", Date.now());
  const sessions = new GameSessions(f.game.db, identities, { prefix: "balldrop", command: "/balldrop", ErrorClass: BallDropError });
  const commands = createBallDropCommands({ origin: "https://bot.example" }, sessions), replies = [], publicReplies = [];
  await commands.registerGuild({ commands: { create: async command => assert.equal(command.toJSON().name, "balldrop") } });
  await commands.handleInteraction({ commandName: "balldrop", isChatInputCommand: () => true, user: { id: "alice" }, deferReply: async reply => assert.equal(reply.flags, 64), editReply: async reply => replies.push(reply) });
  assert.match(replies[0].content, /balldrop\/open\?ticket=/);
  await commands.handleMessage({ content: "!balldrop", guild: {}, author: { id: "alice", send: async reply => replies.push(reply) }, reply: async reply => publicReplies.push(reply) });
  assert.doesNotMatch(JSON.stringify(publicReplies), /ticket=/);
  const handler = createIdentityHandler(identities, { origin: "https://bot.example" }, f.wallet, null, null, null, null, { ...commands, revoke: user => sessions.revoke(user) });
  let menu;
  await handler({ commandName: "menu", isChatInputCommand: () => true, user: { id: "alice" }, reply: async value => { menu = value; } });
  const button = menu.components.flatMap(row => row.toJSON().components).find(button => button.label === "Prism Drop"); assert.ok(button);
  let edited;
  await handler({ customId: button.custom_id, user: { id: "alice" }, isButton: () => true, isChatInputCommand: () => false, deferUpdate: async () => {}, editReply: async value => { edited = value; } });
  assert.match(edited.embeds[0].toJSON().description, /balldrop\/open\?ticket=/);
  const token = sessions.open(sessions.begin("alice"));
  await handler({ commandName: "lidollid", isChatInputCommand: () => true, user: { id: "alice" }, options: { getSubcommand: () => "unlink" }, deferReply: async () => {}, editReply: async () => {} });
  assert.equal(sessions.get(token), null);
});
