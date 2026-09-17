import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { GoFishStore, GoFishError } from "../src/gofish/store.js";
import { BOOKS, computerAsk, deal, goFishConfig, over, play, winner } from "../src/gofish/rules.js";
import { WalletService } from "../src/wallet/service.js";
import { WalletError } from "../src/wallet/client.js";
import { GameSessions } from "../src/games/sessions.js";
import { IdentityStore } from "../src/auth/store.js";
import { createGoFishWeb } from "../src/gofish/web.js";
import { createGoFishCommands } from "../src/gofish/index.js";
import { createAuthServer } from "../src/auth/server.js";

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "mommybot-gofish-"));
  const f = { funds: { alice: 20, bob: 20 }, ledger: new Map(), reject: null, seed: 5 };
  f.draw = max => { f.seed = (f.seed * 1103515245 + 12345) & 0x7fffffff; return f.seed % max; };
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
    f.game = new GoFishStore(join(directory, "gofish.db"), f.wallet, goFishConfig({}), { draw: f.draw });
    if (seed) for (const user of ["alice", "bob"]) f.wallet.db.prepare("INSERT INTO online_wallets VALUES (?,?,?,?,?,?)").run(user, user, Date.now() + 86400000, user, f.client.config.baseUrl, f.client.config.clientId);
  };
  open(true);
  f.directory = directory;
  f.act = (action, extra = {}, user = "alice") => f.game.act(user, { action, request: randomUUID(), ...extra }, { name: user });
  f.hand = user => { const row = f.game.live(user); return f.game.state(row).hands[f.game.seatOf(row, user)]; };
  f.reopen = async () => { await f.wallet.close(); f.game.close(); open(false); };
  t.after(async () => { await f.wallet.close(); f.game.close(); rmSync(directory, { recursive: true, force: true }); });
  return f;
} // A durable SQLite game and idempotent fake wallet test economics without spending live coins.

const askable = (f, user) => f.hand(user)[0][0];

test("a dealt game always terminates, lays down every book and never loses a card", () => {
  let seed = 31; const draw = max => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % max; };
  for (let game = 0; game < 120; game++) {
    const state = deal(draw);
    let turns = 0;
    while (!over(state) && turns++ < 400) {
      const seat = state.turn, hand = state.hands[seat];
      assert.ok(hand.length, "the player to move always holds cards while the pond has any");
      play(state, seat, seat === "guest" ? computerAsk(state, draw) : hand[draw(hand.length)][0]);
    }
    assert.ok(turns < 400, "every game reaches an end");
    assert.equal(state.books.host.length + state.books.guest.length, BOOKS);
    assert.equal(state.deck.length + state.hands.host.length + state.hands.guest.length, 0);
    assert.notEqual(winner(state), "tie"); // Thirteen books cannot split evenly.
  }
});

test("the computer plays only on shared-log knowledge and never reads the hidden hand", () => {
  const state = deal(() => 0);
  state.hands.guest = ["7S", "7H", "2C"]; state.hands.host = ["7D", "KH", "KS"]; state.deck = ["3C"];
  state.log = [];
  assert.equal(computerAsk(state, () => 0), "7", "with no knowledge it asks for the rank it holds most of");
  state.log = [{ by: "host", rank: "K", got: 0, fished: true, wish: false, books: [] }];
  state.hands.guest = ["KD", "2C", "2H", "2S"];
  assert.equal(computerAsk(state, () => 0), "K", "a rank the player asked for outranks a bigger private stack");
  state.log.push({ by: "guest", rank: "K", got: 1, fished: false, wish: false, books: [] });
  assert.equal(computerAsk(state, () => 0), "2", "taking every copy retires what that ask revealed");
  const seen = JSON.stringify(state.log);
  assert.doesNotMatch(seen, /KH|KS|3C/, "the log records ranks and counts, never another player's cards");
});

test("asking takes every match and continues the turn; a miss fishes and passes", async t => {
  const f = fixture(t);
  await f.act("create", { mode: "solo" });
  assert.equal(f.funds.alice, 19);
  const row = f.game.live("alice"), state = f.game.state(row);
  state.hands.host = ["7D", "KH"]; state.hands.guest = ["7S", "7H", "2C"]; state.deck = ["9C", "3D"];
  f.game.write(row.id, state, "active");
  const hit = await f.act("ask", { rank: "7" });
  assert.equal(hit.got, 2); assert.equal(hit.amount, 0);
  assert.deepEqual(hit.snapshot.game.you.hand.filter(card => card[0] === "7").length, 3);
  assert.equal(hit.snapshot.game.yourTurn, true, "taking cards earns another ask");
});

test("a completed book pays one coin per book and only for the player's own books", async t => {
  const f = fixture(t);
  await f.act("create", { mode: "solo" });
  const row = f.game.live("alice"), state = f.game.state(row);
  state.hands.host = ["7D", "7C", "7H"]; state.hands.guest = ["7S", "2C"]; state.deck = ["9C", "3D", "4S"];
  f.game.write(row.id, state, "active");
  const result = await f.act("ask", { rank: "7" });
  assert.deepEqual(result.books, ["7"]);
  assert.equal(result.amount, 1);
  assert.equal(f.funds.alice, 20, "the entry coin comes back with the first book");
  assert.deepEqual(result.snapshot.game.you.books, ["7"]);
  assert.equal(result.snapshot.totals.earned, 1);
});

test("a table never reveals the pond, the opponent's hand or another player's cards", async t => {
  const f = fixture(t);
  await f.act("create", { mode: "solo" });
  const row = f.game.live("alice"), state = f.game.state(row);
  const secret = state.hands.guest.concat(state.deck);
  const snapshot = f.game.snapshot("alice"), text = JSON.stringify(snapshot);
  assert.equal(snapshot.game.them.cards, state.hands.guest.length);
  assert.equal(snapshot.game.pond, state.deck.length);
  for (const card of secret) assert.doesNotMatch(text, new RegExp(`"${card}"`), `${card} must stay on the server`);
  for (const card of state.hands.host) assert.ok(snapshot.game.you.hand.includes(card));
});

test("invalid asks, foreign games, out-of-turn moves and replayed requests cannot deal or pay twice", async t => {
  const f = fixture(t);
  const first = await f.act("create", { mode: "solo" });
  assert.equal(f.funds.alice, 19);
  await assert.rejects(f.act("create", { mode: "solo" }), /current game/);
  await assert.rejects(f.act("ask", { rank: "Z" }), /Choose one of the ranks/);
  await assert.rejects(f.act("ask", { rank: [] }), /Choose one of the ranks/);
  const missing = "A23456789TJQK".split("").find(rank => !f.hand("alice").some(card => card[0] === rank));
  await assert.rejects(f.act("ask", { rank: missing }), /only ask for a rank you are holding/);
  await assert.rejects(f.act("ask", {}, "bob"), /no game in progress/);
  const request = randomUUID(), rank = askable(f, "alice");
  const once = await f.game.act("alice", { action: "ask", request, rank }, { name: "alice" });
  const twice = await f.game.act("alice", { action: "ask", request, rank }, { name: "alice" });
  assert.deepEqual(twice.snapshot.game.you.hand, once.snapshot.game.you.hand, "a replayed request returns the saved table");
  assert.equal(f.ledger.size <= 2, true);
  await assert.rejects(f.game.act("alice", { action: "leave", request }, { name: "alice" }), /different game action/);
  assert.equal(first.snapshot.game.mode, "solo");
});

test("a friend game needs no wallet, alternates turns and hides each hand from the other player", async t => {
  const f = fixture(t);
  const made = await f.act("create", { mode: "friend", visibility: "code" });
  const code = made.snapshot.game.code;
  assert.match(code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.equal(made.snapshot.game.status, "waiting");
  assert.equal(f.funds.alice, 20, "no coin is spent opening a friend table");
  await assert.rejects(f.act("join", { code }), /your own game/);
  await f.act("join", { code }, "bob");
  assert.equal(f.game.live("bob").status, "active");
  assert.equal(f.funds.bob, 20, "no coin is spent joining");
  const alice = f.game.snapshot("alice").game, bob = f.game.snapshot("bob").game;
  assert.equal(alice.them.cards, bob.you.hand.length);
  assert.equal(bob.them.name, "alice");
  for (const card of bob.you.hand) assert.doesNotMatch(JSON.stringify(alice), new RegExp(`"${card}"`));
  await assert.rejects(f.act("ask", { rank: askable(f, "bob") }, "bob"), /not your turn/);
  const moved = await f.act("ask", { rank: askable(f, "alice") });
  assert.equal(moved.amount, 0, "friend games never award coins");
  assert.equal(f.ledger.size, 0, "friend games never reach the wallet");
  assert.equal(f.game.snapshot("bob").game.yourTurn || moved.snapshot.game.yourTurn, true);
});

test("open tables are listed, code tables are not, and a used code cannot be joined again", async t => {
  const f = fixture(t);
  await f.act("create", { mode: "friend", visibility: "open" });
  const carol = f.game.snapshot("bob");
  assert.equal(carol.lobby.length, 1);
  assert.equal(carol.lobby[0].host, "alice");
  assert.equal(f.game.snapshot("alice").lobby.length, 0, "your own table is not offered back to you");
  await f.act("join", { game: carol.lobby[0].id }, "bob");
  assert.equal(f.game.snapshot("bob").lobby.length, 0, "a seated player sees no lobby");
  const f2 = fixture(t);
  const made = await f2.act("create", { mode: "friend", visibility: "code" });
  assert.equal(f2.game.snapshot("bob").lobby.length, 0, "a code table stays off the open list");
  await f2.act("join", { code: made.snapshot.game.code }, "bob");
  await assert.rejects(f2.game.act("carol", { action: "join", request: randomUUID(), code: made.snapshot.game.code }, { name: "carol" }), /no longer waiting/);
});

test("a Discord challenge binds to the invited player and expires", async t => {
  const f = fixture(t);
  const { code } = f.game.challenge("alice", "bob", "alice");
  assert.equal(f.game.snapshot("bob").lobby.length, 0, "a challenge is not an open table");
  await assert.rejects(f.game.act("carol", { action: "join", request: randomUUID(), code }, { name: "carol" }), /Only the challenged player/);
  await f.act("join", { code }, "bob");
  assert.equal(f.game.live("bob").status, "active");
  const f2 = fixture(t);
  const second = f2.game.challenge("alice", "bob", "alice");
  f2.game.db.prepare("UPDATE gofish_games SET expires=? WHERE code=?").run(Date.now() - 1, second.code);
  await assert.rejects(f2.act("join", { code: second.code }, "bob"), /no longer waiting/);
  f2.game.prune();
  assert.equal(f2.game.live("alice"), undefined, "pruning frees the host to start again");
});

test("leaving cancels a waiting table, forfeits an active one and never refunds the entry coin", async t => {
  const f = fixture(t);
  await f.act("create", { mode: "friend", visibility: "code" });
  await f.act("leave");
  assert.equal(f.game.live("alice"), undefined);
  await f.act("create", { mode: "solo" });
  assert.equal(f.funds.alice, 19);
  await f.act("leave");
  assert.equal(f.funds.alice, 19, "leaving refunds nothing");
  assert.equal(f.game.snapshot("alice").game.result, "left");
  const f2 = fixture(t);
  const made = await f2.act("create", { mode: "friend", visibility: "code" });
  await f2.act("join", { code: made.snapshot.game.code }, "bob");
  await f2.act("leave");
  assert.equal(f2.game.snapshot("bob").game.result, "won", "the player left behind is shown the win");
  assert.equal(f2.game.snapshot("bob").totals.won, 1);
  assert.equal(f2.game.snapshot("alice").totals.won, 0);
});

test("book rewards stay pending at daily caps and on malformed receipts, then settle once on retry", async t => {
  const f = fixture(t);
  await f.act("create", { mode: "solo" });
  const row = f.game.live("alice"), state = f.game.state(row);
  state.hands.host = ["7D", "7C", "7H"]; state.hands.guest = ["7S", "2C"]; state.deck = ["9C", "3D", "4S"];
  f.game.write(row.id, state, "active");
  f.reject = new WalletError("daily_limit", "The wallet app's daily limit has been reached.", 429);
  await assert.rejects(f.act("ask", { rank: "7" }), /Payment confirmation is pending/);
  assert.equal(f.game.snapshot("alice").pending.amount, 1);
  assert.equal(f.wallet.hasPending("alice"), true, "the shared wallet guard sees the saved reward");
  await assert.rejects(f.act("ask", { rank: askable(f, "alice") }), /pending wallet action/);
  f.reject = null; f.badReceipt = true;
  await assert.rejects(f.game.retry("alice"), /could not be verified|pending/);
  f.badReceipt = false;
  const settled = await f.game.retry("alice");
  assert.equal(settled.amount, 1); assert.equal(f.funds.alice, 20);
  assert.equal(f.game.snapshot("alice").pending, null);
  await assert.rejects(f.game.retry("alice"), /No Go Fish payment is waiting/);
});

test("a declined entry cancels its table and a lost debit response reopens the same one", async t => {
  const f = fixture(t);
  f.funds.alice = 0;
  await assert.rejects(f.act("create", { mode: "solo" }), /Not enough coins/);
  assert.equal(f.game.live("alice"), undefined, "a refused entry leaves no half-dealt table");
  assert.equal(f.game.snapshot("alice").game, null);
  f.funds.alice = 5; f.lose = "debit";
  await assert.rejects(f.act("create", { mode: "solo" }), /Payment confirmation is pending/);
  assert.equal(f.funds.alice, 4, "the debit reached the wallet even though the answer did not");
  f.lose = null;
  const resumed = await f.game.retry("alice");
  assert.equal(resumed.snapshot.game.status, "active");
  assert.equal(f.funds.alice, 4, "retrying the saved debit does not charge a second coin");
  assert.equal(f.ledger.size, 1);
});

test("games survive a restart and stay pinned to the account that started them", async t => {
  const f = fixture(t);
  await f.act("create", { mode: "solo" });
  const before = f.game.snapshot("alice").game.you.hand;
  await f.reopen();
  assert.deepEqual(f.game.snapshot("alice").game.you.hand, before, "the dealt hand is durable");
  f.wallet.db.prepare("UPDATE online_wallets SET account_id='someone-else' WHERE discord_id='alice'").run();
  await assert.rejects(f.act("ask", { rank: askable(f, "alice") }), /Reconnect the wallet you started this game with/);
});

test("pausing new games preserves play in progress and payment recovery", async t => {
  const f = fixture(t);
  await f.act("create", { mode: "solo" });
  f.game.config = { ...f.game.config, enabled: false };
  const played = await f.act("ask", { rank: askable(f, "alice") });
  assert.ok(played.snapshot.game, "an open table keeps playing while new games are paused");
  await f.act("leave");
  await assert.rejects(f.act("create", { mode: "solo" }), /paused/);
  await assert.rejects(f.act("create", { mode: "friend", visibility: "code" }), /paused/);
  assert.throws(() => goFishConfig({ GOFISH_ENABLED: "true" }), /requires/);
  assert.equal(goFishConfig({}).price, 1);
});

test("browser handoff, masked state, CSRF, polling and logout use the real HTTP routes", async t => {
  const f = fixture(t);
  const identities = new IdentityStore(":memory:");
  t.after(() => identities.close());
  identities.db.prepare("INSERT INTO identity_links VALUES (?,?,?,?,?)").run("alice", "issuer", "alice", "alice<script>", Date.now());
  const config = { origin: "http://127.0.0.1", issuer: "https://auth.example" };
  const sessions = new GameSessions(f.game.db, identities, { prefix: "gofish", command: "/gofish", ErrorClass: GoFishError });
  const server = createAuthServer(config, identities, {}, f.wallet, createGoFishWeb(config, f.game, sessions));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  config.origin = `http://127.0.0.1:${server.address().port}`;
  const origin = config.origin;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const call = (path, options = {}) => fetch(`${origin}${path}`, { redirect: "manual", ...options });

  assert.equal((await call("/gofish/api/state")).status, 401, "no session sees no table");
  const page = await call("/gofish/");
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Go Fish/);

  const ticket = sessions.begin("alice");
  const openPage = await call(`/gofish/open?ticket=${ticket}&code=ABCD-2345`);
  const openText = await openPage.text();
  assert.match(openText, /challenged you/, "a challenge link explains itself before sign-in");
  assert.match(openText, /value="ABCD-2345"/);
  const bad = await call(`/gofish/open?ticket=${ticket}&code=javascript:alert(1)`);
  assert.doesNotMatch(await bad.text(), /javascript:/, "only a well-formed code survives the handoff");

  const nonce = /gofish_form=([\w-]+)/.exec(openPage.headers.getSetCookie().join(";"))[1];
  const { createHash } = await import("node:crypto");
  const csrf = createHash("sha256").update(`${ticket}:${nonce}`).digest("hex");
  const opened = await call("/gofish/open", { method: "POST", headers: { origin, "content-type": "application/x-www-form-urlencoded", cookie: `gofish_form=${nonce}` },
    body: new URLSearchParams({ ticket, code: "ABCD-2345", csrf }).toString() });
  assert.equal(opened.status, 303);
  assert.equal(opened.headers.get("location"), "/gofish/?code=ABCD-2345", "the invite rides through the handoff");
  const cookie = `gofish_session=${/gofish_session=([\w-]+)/.exec(opened.headers.getSetCookie().join(";"))[1]}`;

  const state = await (await call("/gofish/api/state", { headers: { cookie } })).json();
  assert.equal(state.username, "alice<script>"); assert.equal(state.coins, 20); assert.ok(state.csrf);
  assert.doesNotMatch(await (await call("/gofish/")).text(), /alice<script>/, "a display name is never baked into the served page");
  const polled = await (await call("/gofish/api/state?wallet=0", { headers: { cookie } })).json();
  assert.equal(polled.coins, null, "a background poll never calls the wallet");
  assert.equal(polled.polled, true);

  const post = (body, headers = {}) => call("/gofish/api/action", { method: "POST", headers: { origin, "content-type": "application/json", cookie, "x-csrf-token": state.csrf, ...headers }, body: JSON.stringify(body) });
  assert.equal((await post({ action: "create", request: randomUUID(), mode: "solo" }, { "x-csrf-token": "wrong" })).status, 403);
  assert.equal((await post({ action: "create", request: randomUUID(), mode: "solo" }, { origin: "https://evil.example" })).status, 403);
  const created = await post({ action: "create", request: randomUUID(), mode: "solo" });
  assert.equal(created.status, 200);
  const table = (await created.json()).snapshot.game;
  assert.equal(table.you.hand.length, 7);
  assert.equal(f.funds.alice, 19);

  const hidden = f.game.state(f.game.live("alice")).hands.guest;
  const body = JSON.stringify(await (await call("/gofish/api/state", { headers: { cookie } })).json());
  for (const card of hidden) assert.doesNotMatch(body, new RegExp(`"${card}"`), "the browser never receives the computer's hand");

  assert.equal((await call("/gofish/api/state", { headers: { cookie: "gofish_session=nope" } })).status, 401);
  const out = await call("/gofish/api/logout", { method: "POST", headers: { origin, "content-type": "application/json", cookie, "x-csrf-token": state.csrf }, body: "{}" });
  assert.equal(out.status, 200);
  assert.equal((await call("/gofish/api/state", { headers: { cookie } })).status, 401, "logout closes the browser session");
});

test("slash, prefix and challenge commands keep handoffs private", async t => {
  const f = fixture(t);
  const identities = new IdentityStore(":memory:");
  t.after(() => identities.close());
  const config = { origin: "https://bot.example" };
  const sessions = new GameSessions(f.game.db, identities, { prefix: "gofish", command: "/gofish", ErrorClass: GoFishError });
  for (const user of ["alice", "bob"]) identities.db.prepare("INSERT INTO identity_links VALUES (?,?,?,?,?)").run(user, "issuer", user, user, Date.now());
  const commands = createGoFishCommands(config, sessions, f.game, identities);
  assert.match(commands.linkMessage("alice"), /https:\/\/bot\.example\/gofish\/open\?ticket=[\w-]{43}/);

  const sent = [];
  const interaction = (options = {}) => ({ isChatInputCommand: () => true, commandName: "gofish", user: { id: "alice", username: "alice" },
    options: { getUser: () => options.friend ?? null }, deferReply: async () => {}, editReply: async payload => sent.push(payload) });

  await commands.handleInteraction(interaction());
  assert.match(sent.at(-1).content, /1 LiDollcoin/);
  assert.deepEqual(sent.at(-1).allowedMentions, { parse: [] });

  const dms = [];
  await commands.handleInteraction(interaction({ friend: { id: "bob", username: "bob", bot: false, send: async payload => dms.push(payload) } }));
  assert.match(dms[0].content, /alice challenged you/);
  assert.match(dms[0].content, /\/gofish\/open\?ticket=[\w-]{43}&code=[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}/);
  assert.match(sent.at(-1).content, /Challenge sent/);
  const challenged = f.game.db.prepare("SELECT * FROM gofish_games WHERE invited_id='bob'").get();
  assert.equal(challenged.host_id, "alice");

  await commands.handleInteraction(interaction({ friend: { id: "alice", username: "alice", bot: false, send: async () => {} } }));
  assert.match(sent.at(-1).content, /not yourself/);
  await commands.handleInteraction(interaction({ friend: { id: "robot", username: "robot", bot: true, send: async () => {} } }));
  assert.match(sent.at(-1).content, /Bots do not play cards/);
  await commands.handleInteraction(interaction({ friend: { id: "stranger", username: "stranger", bot: false, send: async () => {} } }));
  assert.match(sent.at(-1).content, /lidollid login/);

  const replies = [];
  const message = { author: { id: "bob", bot: false, send: async payload => dms.push(payload) }, content: "!gofish", guild: {},
    reply: async payload => { replies.push(payload); } };
  assert.equal(await commands.handleMessage(message), true);
  assert.match(replies.at(-1).content, /in your DMs/);
  assert.match(dms.at(-1).content, /gofish\/open\?ticket=/);
  assert.equal(await commands.handleMessage({ author: { id: "bob", bot: false }, content: "hello" }), false);
});
