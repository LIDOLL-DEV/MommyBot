import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WalletService } from "../src/wallet/service.js";
import { WalletError } from "../src/wallet/client.js";
import { runWalletAction } from "../src/wallet/commands.js";

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "mommybot-transfers-")), filename = join(dir, "wallet.db");
  const api = { config: { baseUrl: "https://wallet.example/", clientId: "bot" },
    balances: { alice: { coins: 100, diamonds: 30, stars: 5 }, bob: { coins: 10, diamonds: 2, stars: 8 } },
    receipts: new Map(), calls: [], reject: {}, lose: {}, bad: {} };
  api.balance = async token => ({ accountId: token, ...api.balances[token], diamondsEnabled: api.diamondsEnabled !== false });
  api.operation = async (token, body) => {
    api.calls.push({ token, ...body });
    if (api.reject[body.kind]) throw api.reject[body.kind];
    const key = `${token}:${body.request_id}`;
    let receipt = api.receipts.get(key);
    if (!receipt) {
      const amount = body.kind === "refund" ? api.receipts.get(`${token}:${body.original_id}`).amount : body.amount;
      const balance = api.balances[token][body.asset] + (body.kind === "debit" ? -amount : amount);
      if (balance < 0) throw new WalletError("insufficient_funds", "Insufficient funds", 409);
      api.balances[token][body.asset] = balance;
      receipt = { ...body, amount, balance, currency: body.asset === "diamonds" ? "Diamonds" : "LiDollCoin" };
      api.receipts.set(key, receipt);
    }
    if (api.lose[body.kind]) throw new Error("PRIVATE response body");
    return api.bad[body.kind] ? { ...receipt, amount: receipt.amount + 1 } : receipt;
  }; // Simulate atomic relative operations and provider idempotency without touching real accounts.
  const f = { api, wallet: new WalletService(filename, api) };
  for (const user of ["alice", "bob"]) f.wallet.db.prepare("INSERT INTO online_wallets VALUES (?,?,?,?,?,?)")
    .run(user, user, Date.now() + 86400000, user, api.config.baseUrl, api.config.clientId);
  f.send = (asset = "coins", id = "100") => f.wallet.transfers.send("guild", "alice", "bob", asset, 20, id);
  f.restart = async () => { await f.wallet.close(); f.wallet = new WalletService(filename, api); };
  t.after(async () => { await f.wallet.close(); rmSync(dir, { recursive: true, force: true }); });
  return f;
}

test("players transfer their own coins and diamonds exactly once without changing stars", async t => {
  const f = fixture(t);
  for (const [asset, id] of [["coins", "100"], ["diamonds", "101"]]) {
    assert.equal((await f.send(asset, id)).state, "done");
    assert.equal((await f.send(asset, id)).state, "done");
  }
  assert.deepEqual(f.api.balances, { alice: { coins: 80, diamonds: 10, stars: 5 }, bob: { coins: 30, diamonds: 22, stars: 8 } });
  assert.deepEqual(f.api.calls.map(c => [c.token, c.kind, c.asset]), [
    ["alice", "debit", "coins"], ["bob", "credit", "coins"], ["alice", "debit", "diamonds"], ["bob", "credit", "diamonds"],
  ]);
  await assert.rejects(f.wallet.transfers.send("guild", "alice", "bob", "coins", 19, "100"), /different transfer/);
});

test("invalid amounts, stars, self transfers, missing grants, same wallets and diamond scope cannot debit", async t => {
  const f = fixture(t);
  for (const [recipient, asset, amount] of [["bob", "stars", 1], ["alice", "coins", 1], ["bob", "coins", 0], ["bob", "coins", -1], ["bob", "coins", 1.5], ["bob", "coins", 1000001]]) {
    await assert.rejects(f.wallet.transfers.send("guild", "alice", recipient, asset, amount, "100"), /Stars cannot be sent/);
  }
  f.api.diamondsEnabled = false; await assert.rejects(f.send("diamonds"), /approve diamond access/);
  await assert.rejects(f.wallet.transfers.send("guild", "alice", "bob", "coins", 101, "100"), /enough coins/);
  f.wallet.db.prepare("UPDATE online_wallets SET account_id='alice' WHERE discord_id='bob'").run();
  await assert.rejects(f.send(), /different wallet/);
  f.wallet.db.prepare("DELETE FROM online_wallets WHERE discord_id='bob'").run();
  await assert.rejects(f.send(), /Connect your/);
  assert.equal(f.api.calls.length, 0);
  assert.equal(f.wallet.db.prepare("SELECT COUNT(*) n FROM wallet_transfers").get().n, 0);
});

test("lost debit or credit responses survive restart and either participant recovers without duplication", async t => {
  for (const kind of ["debit", "credit"]) await t.test(kind, async t => {
    const f = fixture(t); f.api.lose[kind] = true;
    await assert.rejects(f.send("diamonds"), /unconfirmed/);
    assert.equal(f.api.balances.alice.diamonds, 10);
    for (const user of ["alice", "bob"]) {
      assert.equal(f.wallet.hasPending(user), true);
      await assert.rejects(f.wallet.disconnect(user), /pending/);
    }
    await f.restart();
    await assert.rejects(f.wallet.transfers.send("guild", "bob", "alice", "coins", 1, "101"), /pending wallet/);
    await assert.rejects(f.wallet.transfers.retry("mallory"), /no pending/);
    f.api.lose[kind] = false;
    assert.equal((await f.wallet.transfers.retry(kind === "debit" ? "alice" : "bob")).state, "done");
    assert.equal(f.api.balances.alice.diamonds, 10); assert.equal(f.api.balances.bob.diamonds, 22);
    assert.equal(f.api.receipts.size, 2); assert.equal(f.wallet.hasPending("alice"), false);
  });
});

test("a refused debit releases reservations; a refused first credit refunds the sender including daily-limit failures", async t => {
  const f = fixture(t);
  f.api.reject.debit = new WalletError("insufficient_funds", "Insufficient funds", 409);
  await assert.rejects(f.send(), /Insufficient funds/);
  assert.equal(f.wallet.hasPending("alice"), false); assert.equal(f.wallet.hasPending("bob"), false);
  delete f.api.reject.debit;
  f.api.reject.credit = new WalletError("daily_limit", "Daily limit reached", 429);
  assert.equal((await f.send("diamonds", "101")).state, "refunded");
  assert.equal(f.api.balances.alice.diamonds, 30); assert.equal(f.api.balances.bob.diamonds, 2);
  assert.equal((await f.send("diamonds", "101")).state, "refunded");
  assert.equal(f.api.calls.filter(c => c.kind === "refund").length, 1);
});

test("a later definitive rejection never cancels or refunds an earlier uncertain debit or credit", async t => {
  for (const kind of ["debit", "credit"]) await t.test(kind, async t => {
    const f = fixture(t); f.api.lose[kind] = true;
    await assert.rejects(f.send(), /unconfirmed/);
    delete f.api.lose[kind]; f.api.reject[kind] = new WalletError("insufficient_scope", "Access refused", 403);
    await assert.rejects(f.wallet.transfers.retry("bob"), /unconfirmed/);
    assert.equal(f.wallet.hasPending("alice"), true);
    assert.equal(f.api.calls.some(c => c.kind === "refund"), false);
    delete f.api.reject[kind]; await f.wallet.transfers.retry("alice");
    assert.equal(f.api.balances.alice.coins, 80); assert.equal(f.api.balances.bob.coins, 30);
  });
});

test("lost refunds retry the original debit and never credit the recipient", async t => {
  const f = fixture(t);
  f.api.reject.credit = new WalletError("insufficient_scope", "Access refused", 403); f.api.lose.refund = true;
  await assert.rejects(f.send(), /refund is pending/);
  assert.equal(f.api.balances.alice.coins, 100);
  await f.restart(); delete f.api.lose.refund;
  assert.equal((await f.wallet.transfers.retry("bob")).state, "refunded");
  assert.equal(f.api.balances.alice.coins, 100); assert.equal(f.api.balances.bob.coins, 10);
  const refunds = f.api.calls.filter(c => c.kind === "refund");
  assert.equal(refunds[0].request_id, refunds[1].request_id);
  assert.equal(refunds[0].original_id, f.api.calls[0].request_id);
});

test("malformed receipts and storage failures after provider success preserve the exact payment for recovery", async t => {
  for (const state of ["debit", "credit"]) await t.test(state, async t => {
    const f = fixture(t); f.api.bad[state] = true;
    await assert.rejects(f.send(), /unconfirmed/);
    delete f.api.bad[state];
    const next = state === "debit" ? "credit" : "done";
    f.wallet.db.exec(`CREATE TRIGGER fail_save BEFORE UPDATE OF state ON wallet_transfers WHEN NEW.state='${next}' BEGIN SELECT RAISE(ABORT,'fixture storage failure'); END;`);
    await assert.rejects(f.wallet.transfers.retry("alice"), /fixture storage/);
    assert.equal(f.wallet.hasPending("bob"), true);
    f.wallet.db.exec("DROP TRIGGER fail_save"); await f.wallet.transfers.retry("alice");
    assert.equal(f.api.balances.alice.coins, 80); assert.equal(f.api.balances.bob.coins, 30);
    assert.equal(f.api.receipts.size, 2);
  });
});

test("both wallet accounts and the provider registration remain pinned across retries", async t => {
  const f = fixture(t); f.api.lose.debit = true;
  await assert.rejects(f.send(), /unconfirmed/); delete f.api.lose.debit;
  const calls = f.api.calls.length;
  for (const user of ["alice", "bob"]) {
    f.wallet.db.prepare("UPDATE online_wallets SET account_id='replacement' WHERE discord_id=?").run(user);
    await assert.rejects(f.wallet.transfers.retry("alice"), /original wallet/);
    f.wallet.db.prepare("UPDATE online_wallets SET account_id=? WHERE discord_id=?").run(user, user);
  }
  f.api.config.baseUrl = "https://different.example/";
  await assert.rejects(f.wallet.transfers.retry("alice"), /different API/);
  assert.equal(f.api.calls.length, calls);
});

test("concurrent transfers lock both players before any asynchronous balance request", async t => {
  const f = fixture(t); let release;
  f.api.balance = token => new Promise(resolve => {
    if (token === "alice") release = () => resolve({ accountId: token, ...f.api.balances[token], diamondsEnabled: true });
    else resolve({ accountId: token, ...f.api.balances[token], diamondsEnabled: true });
  });
  const first = f.send();
  await assert.rejects(f.send("coins", "101"), /Another wallet action/);
  await assert.rejects(f.wallet.transfers.send("guild", "bob", "alice", "coins", 1, "102"), /Another wallet action/);
  release(); await first; assert.equal(f.api.receipts.size, 2);
});

test("shared menu dispatcher permits ordinary sends, rejects bots/unlinked users and stars, and retries privately", async t => {
  const f = fixture(t), identities = { get: user => ["alice", "bob"].includes(user) ? { username: user } : null };
  const event = { id: "100", guildId: "guild", user: { id: "alice" }, memberPermissions: { has: () => false } };
  const options = { getUser: () => ({ id: "bob" }), getString: () => "coins", getInteger: () => 20 };
  for (const [override, input] of [[{ guildId: null }, options], [{ user: { id: "unlinked" } }, options], [{}, { ...options, getUser: () => ({ id: "bob", bot: true }) }], [{}, { ...options, getString: () => "stars" }]]) {
    assert.doesNotMatch((await runWalletAction({ ...event, ...override }, f.wallet, identities, "send", input)).content, /Transfer completed/);
  }
  assert.equal(f.api.calls.length, 0);
  f.api.lose.credit = true;
  assert.match((await runWalletAction(event, f.wallet, identities, "send", options)).content, /unconfirmed/);
  delete f.api.lose.credit;
  const result = await runWalletAction({ ...event, user: { id: "bob" } }, f.wallet, identities, "retry");
  assert.match(result.content, /20 LiDollcoins.*alice.*bob/);
  assert.doesNotMatch(result.content, /PRIVATE|80|30|token/);
});
