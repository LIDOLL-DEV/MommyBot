import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { WalletService } from "../src/wallet/service.js";
import { WalletError, walletConfig } from "../src/wallet/client.js";
import { OnlineAdoptions } from "../src/wallet/adoptions.js";
import { OnlineEconomy } from "../src/wallet/economy.js";
import { TouhouStore, MOMIJI_OWNER_ID } from "../src/touhou/store.js";
import { BattleService } from "../src/touhou/battles.js";
import { createTouhouHandlers } from "../src/touhou/commands.js";
import { TouhouMenus } from "../src/touhou/menu.js";
import { handleWalletInteraction } from "../src/wallet/commands.js";
import { PermissionsBitField, PermissionFlagsBits } from "discord.js";

const catalog = ["Reimu Hakurei", "Marisa Kirisame", "Cirno", "Momiji Inubashiri", "Sanae Kochiya"]
  .map(name => ({ name, filename: `${name}.png`, baseRarity: 9 }));

function setup(t) {
  const folder = mkdtempSync(path.join(os.tmpdir(), "mommybot-online-economy-"));
  const api = { funds: { alice: { coins: 500, stars: 5 }, bob: { coins: 100, stars: 5 } }, receipts: new Map(),
    tokens: new Map([["alice-token", "alice"], ["bob-token", "bob"]]), calls: [], failCredit: false, loseResponse: null, afterDebit: null };
  const client = {
    config: walletConfig({ LIDOLLCOIN_ENABLED: "true" }),
    async balance(token) { const user = api.tokens.get(token); return { accountId: `account-${user}`, ...api.funds[user] }; },
    async revoke(token) { api.tokens.delete(token); },
    async operation(token, body) {
      const user = api.tokens.get(token);
      if (!user) throw new WalletError("invalid_token", "Reconnect the original wallet.", 401);
      api.calls.push({ user, ...body });
      assert.match(body.request_id, /^[\w-]{1,80}$/);
      const key = `${user}:${body.request_id}`, old = api.receipts.get(key);
      if (old) { assert.deepEqual(old.body, body); return old.result; }
      if (body.kind === "credit" && api.failCredit) throw new WalletError("daily_limit", "Daily limit reached.", 429);
      const amount = body.kind === "refund" ? api.receipts.get(`${user}:${body.original_id}`).result.amount : body.amount;
      assert.ok(Number.isInteger(amount) && amount > 0);
      const delta = body.kind === "debit" ? -amount : amount;
      if (api.funds[user][body.asset] + delta < 0) throw new WalletError("request_failed", "Insufficient funds.", 409);
      api.funds[user][body.asset] += delta;
      const result = { operation_id: `operation-${api.receipts.size}`, request_id: body.request_id, kind: body.kind, amount,
        asset: body.asset, currency: body.asset === "stars" ? "Stars" : "LiDollCoin", balance: api.funds[user][body.asset] };
      api.receipts.set(key, { result, body });
      if (body.kind === "debit" && api.afterDebit) await api.afterDebit();
      if (api.loseResponse === body.kind) throw new WalletError("unavailable", "Response lost after commit.");
      return result;
    },
  };
  const f = { api, client, now: 1000 };
  function open(seed = false) {
    f.store = new TouhouStore(path.join(folder, "trader.db"), catalog, { now: () => f.now });
    f.wallet = new WalletService(path.join(folder, "wallet.db"), client, { now: () => f.now });
    if (seed) {
      f.store.ensureGuild("guild");
      f.store.db.prepare("UPDATE characters SET owner_id='alice' WHERE name='Reimu Hakurei'").run();
      f.store.db.prepare("UPDATE characters SET owner_id='bob' WHERE name='Cirno'").run();
      for (const user of ["alice", "bob"]) {
        f.store.db.prepare("INSERT INTO wallets VALUES ('guild',?,123,456)").run(user);
        f.wallet.db.prepare("INSERT INTO online_wallets VALUES (?,?,?,?,?,?)").run(user, `${user}-token`, 1_000_000_000,
          `account-${user}`, client.config.baseUrl, client.config.clientId);
      }
    }
    f.game = new BattleService(f.store, { rng: () => 0 });
    f.adoptions = new OnlineAdoptions(f.store, f.wallet);
    f.economy = new OnlineEconomy(f.store, f.game, f.wallet);
    f.onlineGame = f.economy.facade();
  }
  open(true);
  f.reopen = async () => { await f.wallet.close(); f.store.close(); open(); };
  t.after(async () => { await f.wallet.close(); f.store.close(); rmSync(folder, { recursive: true, force: true }); });
  return f;
} // Give each test distinct online accounts, real persistent game state and an idempotent simulated wallet ledger.

const unchangedLocal = f => {
  for (const user of ["alice", "bob"]) assert.deepEqual(f.store.wallet("guild", user), { stars: 123, coins: 456 });
};

test("potions, paid/free healing and buyback use online coins without touching legacy balances", async t => {
  const f = setup(t);
  const potion = await f.onlineGame.buyPotions("guild", "alice", 2, "potions");
  assert.deepEqual(potion, { count: 2, price: 40 });
  assert.equal(f.api.funds.alice.coins, 460);
  assert.deepEqual(await f.onlineGame.buyPotions("guild", "alice", 2, "potions"), potion);
  const healthy = await f.onlineGame.heal("guild", "alice", "Reimu", false, "free");
  assert.equal(healthy.price, 0);
  f.store.db.prepare("UPDATE battle_profiles SET fainted_until=100000 WHERE name='Reimu Hakurei'").run();
  await assert.rejects(f.onlineGame.heal("guild", "alice", "Reimu", false, "wait"), /Still recovering/);
  const heal = await f.onlineGame.heal("guild", "alice", "Reimu", true, "paid-heal");
  assert.equal(heal.price, 50); assert.equal(f.api.funds.alice.coins, 410);
  const sale = await f.onlineGame.buyback("guild", "alice", "Reimu", "buyback");
  assert.equal(f.api.funds.alice.coins, 410 + sale.payout);
  assert.equal(f.store.character("guild", "Reimu").owner_id, null);
  assert.equal(f.api.funds.alice.stars, 5);
  unchangedLocal(f);
});

test("failed debits and validation errors never deliver potions or use a local balance", async t => {
  const f = setup(t); f.api.funds.alice.coins = 0;
  await assert.rejects(f.onlineGame.buyPotions("guild", "alice", 1, "poor"), /Insufficient/);
  assert.equal(f.game.potions("guild", "alice"), 0);
  assert.equal(f.economy.pending("alice"), undefined);
  await assert.rejects(f.onlineGame.buyPotions("guild", "alice", 11, "over-cap"), /between 1 and 10/);
  assert.equal(f.api.calls.length, 1);
  assert.throws(() => f.game.buyPotions("guild", "alice", 1, "bypass"), /online LiDollcoin payment service/);
  unchangedLocal(f);
});

test("lost potion debit survives restart and blocks adoption until one inventory delivery", async t => {
  const f = setup(t); f.api.loseResponse = "debit";
  await assert.rejects(f.onlineGame.buyPotions("guild", "alice", 1, "lost"), /not confirmed/);
  assert.equal(f.game.potions("guild", "alice"), 0);
  await assert.rejects(f.adoptions.adopt("guild", "alice", "stars", "new-adoption"), /earlier adoption or payment/);
  await assert.rejects(f.wallet.disconnect("alice"), /pending/);
  await f.reopen();
  await f.economy.retry("alice");
  assert.equal(f.game.potions("guild", "alice"), 1);
  assert.equal(f.api.funds.alice.coins, 480);
  assert.equal(f.api.receipts.size, 1);
  unchangedLocal(f);
});

test("changed inventory refunds the exact debit and lost refund responses can be retried", async t => {
  const f = setup(t); f.api.loseResponse = "debit";
  await assert.rejects(f.onlineGame.buyPotions("guild", "alice", 2, "lost"));
  f.store.db.prepare("INSERT INTO battle_inventory VALUES ('guild','alice',10)").run();
  f.api.loseResponse = "refund";
  await assert.rejects(f.economy.retry("alice"), /refund is waiting/);
  await f.reopen();
  await assert.rejects(f.economy.retry("alice"), /full LiDollcoin payment was refunded/);
  assert.equal(f.api.funds.alice.coins, 500);
  assert.equal(f.game.potions("guild", "alice"), 10);
  assert.equal(f.api.receipts.size, 2);
});

test("market sales debit the buyer and pay only the seller's online wallet once", async t => {
  const f = setup(t);
  f.economy.list("guild", "bob", "Cirno", 75, "list");
  const receipt = await f.economy.buy("guild", "alice", "Cirno", "buy", { price: 75, sellerId: "bob" });
  assert.equal(receipt.character.owner_id, "alice");
  assert.equal(receipt.sellerId, "bob");
  assert.deepEqual(f.api.funds, { alice: { coins: 425, stars: 5 }, bob: { coins: 175, stars: 5 } });
  assert.deepEqual(await f.economy.buy("guild", "alice", "Cirno", "buy", { price: 75, sellerId: "bob" }), receipt);
  assert.equal(f.api.receipts.size, 2);
  assert.equal(f.store.character("guild", "Momiji Inubashiri").owner_id, MOMIJI_OWNER_ID);
  unchangedLocal(f);
});

test("pending market debit reserves the character against gifts, repricing and battles", async t => {
  const f = setup(t); f.economy.list("guild", "bob", "Cirno", 50, "list"); f.api.loseResponse = "debit";
  await assert.rejects(f.economy.buy("guild", "alice", "Cirno", "buy"), /not confirmed/);
  assert.equal(f.wallet.hasPending("bob"), true);
  assert.throws(() => f.store.send("guild", "bob", "alice", "Cirno", "gift"), /pending wallet payment/);
  assert.throws(() => f.store.list("guild", "bob", "Cirno", 5, "reprice"), /pending wallet payment/);
  assert.throws(() => f.game.start("guild", "bob", "Cirno", "Common", "battle"), /pending wallet payment/);
  await assert.rejects(f.wallet.disconnect("bob"), /pending/);
  await f.reopen(); await f.economy.retry("bob");
  assert.equal(f.store.character("guild", "Cirno").owner_id, "alice");
  assert.equal(f.api.funds.bob.coins, 150);
  assert.equal(f.api.receipts.size, 2);
});

test("seller payout survives revocation and restart; retry cannot redirect it to a different account", async t => {
  const f = setup(t); f.economy.list("guild", "bob", "Cirno", 50, "list");
  f.api.afterDebit = async () => { f.api.tokens.delete("bob-token"); };
  await assert.rejects(f.economy.buy("guild", "alice", "Cirno", "buy"), /action completed.*payout is saved/);
  assert.equal(f.store.character("guild", "Cirno").owner_id, "alice");
  assert.equal(f.api.funds.alice.coins, 450); assert.equal(f.api.funds.bob.coins, 100);
  await f.reopen();
  f.wallet.db.prepare("UPDATE online_wallets SET account_id='wrong-account' WHERE discord_id='bob'").run();
  await assert.rejects(f.economy.retry("bob"), /original Little Log account/);
  f.wallet.db.prepare("UPDATE online_wallets SET account_id='account-bob' WHERE discord_id='bob'").run();
  f.api.tokens.set("bob-token", "bob");
  await f.economy.retry("bob");
  assert.equal(f.api.funds.bob.coins, 150); assert.equal(f.api.funds.alice.coins, 450);
  assert.equal(f.api.receipts.size, 2);
});

test("buyback commits removal and a durable payout even when the API credit limit is reached", async t => {
  const f = setup(t); f.api.failCredit = true;
  const quote = Math.max(1, Math.floor(f.game.suggestedPrice("guild", "Reimu") * 2 / 3));
  await assert.rejects(f.onlineGame.buyback("guild", "alice", "Reimu", "sell-back"), /payout is saved/);
  assert.equal(f.store.character("guild", "Reimu").owner_id, null);
  assert.equal(f.api.funds.alice.coins, 500);
  await f.reopen(); f.api.failCredit = false;
  await f.economy.retry("alice");
  const replay = await f.onlineGame.buyback("guild", "alice", "Reimu", "sell-back");
  assert.equal(replay.payout, quote); assert.equal(f.api.funds.alice.coins, 500 + quote);
  assert.equal(f.api.receipts.size, 1); unchangedLocal(f);
});

test("battle victory and EXP persist across a lost payout response without rerolling or double rewards", async t => {
  const f = setup(t);
  const start = f.onlineGame.start("guild", "alice", "Reimu", "Common", "start");
  const row = f.store.db.prepare("SELECT state FROM battles WHERE id=?").get(start.id), state = JSON.parse(row.state);
  state.enemy.hp = 1;
  f.store.db.prepare("UPDATE battles SET state=? WHERE id=?").run(JSON.stringify(state), start.id);
  f.api.loseResponse = "credit";
  await assert.rejects(f.onlineGame.act("guild", "alice", start.id, 0, "attack0", "winning-turn"), /payout is saved/);
  const won = f.game.get("guild", "alice", start.id);
  assert.equal(won.outcome, "victory"); assert.equal(won.reward.payment, "pending");
  const profile = f.game.profile("guild", "Reimu"); assert.equal(profile.wins, 1);
  const balance = f.api.funds.alice.coins;
  await f.reopen(); await f.economy.retry("alice");
  assert.equal(f.game.get("guild", "alice", start.id).reward.payment, "paid");
  assert.deepEqual(f.game.profile("guild", "Reimu"), profile);
  assert.equal(f.api.funds.alice.coins, balance); assert.equal(f.api.receipts.size, 1);
  await f.onlineGame.act("guild", "alice", start.id, 0, "attack0", "winning-turn");
  assert.equal(f.api.funds.alice.coins, balance); unchangedLocal(f);
});

test("storage failure after a debit leaves a paid job for retry and no partially delivered items", async t => {
  const f = setup(t);
  f.api.afterDebit = async () => f.store.db.exec("CREATE TRIGGER fail_potions BEFORE INSERT ON battle_inventory BEGIN SELECT RAISE(ABORT, 'disk failure'); END;");
  await assert.rejects(f.onlineGame.buyPotions("guild", "alice", 1, "disk"), /disk failure/);
  assert.equal(f.game.potions("guild", "alice"), 0);
  assert.equal(f.economy.pending("alice").state, "paid");
  f.store.db.exec("DROP TRIGGER fail_potions");
  await f.reopen(); await f.economy.retry("alice");
  assert.equal(f.game.potions("guild", "alice"), 1);
  assert.equal(f.api.receipts.size, 1);
});

test("a seller wallet must be connected before debiting a buyer; quote changes and self-purchases fail", async t => {
  const f = setup(t); f.economy.list("guild", "bob", "Cirno", 50, "list");
  await assert.rejects(f.economy.buy("guild", "alice", "Cirno", "stale", { price: 1, sellerId: "bob" }), /listing changed/);
  await assert.rejects(f.economy.buy("guild", "bob", "Cirno", "self"), /own listing/);
  await f.wallet.disconnect("bob");
  await assert.rejects(f.economy.buy("guild", "alice", "Cirno", "unlinked"), /Connect your Little Log/);
  assert.equal(f.api.calls.length, 0); assert.equal(f.economy.pending("alice"), undefined);
  assert.equal(f.store.character("guild", "Cirno").owner_id, "bob");
});

test("an in-flight sale locks both wallets before awaiting the debit and releases them afterward", async t => {
  const f = setup(t); f.economy.list("guild", "bob", "Cirno", 50, "list");
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  f.api.afterDebit = async () => { entered(); await new Promise(resolve => { release = resolve; }); };
  const purchase = f.economy.buy("guild", "alice", "Cirno", "concurrent");
  await started;
  try {
    await assert.rejects(f.wallet.disconnect("bob"), /Another wallet action/);
    await assert.rejects(f.onlineGame.buyPotions("guild", "alice", 1, "other"), /Another wallet action/);
    await assert.rejects(f.wallet.exclusive("bob", async () => {}), /Another wallet action/);
  } finally { release(); }
  await purchase;
  assert.equal(f.wallet.locks.size, 0);
  assert.equal(f.api.receipts.size, 2); assert.equal(f.store.character("guild", "Cirno").owner_id, "alice");
});

test("disabling online payments preserves unresolved character and currency locks", async t => {
  const f = setup(t); f.economy.list("guild", "bob", "Cirno", 50, "list"); f.api.loseResponse = "debit";
  await assert.rejects(f.economy.buy("guild", "alice", "Cirno", "offline"));
  const offline = new TouhouStore(path.join(f.store.db.name), catalog);
  try {
    assert.throws(() => offline.buy("guild", "alice", "Cirno", "legacy-buy"), /pending wallet payment/);
    assert.throws(() => offline.award("guild", "admin", "bob", "coins", 10, "legacy-award"), /pending online payment/);
    assert.throws(() => offline.adopt("guild", "alice", "stars", "legacy-adopt"), /pending online payment/);
  } finally { offline.close(); }
  await f.economy.retry("bob");
  unchangedLocal(f);
});

function interaction(action, values = {}, extra = {}) {
  return { id: `command-${action}`, guildId: "guild", channelId: "channel", user: { id: "alice" }, commandName: "touhou",
    guild: { members: { fetch: async id => ({ id, user: { id } }) } }, memberPermissions: new PermissionsBitField(),
    isChatInputCommand: () => true, isButton: () => false,
    options: { getSubcommand: () => action, getUser: key => values[key] || null, getString: key => values[key] || null,
      getInteger: key => values[key] || null, getBoolean: key => values[key] || false },
    async deferReply() { this.deferred = true; }, async deferUpdate() { this.deferred = true; },
    async editReply(body) { this.output = body; }, async reply(body) { this.output = body; }, ...extra };
}

test("slash awards retain permission checks and pay coins to the approved recipient", async t => {
  const f = setup(t), handlers = createTouhouHandlers(f.store, { wallet: f.wallet, adoptions: f.adoptions });
  const values = { user: { id: "bob" }, currency: "coins", amount: 25 };
  const denied = interaction("award", values); await handlers.handleInteraction(denied);
  assert.match(denied.output.content, /need Manage Server/); assert.equal(f.api.receipts.size, 0);
  const allowed = interaction("award", values, { memberPermissions: new PermissionsBitField(PermissionFlagsBits.ManageGuild) });
  await handlers.handleInteraction(allowed); assert.match(allowed.output.content, /Awarded/);
  assert.equal(f.api.funds.bob.coins, 125); assert.equal(f.api.funds.alice.coins, 500);
  const stars = interaction("award", { ...values, currency: "stars" }, { id: "star-award", memberPermissions: allowed.memberPermissions });
  await handlers.handleInteraction(stars); assert.match(stars.output.content, /Admin awards use LiDollcoins/);
  unchangedLocal(f);
});

test("slash potion, heal, buyback and buy commands route through online payments", async t => {
  const f = setup(t), handlers = createTouhouHandlers(f.store, { wallet: f.wallet, adoptions: f.adoptions });
  const potion = interaction("potions", { amount: 1 }); await handlers.handleInteraction(potion);
  assert.match(potion.output.content, /Bought potions/); assert.equal(f.api.funds.alice.coins, 480);
  f.game.profile("guild", "Reimu"); f.store.db.prepare("UPDATE battle_profiles SET fainted_until=100000 WHERE name='Reimu Hakurei'").run();
  const heal = interaction("heal", { name: "Reimu", pay: true }); await handlers.handleInteraction(heal);
  assert.match(heal.output.content, /Healing cost/); assert.equal(f.api.funds.alice.coins, 430);
  f.wallet.economy.list("guild", "bob", "Cirno", 50, "list");
  const buy = interaction("buy", { name: "Cirno" }); await handlers.handleInteraction(buy);
  assert.equal(f.api.funds.alice.coins, 380); assert.equal(f.api.funds.bob.coins, 150);
  const back = interaction("buyback", { name: "Cirno", confirm: true }); await handlers.handleInteraction(back);
  assert.match(back.output.content, /Returned/); assert.ok(f.api.funds.alice.coins > 380); unchangedLocal(f);
});

test("clickable shop payments and payout recovery use online coins and never display legacy balances", async t => {
  const f = setup(t), menus = new TouhouMenus(f.store, f.onlineGame, { wallet: f.wallet, economy: f.economy,
    adopt: (...args) => f.adoptions.adopt(...args) });
  let body = menus.open("guild", "alice");
  async function click(action, values) {
    const button = body.components.flatMap(r => r.toJSON().components).find(c => c.custom_id.endsWith(`:${action}`));
    assert.ok(button, `Missing ${action}`);
    const i = interaction("button", {}, { isChatInputCommand: () => false, customId: button.custom_id, values });
    await menus.handle(i); body = i.output;
    assert.doesNotMatch(body.embeds[0].toJSON().description, /456|local coins/);
  }
  await click("shop"); await click("potions"); await click("potion1");
  assert.equal(f.api.funds.alice.coins, 480); assert.equal(f.game.potions("guild", "alice"), 1);
  f.game.profile("guild", "Reimu");
  f.store.db.prepare("UPDATE battle_profiles SET fainted_until=100000 WHERE name='Reimu Hakurei'").run();
  await click("home"); await click("heal"); await click("pick", ["0"]); await click("confirm");
  assert.equal(f.api.funds.alice.coins, 430);
  f.economy.list("guild", "bob", "Cirno", 50, "menu-list");
  await click("listings"); await click("listing-pick", ["0"]); await click("confirm");
  assert.equal(f.api.funds.alice.coins, 380); assert.equal(f.api.funds.bob.coins, 150);
  await click("buyback"); await click("pick", ["0"]);
  f.api.loseResponse = "credit"; await click("confirm");
  assert.match(body.embeds[0].toJSON().description, /payout is saved/);
  const balance = f.api.funds.alice.coins;
  // The normal account retry command can finish a menu action even after the menu itself expired.
  const retry = interaction("retry", {}, { commandName: "lidollid" }); retry.options.getSubcommandGroup = () => "wallet";
  await handleWalletInteraction(retry, f.wallet, {});
  assert.match(retry.output.content, /payment completed/); assert.equal(f.api.funds.alice.coins, balance);
  unchangedLocal(f);
});

test("clickable battles and the menu retry button settle a saved victory payout", async t => {
  const f = setup(t), menus = new TouhouMenus(f.store, f.onlineGame, { wallet: f.wallet, economy: f.economy });
  let body = menus.open("guild", "alice");
  async function click(action, values) {
    const control = body.components.flatMap(r => r.toJSON().components).find(c => c.custom_id.endsWith(`:${action}`));
    assert.ok(control, `Missing ${action}`);
    const i = interaction("button", {}, { isChatInputCommand: () => false, customId: control.custom_id, values });
    await menus.handle(i); body = i.output;
  }
  await click("battle"); await click("pick", ["0"]); await click("difficulty", ["Common"]);
  const battle = f.game.current("guild", "alice");
  const state = JSON.parse(f.store.db.prepare("SELECT state FROM battles WHERE id=?").get(battle.id).state); state.enemy.hp = 1;
  f.store.db.prepare("UPDATE battles SET state=? WHERE id=?").run(JSON.stringify(state), battle.id);
  f.api.loseResponse = "credit";
  await click("attack0"); assert.match(body.embeds[0].toJSON().description, /Online payout:.*waiting/);
  const balance = f.api.funds.alice.coins;
  await click("home"); await click("retry-payment");
  assert.match(body.embeds[0].toJSON().description, /payment completed/);
  assert.equal(f.api.funds.alice.coins, balance);
  assert.equal(f.game.get("guild", "alice", battle.id).reward.payment, "paid");
});
