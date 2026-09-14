import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PermissionFlagsBits } from "discord.js";
import { WalletService } from "../src/wallet/service.js";
import { WalletError } from "../src/wallet/client.js";
import { handleWalletInteraction } from "../src/wallet/commands.js";
import { buildIdentityCommand } from "../src/auth/index.js";
import { canAward } from "../src/permissions.js";

function fixture(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "mommybot-gifts-"));
  const filename = path.join(directory, "wallet.db");
  const api = { config: { baseUrl: "https://wallet.example/v1/", clientId: "lidollbot" },
    coins: 0, stars: 0, diamonds: 0, receipts: new Map(), calls: [] };
  api.operation = async (token, body) => {
    assert.equal(token, "recipient-token");
    api.calls.push({ ...body });
    if (api.reject) throw api.reject;
    let receipt = api.receipts.get(body.request_id);
    if (!receipt) {
      assert.equal(body.kind, "credit");
      api[body.asset] += body.amount;
      receipt = { ...body, balance: api[body.asset], currency: body.asset === "diamonds" ? "Diamonds" : body.asset === "stars" ? "Stars" : "LiDollCoin" };
      api.receipts.set(body.request_id, receipt);
    }
    if (api.loseResponse) throw new Error("PRIVATE provider data");
    return api.badReceipt ? { ...receipt, currency: "Wrong" } : receipt;
  };
  const state = { api, wallet: new WalletService(filename, api) };
  state.wallet.db.prepare("INSERT INTO online_wallets VALUES (?,?,?,?,?,?)")
    .run("recipient", "recipient-token", Date.now() + 86400000, "account", api.config.baseUrl, api.config.clientId);
  state.restart = async () => { await state.wallet.close(); state.wallet = new WalletService(filename, api); };
  t.after(async () => { await state.wallet.close(); rmSync(directory, { recursive: true, force: true }); });
  return state;
} // Exercise durable SQLite recovery with an idempotent provider and no real wallet credentials.

function interaction(command = "gift", { admin = true, guild = "guild", user = "admin", target = "recipient", bot = false, currency = "coins", amount = 12, id = "100" } = {}) {
  return { id, guildId: guild, user: { id: user }, commandName: "lidollid", isChatInputCommand: () => true,
    memberPermissions: { has: permission => admin && permission === PermissionFlagsBits.ManageGuild },
    options: { getSubcommandGroup: () => "wallet", getSubcommand: () => command,
      getUser: () => ({ id: target, bot }), getString: () => currency, getInteger: () => amount },
    async deferReply(value) { this.deferred = value; }, async editReply(value) { this.response = value; } };
} // Supply only trusted Discord fields consumed by the command handler.

const identities = { get: () => ({ subject: "linked" }) };

test("gift command registers both currencies, bounds and an administrator retry", () => {
  const command = buildIdentityCommand().toJSON();
  const group = command.options.find(option => option.name === "wallet");
  const gift = group.options.find(option => option.name === "gift");
  assert.deepEqual(gift.options.find(option => option.name === "currency").choices.map(choice => choice.value), ["coins", "stars", "diamonds"]);
  const amount = gift.options.find(option => option.name === "amount");
  assert.equal(amount.min_value, 1); assert.equal(amount.max_value, 1_000_000);
  assert.ok(group.options.some(option => option.name === "gift-retry"));
});

test("administrators give either currency privately without an administrator wallet or duplicate credit", async t => {
  const f = fixture(t);
  for (const [currency, id] of [["coins", "100"], ["stars", "101"], ["diamonds", "102"]]) {
    const event = interaction("gift", { currency, id });
    await handleWalletInteraction(event, f.wallet, identities);
    assert.match(event.response.content, /Gift completed: \*\*12/);
    assert.deepEqual(event.response.allowedMentions, { parse: [] });
    assert.ok(event.deferred.flags);
    await handleWalletInteraction(event, f.wallet, identities);
    assert.equal(f.api[currency], 12);
  }
  assert.equal(f.api.calls.length, 3);
  const rows = f.wallet.db.prepare("SELECT * FROM wallet_gifts").all();
  assert.ok(rows.every(row => row.actor_id === "admin" && row.guild_id === "guild" && row.user_id === "recipient" && row.state === "done"));
});

test("ordinary users, DMs, bots and unlinked recipients cannot receive a new admin gift", async t => {
  const f = fixture(t);
  for (const command of ["gift", "gift-retry"]) {
    for (const options of [{ admin: false }, { guild: null }, { bot: true }]) {
      const event = interaction(command, options);
      await handleWalletInteraction(event, f.wallet, identities);
      assert.doesNotMatch(event.response.content, /Gift completed/);
    }
  }
  const event = interaction();
  await handleWalletInteraction(event, f.wallet, { get: () => null });
  assert.match(event.response.content, /recipient needs to finish/);
  assert.equal(f.api.calls.length, 0);
  assert.equal(f.wallet.db.prepare("SELECT COUNT(*) AS n FROM wallet_gifts").get().n, 0);
  assert.equal(canAward({ member: { roles: ["reward-role"] } }, "reward-role"), true);
  assert.equal(canAward({ member: { roles: { cache: new Map([["reward-role", {}]]) } } }, "reward-role"), true);
  assert.equal(canAward({ member: { roles: ["different"] } }, "reward-role"), false);
});

test("lost gift responses survive restart, block unlink and recover once through recipient retry", async t => {
  const f = fixture(t); f.api.loseResponse = true;
  const event = interaction("gift", { currency: "stars" });
  await handleWalletInteraction(event, f.wallet, identities);
  assert.match(event.response.content, /confirmation is pending/);
  assert.doesNotMatch(event.response.content, /PRIVATE/);
  assert.equal(f.api.stars, 12);
  await assert.rejects(f.wallet.disconnect("recipient"), /pending/);
  await f.restart();
  assert.equal(f.wallet.hasPending("recipient"), true);
  await assert.rejects(f.wallet.gifts.gift("guild", "admin", "recipient", "coins", 1, "102"), /pending wallet action/);
  f.api.loseResponse = false;
  const retry = interaction("retry", { user: "recipient", admin: false });
  await handleWalletInteraction(retry, f.wallet, identities);
  assert.match(retry.response.content, /Gift completed/);
  assert.equal(f.api.stars, 12); assert.equal(f.wallet.hasPending("recipient"), false);
  assert.equal(f.api.calls[0].request_id, f.api.calls[1].request_id);
});

test("administrator retry is restricted to the gift server and ordinary users cannot mint or retry others' gifts", async t => {
  const f = fixture(t); f.api.loseResponse = true;
  await assert.rejects(f.wallet.gifts.gift("guild", "admin", "recipient", "coins", 20, "100"), /pending/);
  f.api.loseResponse = false;
  for (const options of [{ guild: "elsewhere" }, { admin: false }]) {
    const event = interaction("gift-retry", options);
    await handleWalletInteraction(event, f.wallet, identities);
    assert.doesNotMatch(event.response.content, /Gift completed/);
  }
  assert.equal(f.api.calls.length, 1);
  const event = interaction("gift-retry", { user: "second-admin" });
  await handleWalletInteraction(event, f.wallet, identities);
  assert.match(event.response.content, /Gift completed/);
  assert.equal(f.api.coins, 20);
});

test("invalid gifts and disconnected recipients never contact the provider", async t => {
  const f = fixture(t);
  for (const amount of [0, -1, 1.5, 1_000_001, NaN]) await assert.rejects(f.wallet.gifts.gift("guild", "admin", "recipient", "coins", amount, "100"), /whole-number/);
  await assert.rejects(f.wallet.gifts.gift("guild", "admin", "recipient", "gems", 1, "100"), /coins, stars or diamonds/);
  await assert.rejects(f.wallet.gifts.gift("guild", "admin", "missing", "coins", 1, "100"), /Connect your/);
  assert.equal(f.api.calls.length, 0);
});

test("daily caps and invalid receipts retain gifts; account and API changes cannot redirect a retry", async t => {
  const f = fixture(t); f.api.reject = new WalletError("daily_limit", "Try again tomorrow.", 429);
  await assert.rejects(f.wallet.gifts.gift("guild", "admin", "recipient", "coins", 15, "100"), /tomorrow/);
  f.api.reject = null; f.api.badReceipt = true;
  await assert.rejects(f.wallet.gifts.retry("recipient"), /unconfirmed gift receipt/);
  assert.equal(f.api.coins, 15);
  f.wallet.db.prepare("UPDATE online_wallets SET account_id='different'").run();
  await assert.rejects(f.wallet.gifts.retry("recipient"), /original wallet account/);
  f.wallet.db.prepare("UPDATE online_wallets SET account_id='account'").run();
  f.api.config.baseUrl = "https://other.example/";
  await assert.rejects(f.wallet.gifts.retry("recipient"), /different API settings/);
  assert.equal(f.api.calls.length, 2);
  f.api.config.baseUrl = "https://wallet.example/v1/"; f.api.badReceipt = false;
  await f.wallet.gifts.retry("recipient");
  assert.equal(f.api.coins, 15);
});

test("definitive first rejection releases the wallet, but a rejection after a lost response remains pending", async t => {
  const f = fixture(t); f.api.reject = new WalletError("denied", "Permission declined.", 403);
  await assert.rejects(f.wallet.gifts.gift("guild", "admin", "recipient", "stars", 5, "100"), /Permission declined/);
  assert.equal(f.wallet.hasPending("recipient"), false);
  await assert.rejects(f.wallet.gifts.gift("guild", "admin", "recipient", "stars", 5, "100"), /rejected without crediting/);
  f.api.reject = null; f.api.loseResponse = true;
  await assert.rejects(f.wallet.gifts.gift("guild", "admin", "recipient", "stars", 5, "101"), /pending/);
  f.api.reject = new WalletError("denied", "Permission declined.", 403);
  await assert.rejects(f.wallet.gifts.retry("recipient"), /pending/);
  assert.equal(f.wallet.hasPending("recipient"), true);
});

test("SQLite completion failures retain the original paid gift for recovery", async t => {
  const f = fixture(t);
  f.wallet.db.exec("CREATE TRIGGER fail_gift BEFORE UPDATE OF state ON wallet_gifts WHEN NEW.state='done' BEGIN SELECT RAISE(FAIL,'fixture disk error'); END");
  await assert.rejects(f.wallet.gifts.gift("guild", "admin", "recipient", "coins", 30, "100"), /pending/);
  f.wallet.db.exec("DROP TRIGGER fail_gift");
  await f.restart(); await f.wallet.gifts.retry("recipient");
  assert.equal(f.api.coins, 30); assert.equal(f.wallet.hasPending("recipient"), false);
});

test("gift creation respects other games' reservations, in-flight locks and interaction identity", async t => {
  const f = fixture(t), previous = f.wallet.hasPending;
  let gamePending = true;
  f.wallet.hasPending = user => gamePending || previous(user);
  await assert.rejects(f.wallet.gifts.gift("guild", "admin", "recipient", "coins", 3, "100"), /pending wallet action/);
  gamePending = false;
  await f.wallet.exclusive("recipient", async () => {
    await assert.rejects(f.wallet.gifts.gift("guild", "admin", "recipient", "coins", 3, "100"), /Another wallet action/);
  });
  assert.equal(f.api.calls.length, 0);
  await f.wallet.gifts.gift("guild", "admin", "recipient", "coins", 3, "100");
  await assert.rejects(f.wallet.gifts.gift("guild", "admin", "recipient", "stars", 3, "100"), /another gift/);
  assert.equal(f.api.calls.length, 1);
});
