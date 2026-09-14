import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { HangmanStore, HangmanError } from "../src/hangman/store.js";
import { WORDS, hangmanConfig } from "../src/hangman/words.js";
import { WalletService } from "../src/wallet/service.js";
import { WalletError } from "../src/wallet/client.js";
import { GameSessions } from "../src/games/sessions.js";
import { GachaSessions } from "../src/gacha/sessions.js";
import { IdentityStore } from "../src/auth/store.js";
import { createHangmanWeb } from "../src/hangman/web.js";
import { createHangmanCommands } from "../src/hangman/index.js";
import { createAuthServer } from "../src/auth/server.js";
import { createIdentityHandler } from "../src/auth/index.js";
import { handleWalletInteraction } from "../src/wallet/commands.js";

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "mommybot-hangman-"));
  const f = { funds: { alice: 20, bob: 20 }, ledger: new Map(), lose: null };
  f.client = { config: { baseUrl: "https://wallet.example/", clientId: "lidollbot" },
    revoke: async () => {}, balance: async user => ({ accountId: user, coins: f.funds[user], stars: 5 }),
    operation: async (user, input) => {
      const key = `${user}:${input.request_id}`;
      assert.equal(input.asset, "coins");
      if (f.reject) throw f.reject;
      let receipt = f.ledger.get(key);
      if (!receipt) {
        assert.ok(["credit", "debit"].includes(input.kind));
        const delta = input.kind === "credit" ? input.amount : -input.amount;
        if (f.funds[user] + delta < 0) throw new WalletError("funds", "Not enough coins.", 409);
        f.funds[user] += delta;
        receipt = { ...input, currency: "LiDollCoin", balance: f.funds[user] }; f.ledger.set(key, receipt);
        if (f.lose === input.kind) throw new WalletError("lost", "Response lost.");
      }
      return f.badReceipt ? { ...receipt, amount: 999 } : receipt;
    } };
  const open = seed => {
    f.wallet = new WalletService(join(directory, "wallet.db"), f.client);
    f.game = new HangmanStore(join(directory, "hangman.db"), f.wallet, hangmanConfig(), { words: [{ word: "BANANA", clue: "A yellow fruit" }], draw: () => 0 });
    if (seed) for (const user of ["alice", "bob"]) f.wallet.db.prepare("INSERT INTO online_wallets VALUES (?,?,?,?,?,?)").run(user, user, Date.now() + 86400000, user, f.client.config.baseUrl, f.client.config.clientId);
  };
  open(true);
  f.act = (action, letter, extra = {}, user = "alice") => f.game.act(user, { action, letter, request: randomUUID(), round: f.game.active(user)?.id, ...extra });
  f.reopen = async () => { await f.wallet.close(); f.game.close(); open(false); };
  t.after(async () => { await f.wallet.close(); f.game.close(); rmSync(directory, { recursive: true, force: true }); });
  return f;
} // A durable SQLite game and idempotent fake wallet test economics without spending live coins.

test("friendly words and entry price are bounded and one guess pays per revealed occurrence", async t => {
  assert.ok(WORDS.length >= 50); assert.ok(WORDS.every(item => /^[A-Z]{3,10}$/.test(item.word)));
  assert.equal(hangmanConfig().price, 1);
  assert.throws(() => hangmanConfig({ HANGMAN_ENABLED: "true" }), /requires/);
  const f = fixture(t), start = await f.act("start");
  assert.equal(f.funds.alice, 19); assert.equal(start.round.answer, null);
  assert.deepEqual(start.round.letters, [null, null, null, null, null, null]);
  assert.doesNotMatch(JSON.stringify(start), /BANANA/);
  const guess = await f.act("guess", "a", { amount: 999, currency: "stars" }); // Client-supplied reward amounts and currencies are ignored.
  assert.equal(guess.amount, 3); assert.equal(f.funds.alice, 22);
  assert.deepEqual(guess.round.letters, [null, "A", null, "A", null, "A"]);
  assert.equal(guess.round.earned, 3);
  await assert.rejects(f.act("guess", "A"), /already guessed/);
  assert.equal(f.funds.alice, 22);
  await f.act("guess", "N"); const won = await f.act("guess", "B");
  assert.equal(won.round.status, "won"); assert.equal(won.round.answer, "BANANA");
  assert.equal(f.funds.alice, 25); assert.equal(won.snapshot.totals.earned, 6);
  assert.equal(won.snapshot.totals.won, 1);
});

test("wrong guesses cost nothing, loss reveals no paid bonus, and another game costs one new coin", async t => {
  const f = fixture(t); await f.act("start");
  let lost;
  for (const letter of "CDEFGH") lost = await f.act("guess", letter);
  assert.equal(lost.round.status, "lost"); assert.equal(lost.round.remaining, 0); assert.equal(lost.round.answer, "BANANA");
  assert.equal(f.funds.alice, 19); assert.equal(f.ledger.size, 1);
  await assert.rejects(f.act("guess", "A", { round: lost.round.id }), /no longer available/);
  await f.act("start"); assert.equal(f.funds.alice, 18);
});

test("zero funds, invalid letters, foreign rounds, repeated requests and overlapping games cannot create rewards", async t => {
  const f = fixture(t); f.funds.alice = 0;
  await assert.rejects(f.act("start"), /Not enough coins/);
  assert.equal(f.game.pending("alice"), undefined); assert.equal(f.game.active("alice"), undefined);
  f.funds.alice = 1; const request = randomUUID(), started = await f.act("start", null, { request });
  await f.act("start", null, { request }); assert.equal(f.funds.alice, 0);
  await assert.rejects(f.act("start"), /current word/);
  for (const letter of ["AB", "!", "", "é"]) await assert.rejects(f.act("guess", letter), /one letter/);
  await assert.rejects(f.act("guess", "A", { round: started.round.id }, "bob"), /no longer available/);
  const guessRequest = randomUUID(); await f.act("guess", "A", { request: guessRequest });
  await f.act("guess", "A", { request: guessRequest }); assert.equal(f.funds.alice, 3);
  await assert.rejects(f.act("guess", "N", { request: guessRequest }), /different game action/);
  assert.equal(f.game.snapshot("bob").round, null);
});

for (const kind of ["debit", "credit"]) test(`lost ${kind} survives restart and recovers once with the original word and payment`, async t => {
  const f = fixture(t); if (kind === "credit") await f.act("start");
  f.lose = kind;
  await assert.rejects(f.act(kind === "debit" ? "start" : "guess", "A"), /pending/);
  const funds = f.funds.alice, id = f.game.pending("alice").id;
  if (kind === "debit") assert.equal(f.game.snapshot("alice").round, null);
  await assert.rejects(f.wallet.disconnect("alice"), /pending/);
  await f.reopen(); assert.equal(f.game.pending("alice").id, id);
  await assert.rejects(f.act("start"), /pending wallet/);
  f.lose = null; const result = await f.game.retry("alice");
  assert.equal(f.funds.alice, funds); assert.equal(f.game.pending("alice"), undefined);
  assert.equal(result.round.status, "active");
});

test("earned payouts remain pending at daily caps and on rejected or malformed credit responses", async t => {
  const f = fixture(t); await f.act("start");
  f.reject = new WalletError("daily_limit", "Retry tomorrow.", 429);
  await assert.rejects(f.act("guess", "A"), /tomorrow/);
  assert.deepEqual(f.game.snapshot("alice").round.letters, [null, "A", null, "A", null, "A"]);
  f.reject = new WalletError("scope", "Renew wallet permission.", 403);
  await assert.rejects(f.game.retry("alice"), /pending/); assert.ok(f.game.pending("alice"));
  f.reject = null; f.badReceipt = true;
  await assert.rejects(f.game.retry("alice"), /receipt/); assert.equal(f.funds.alice, 22);
  f.badReceipt = false; await f.game.retry("alice"); assert.equal(f.funds.alice, 22);
});

test("rounds pin rewards to the original account; forfeiting keeps earned coins and has no refund", async t => {
  const f = fixture(t); await f.act("start"); await f.act("guess", "A");
  f.wallet.db.prepare("UPDATE online_wallets SET account_id='other' WHERE discord_id='alice'").run();
  await assert.rejects(f.act("guess", "N"), /wallet you started/);
  const ended = await f.act("forfeit"); assert.equal(ended.round.status, "forfeited");
  assert.equal(f.funds.alice, 22); assert.equal(ended.round.earned, 3);
});

test("payment completion storage errors retry atomically and do not pay twice", async t => {
  const f = fixture(t);
  f.game.db.exec("CREATE TRIGGER fail_done BEFORE UPDATE OF state ON hangman_jobs WHEN NEW.state='done' BEGIN SELECT RAISE(FAIL,'fixture'); END");
  await assert.rejects(f.act("start"), /fixture/); assert.equal(f.funds.alice, 19);
  assert.equal(f.game.pending("alice").state, "paid"); assert.equal(f.game.snapshot("alice").round, null);
  f.game.db.exec("DROP TRIGGER fail_done"); await f.reopen(); await f.game.retry("alice");
  assert.equal(f.funds.alice, 19); assert.equal(f.game.snapshot("alice").round.status, "active");
});

test("pausing new games preserves existing play and shared wallet retry handles hangman", async t => {
  const f = fixture(t); await f.act("start"); f.game.config.enabled = false;
  f.lose = "credit"; await assert.rejects(f.act("guess", "A"), /pending/);
  await assert.rejects(f.wallet.gifts.gift("guild", "admin", "alice", "stars", 1, "123"), /pending/);
  let reply;
  await handleWalletInteraction({ user: { id: "alice" }, commandName: "lidollid", isChatInputCommand: () => true,
    options: { getSubcommandGroup: () => "wallet", getSubcommand: () => "retry" }, deferReply: async () => {}, editReply: async result => { reply = result; } }, f.wallet, {});
  assert.match(reply.content, /3-coin hangman/);
  await f.act("forfeit"); await assert.rejects(f.act("start"), /paused/);
});

test("browser handoff, masked state, CSRF, namespace isolation and logout use the real HTTP routes", async t => {
  const f = fixture(t), identities = new IdentityStore(":memory:"); t.after(() => identities.close());
  identities.db.prepare("INSERT INTO identity_links VALUES (?,?,?,?,?)").run("alice", "issuer", "alice", "alice<script>", Date.now());
  const sessions = new GameSessions(f.game.db, identities, { prefix: "hangman", command: "/hangman", ErrorClass: HangmanError });
  const atelier = new GachaSessions(f.game.db, identities), atelierToken = atelier.open(atelier.begin("alice"));
  const config = { origin: "http://127.0.0.1", issuer: "https://auth.example" };
  const server = createAuthServer(config, identities, {}, f.wallet, createHangmanWeb(config, f.game, sessions));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); config.origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const at = (path, options) => fetch(`${config.origin}/hangman/${path}`, options);
  assert.equal((await at("api/state")).status, 401);
  const ticket = sessions.begin("alice"), landing = await at(`open?ticket=${ticket}`), html = await landing.text();
  assert.ok(sessions.ticket(ticket)); const formCookie = landing.headers.getSetCookie()[0].split(";")[0], csrf = html.match(/name="csrf" value="([a-f0-9]+)"/)[1];
  const opened = await at("open", { method: "POST", redirect: "manual", headers: { Origin: config.origin, Cookie: formCookie, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ticket, csrf }) });
  assert.equal(opened.status, 303); assert.equal(opened.headers.get("location"), "/hangman/");
  assert.match(opened.headers.getSetCookie()[0], /HttpOnly; SameSite=Lax/);
  const cookie = opened.headers.getSetCookie()[0].split(";")[0];
  const state = await (await at("api/state", { headers: { Cookie: cookie } })).json();
  const headers = { Origin: config.origin, Cookie: cookie, "Content-Type": "application/json", "X-CSRF-Token": state.csrf };
  const start = { action: "start", request: randomUUID(), user_id: "bob" };
  for (const extra of [{ Origin: "https://evil.example" }, { "X-CSRF-Token": "wrong" }]) assert.equal((await at("api/action", { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(start) })).status, 403);
  const result = await (await at("api/action", { method: "POST", headers, body: JSON.stringify(start) })).json();
  assert.equal(result.round.answer, null); assert.doesNotMatch(JSON.stringify(result), /BANANA/);
  assert.equal(f.funds.alice, 19); assert.equal(f.funds.bob, 20);
  assert.equal((await at("words.js")).status, 404);
  assert.match((await at("app.js")).headers.get("content-security-policy"), /script-src 'self'/);
  assert.doesNotMatch(await (await at("")).text(), /alice<script>/);
  assert.equal((await at("api/action", { method: "POST", headers, body: "null" })).status, 400);
  await at("api/logout", { method: "POST", headers, body: "{}" });
  assert.equal((await at("api/state", { headers: { Cookie: cookie } })).status, 401);
  assert.ok(atelier.get(atelierToken));
});

test("slash, prefix, main menu and unlink preserve private hangman handoffs", async t => {
  const f = fixture(t), identities = new IdentityStore(":memory:"); t.after(() => identities.close());
  identities.db.prepare("INSERT INTO identity_links VALUES (?,?,?,?,?)").run("alice", "issuer", "alice", "alice", Date.now());
  const sessions = new GameSessions(f.game.db, identities, { prefix: "hangman", command: "/hangman", ErrorClass: HangmanError });
  const commands = createHangmanCommands({ origin: "https://bot.example" }, sessions), privateReplies = [], publicReplies = [], registrations = [];
  await commands.registerGuild({ commands: { create: async value => registrations.push(value.toJSON()) } }); assert.equal(registrations[0].name, "hangman");
  await commands.handleInteraction({ commandName: "hangman", isChatInputCommand: () => true, user: { id: "alice" }, deferReply: async value => assert.equal(value.flags, 64), editReply: async value => privateReplies.push(value) });
  assert.match(privateReplies[0].content, /\/hangman\/open\?ticket=/);
  const message = { content: "!hangman", guild: {}, author: { id: "alice", send: async value => privateReplies.push(value) }, reply: async value => publicReplies.push(value) };
  await commands.handleMessage(message); assert.doesNotMatch(JSON.stringify(publicReplies), /ticket=/);
  message.author.send = async () => { throw Error("DM blocked"); }; await commands.handleMessage(message); assert.match(publicReplies.at(-1).content, /Use \/hangman/);
  const handler = createIdentityHandler(identities, { origin: "https://bot.example" }, f.wallet, null, null, { ...commands, revoke: user => sessions.revoke(user) });
  let menu;
  await handler({ commandName: "menu", isChatInputCommand: () => true, user: { id: "alice" }, reply: async value => { menu = value; } });
  assert.ok(menu.components.flatMap(row => row.toJSON().components).some(button => button.label === "Cozy Hangman"));
  const token = sessions.open(sessions.begin("alice"));
  await handler({ commandName: "lidollid", isChatInputCommand: () => true, user: { id: "alice" }, options: { getSubcommand: () => "unlink" }, deferReply: async () => {}, editReply: async () => {} });
  assert.equal(sessions.get(token), null);
});
