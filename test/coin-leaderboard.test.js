import assert from "node:assert/strict";
import test from "node:test";
import { IdentityStore } from "../src/auth/store.js";
import { WalletService } from "../src/wallet/service.js";
import { CoinLeaderboard, createLeaderboardWeb } from "../src/leaderboard/web.js";
import { createAuthServer } from "../src/auth/server.js";

function fixture(t) {
  let now = 1000;
  const identities = new IdentityStore(":memory:");
  const balances = new Map(), reads = [];
  const wallet = new WalletService(":memory:", { config: { baseUrl: "https://wallet.example/", clientId: "bot" },
    async balance(token) {
      reads.push(token);
      const coins = balances.get(token);
      if (coins === undefined) throw new Error("SECRET provider body");
      return { accountId: token, coins, stars: 999, diamonds: 777 };
    },
  }, { now: () => now });
  wallet.identityFor = user => identities.gameIdentity(user);
  const register = (id, username, coins, subject = id, web = false) => {
    identities.db.prepare(`INSERT INTO ${web ? "web_game_accounts" : "identity_links"} VALUES (?,?,?,?,?)`).run(id, "issuer", subject, username, now);
    if (coins !== undefined) {
      balances.set(id, coins);
      wallet.db.prepare("INSERT INTO online_wallets VALUES (?,?,?,?,?,?)").run(id, id, 9_000_000, id, "https://wallet.example/", "bot");
      wallet.db.prepare("INSERT INTO wallet_identity_links VALUES (?,?,?)").run(id, "issuer", subject);
    }
  }; // Use only disposable identities and fake coins, including production wallet validation.
  t.after(async () => { await wallet.close(); identities.close(); });
  return { identities, wallet, balances, reads, register, advance: ms => { now += ms; },
    leaderboard: new CoinLeaderboard(identities, wallet, { now: () => now }) };
}

test("leaderboard includes all registrations, deduplicates identities, ranks ties and preserves unavailable wallets", async t => {
  const f = fixture(t);
  f.register("alice", "Alice", 50);
  f.register("bob", "Bob", 50);
  f.register("empty", "Empty", 0);
  f.register("missing", "Missing");
  f.register("broken", "Broken", 8); f.balances.delete("broken");
  f.register("web_first", "Web girl", 100, "shared", true);
  f.register("linked", "Web girl", undefined, "shared");
  f.identities.begin("unfinished");
  const data = await f.leaderboard.snapshot();
  assert.deepEqual(data.entries.map(e => [e.username, e.coins, e.rank]), [
    ["Web girl", 100, 1], ["Alice", 50, 2], ["Bob", 50, 2], ["Empty", 0, 4], ["Broken", null, null], ["Missing", null, null],
  ]);
  assert.equal(data.entries.at(-1).checkedAt, null);
  for (const entry of data.entries) assert.deepEqual(Object.keys(entry).sort(), ["checkedAt", "coins", "rank", "username"]);
  assert.doesNotMatch(JSON.stringify(data), /SECRET|issuer|subject|accountId|token|stars|diamonds|unfinished/);
});

test("cached reads coalesce visitors, expire after a minute and respond to renames and removed registrations", async t => {
  const f = fixture(t); f.register("alice", "Alice", 20);
  await Promise.all(Array.from({ length: 12 }, () => f.leaderboard.snapshot()));
  assert.equal(f.reads.length, 1);
  f.balances.set("alice", 40);
  assert.equal((await f.leaderboard.snapshot()).entries[0].coins, 20);
  f.identities.db.prepare("UPDATE identity_links SET username=?").run("Renamed");
  assert.equal((await f.leaderboard.snapshot()).entries[0].username, "Renamed");
  f.advance(60_000);
  assert.equal((await f.leaderboard.snapshot()).entries[0].coins, 40);
  f.identities.unlink("alice");
  assert.deepEqual((await f.leaderboard.snapshot()).entries, []);
});

test("wallet read rejects revoked, replaced and mismatched accounts while never holding a payment lock", async t => {
  const f = fixture(t); f.register("alice", "Alice", 10);
  let release;
  f.wallet.client.balance = async () => {
    assert.equal(f.wallet.locks.size, 0);
    await new Promise(resolve => { release = resolve; });
    return { accountId: "alice", coins: 10 };
  };
  let pending = f.wallet.readBalance("alice");
  f.wallet.db.prepare("UPDATE online_wallets SET token='replacement'").run();
  release(); await assert.rejects(pending, /did not match/);
  pending = f.wallet.readBalance("alice");
  f.wallet.db.prepare("DELETE FROM online_wallets").run();
  release(); await assert.rejects(pending, /Connect your/);
  f.register("bob", "Bob", 5);
  f.wallet.client.balance = async () => ({ accountId: "wrong", coins: 200 });
  await assert.rejects(f.wallet.readBalance("bob"), /did not match/);
});

test("a registration removed during a slow provider read cannot appear in the response", async t => {
  const f = fixture(t); f.register("alice", "Alice", 10);
  let release;
  f.wallet.client.balance = () => new Promise(resolve => { release = () => resolve({ accountId: "alice", coins: 10 }); });
  const pending = f.leaderboard.snapshot();
  f.identities.unlink("alice"); release();
  assert.deepEqual((await pending).entries, []);
});

test("a changing roster still shares one refresh across waiting visitors", async t => {
  const f = fixture(t); f.register("alice", "Alice", 10);
  let release, reads = 0;
  f.wallet.client.balance = async token => {
    reads++;
    if (reads === 1) await new Promise(resolve => { release = resolve; });
    return { accountId: token, coins: f.balances.get(token) };
  };
  const first = f.leaderboard.snapshot();
  f.register("bob", "Bob", 20);
  const waiting = Array.from({ length: 10 }, () => f.leaderboard.snapshot());
  release();
  for (const result of await Promise.all([first, ...waiting])) assert.equal(result.entries.length, 2);
  assert.equal(reads, 3, "One initial read and one shared two-account refresh");
});

test("the full list has no top-player cutoff and provider requests have bounded concurrency", async t => {
  const f = fixture(t);
  for (let i = 0; i < 65; i++) f.register(`user${i}`, `Player ${i}`, i);
  let active = 0, maximum = 0;
  f.wallet.client.balance = async token => {
    active++; maximum = Math.max(maximum, active);
    await new Promise(resolve => setImmediate(resolve)); active--;
    return { accountId: token, coins: f.balances.get(token) };
  };
  assert.equal((await f.leaderboard.snapshot()).entries.length, 65);
  assert.equal(maximum, 4);
});

test("production HTTP composition serves the public page and safe API, rejects mutations and unknown assets", async t => {
  const f = fixture(t); f.register("alice", '<img src=x onerror="alert(1)">', 1234);
  const config = { origin: "http://127.0.0.1", issuer: "https://identity.example" };
  const server = createAuthServer(config, f.identities, {}, f.wallet, createLeaderboardWeb(config, f.leaderboard));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  config.origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  for (const path of ["/leaderboard", "/leaderboard/", "/leaderboard/index.html", "/leaderboard/style.css", "/leaderboard/app.js"]) {
    const response = await fetch(config.origin + path);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-security-policy"), /default-src 'none'/);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  const head = await fetch(config.origin + "/leaderboard/api/balances", { method: "HEAD" });
  assert.equal(head.status, 200); assert.equal(await head.text(), ""); assert.equal(f.reads.length, 0);
  const response = await fetch(config.origin + "/leaderboard/api/balances");
  assert.match(response.headers.get("content-type"), /application\/json/);
  assert.equal((await response.json()).entries[0].coins, 1234);
  assert.equal((await fetch(config.origin + "/leaderboard/api/balances", { method: "POST" })).status, 405);
  assert.equal((await fetch(config.origin + "/leaderboard/private.db")).status, 404);
  assert.equal((await fetch(config.origin + "/")).status, 200);
  f.identities.leaderboardAccounts = () => { throw new Error("SECRET database details"); };
  const failure = await fetch(config.origin + "/leaderboard/api/balances");
  assert.equal(failure.status, 503); assert.doesNotMatch(await failure.text(), /SECRET/);
});
