import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { TouhouStore } from "../src/touhou/store.js";
import { loadCatalog } from "../src/touhou/catalog.js";

const catalog = Array.from({ length: 12 }, (_, i) => ({ name: `Character ${i}`, filename: `${i}.png`, baseRarity: 0 }));
const create = (context, entries = catalog, options) => {
  const store = new TouhouStore(":memory:", entries, options);
  context.after(() => store.close());
  return store;
}; // Use synthetic collections and disposable balances for every transactional test.
const fund = (store, user = "alice", stars = 10, coins = 500) => {
  if (stars) store.award("guild", "admin", user, "stars", stars, `fund-stars-${user}`);
  if (coins) store.award("guild", "admin", user, "coins", coins, `fund-coins-${user}`);
}; // Credit known test balances through the same ledger path as admin rewards.

test("adoption charges exactly one star OR 25 coins and repeated delivery is idempotent", (context) => {
  const store = create(context);
  fund(store);
  const star = store.adopt("guild", "alice", "stars", "purchase-1");
  assert.equal(star.price, 1);
  assert.deepEqual(store.wallet("guild", "alice"), { stars: 9, coins: 500 });
  assert.deepEqual(store.adopt("guild", "alice", "stars", "purchase-1"), star);
  assert.throws(() => store.adopt("guild", "alice", "coins", "purchase-1"), /already been used/);
  assert.equal(store.collection("guild", "alice").length, 1);
  const coin = store.adopt("guild", "alice", "coins", "purchase-2");
  assert.equal(coin.price, 25);
  assert.notEqual(coin.character.name, star.character.name);
  assert.deepEqual(store.wallet("guild", "alice"), { stars: 9, coins: 475 });
});

test("insufficient selected currency never falls back to spending the other balance", (context) => {
  const store = create(context);
  fund(store, "alice", 0, 24);
  assert.throws(() => store.adopt("guild", "alice", "coins", "coins"), /not have enough/);
  store.award("guild", "admin", "alice", "coins", 100, "extra-coins");
  assert.throws(() => store.adopt("guild", "alice", "stars", "stars"), /not have enough/);
  assert.throws(() => store.adopt("guild", "alice", "__proto__", "invalid"), /Choose/);
  assert.equal(store.collection("guild", "alice").length, 0);
  assert.deepEqual(store.wallet("guild", "alice"), { stars: 0, coins: 124 });
});

test("ownership failure rolls back the debit and receipt so a retry can succeed", (context) => {
  const store = create(context);
  fund(store);
  store.db.exec("CREATE TRIGGER fail_adoption BEFORE UPDATE ON characters BEGIN SELECT RAISE(ABORT, 'simulated disk failure'); END");
  assert.throws(() => store.adopt("guild", "alice", "stars", "retry"), /simulated disk failure/);
  assert.deepEqual(store.wallet("guild", "alice"), { stars: 10, coins: 500 });
  assert.equal(store.collection("guild", "alice").length, 0);
  store.db.exec("DROP TRIGGER fail_adoption");
  store.adopt("guild", "alice", "stars", "retry");
  assert.equal(store.wallet("guild", "alice").stars, 9);
});

test("stock exhaustion and the six-character draw cap do not charge a player", (context) => {
  const store = create(context, catalog.slice(0, 1));
  fund(store);
  store.adopt("guild", "alice", "stars", "last-stock");
  assert.throws(() => store.adopt("guild", "alice", "stars", "empty"), /No Touhous/);
  assert.equal(store.wallet("guild", "alice").stars, 9);
  const full = create(context);
  fund(full);
  for (let i = 0; i < 6; i++) full.adopt("guild", "alice", "stars", `draw-${i}`);
  assert.throws(() => full.adopt("guild", "alice", "coins", "seventh"), /party is full/);
  assert.equal(full.wallet("guild", "alice").coins, 500);
});

test("gifts preserve unique ownership, increase rarity count and invalidate listings", (context) => {
  const store = create(context);
  fund(store);
  const { character } = store.adopt("guild", "alice", "coins", "draw");
  store.list("guild", "alice", character.name, 40, "list");
  const result = store.send("guild", "alice", "bob", character.name, "gift");
  assert.equal(result.character.owner_id, "bob");
  assert.equal(result.character.trade_count, 1);
  assert.equal(store.market("guild").some((entry) => entry.name === character.name), false);
  assert.throws(() => store.send("guild", "alice", "mallory", character.name, "stolen"), /no longer own/);
});

test("swaps require the named recipient, expire and revalidate ownership revisions", (context) => {
  let now = 1000;
  const store = create(context, catalog, { now: () => now });
  fund(store);
  fund(store, "bob");
  const a = store.adopt("guild", "alice", "stars", "a").character;
  const b = store.adopt("guild", "bob", "stars", "b").character;
  const offer = store.offer("guild", "alice", "bob", a.name, b.name, "offer");
  assert.throws(() => store.resolveOffer("guild", "mallory", offer.id, true, "intruder"), /Only the invited/);
  store.send("guild", "alice", "carol", a.name, "out");
  store.send("guild", "carol", "alice", a.name, "back");
  assert.throws(() => store.resolveOffer("guild", "bob", offer.id, true, "stale"), /Ownership changed/);
  const next = store.offer("guild", "alice", "bob", a.name, b.name, "new-offer");
  assert.equal(store.resolveOffer("guild", "bob", next.id, true, "accept").accepted, true);
  assert.equal(store.character("guild", a.name).owner_id, "bob");
  assert.equal(store.character("guild", b.name).owner_id, "alice");
  assert.throws(() => store.resolveOffer("guild", "bob", next.id, true, "accept-again"), /already resolved/);
  const expired = store.offer("guild", "alice", "bob", b.name, a.name, "expires");
  now += 60_000;
  assert.throws(() => store.resolveOffer("guild", "bob", expired.id, true, "too-late"), /expired/);
});

test("marketplace sales settle both wallets and ownership once", (context) => {
  const store = create(context);
  fund(store);
  fund(store, "bob", 0, 50);
  const entry = store.adopt("guild", "alice", "stars", "adopt").character;
  store.list("guild", "alice", entry.name, 50, "list");
  const receipt = store.buy("guild", "bob", entry.name, "buy");
  assert.equal(receipt.character.owner_id, "bob");
  assert.equal(store.wallet("guild", "bob").coins, 0);
  assert.equal(store.wallet("guild", "alice").coins, 550);
  assert.deepEqual(store.buy("guild", "bob", entry.name, "buy"), receipt);
  assert.throws(() => store.buy("guild", "carol", entry.name, "race"), /no longer available/);
});

test("a failed seller credit restores the buyer balance, listing and ownership", (context) => {
  const store = create(context);
  fund(store);
  fund(store, "bob", 0, 50);
  const entry = store.adopt("guild", "alice", "stars", "adopt").character;
  store.list("guild", "alice", entry.name, 50, "list");
  store.db.exec("CREATE TRIGGER fail_credit BEFORE UPDATE ON wallets WHEN NEW.user_id = 'alice' BEGIN SELECT RAISE(ABORT, 'credit unavailable'); END");
  assert.throws(() => store.buy("guild", "bob", entry.name, "buy"), /credit unavailable/);
  assert.equal(store.wallet("guild", "bob").coins, 50);
  assert.equal(store.wallet("guild", "alice").coins, 500);
  assert.equal(store.character("guild", entry.name).owner_id, "alice");
  assert.equal(store.market("guild").find((row) => row.name === entry.name).price, 50);
});

test("declining a swap preserves both owners and resolves the offer", (context) => {
  const store = create(context);
  fund(store);
  fund(store, "bob");
  const a = store.adopt("guild", "alice", "stars", "a").character;
  const b = store.adopt("guild", "bob", "stars", "b").character;
  const offer = store.offer("guild", "alice", "bob", a.name, b.name, "offer");
  assert.equal(store.resolveOffer("guild", "bob", offer.id, false, "decline").accepted, false);
  assert.equal(store.character("guild", a.name).owner_id, "alice");
  assert.equal(store.character("guild", b.name).owner_id, "bob");
  assert.throws(() => store.resolveOffer("guild", "bob", offer.id, true, "late-accept"), /already resolved/);
});

test("Momiji reservation and per-server balances survive reopening the database", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "touhou-test-"));
  const database = path.join(directory, "trader.db");
  const entries = [...catalog, { name: "Momiji Inubashiri", filename: "Momiji.png", baseRarity: 0 }];
  let store = new TouhouStore(database, entries, { reservedOwner: "doll" });
  context.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  fund(store);
  const owned = store.adopt("guild", "alice", "stars", "draw").character;
  assert.equal(store.character("guild", "Momiji").owner_id, "doll");
  assert.throws(() => store.release("guild", "doll", "Momiji", "release"), /stays in Doll/);
  assert.deepEqual(store.wallet("elsewhere", "alice"), { stars: 0, coins: 0 });
  assert.equal(store.character("elsewhere", owned.name).owner_id, null);
  store.close();
  store = new TouhouStore(database, entries, { reservedOwner: "doll" });
  assert.equal(store.wallet("guild", "alice").stars, 9);
  assert.equal(store.character("guild", owned.name).owner_id, "alice");
});

test("the complete ported catalog contains real artwork and unambiguous names", () => {
  const entries = loadCatalog();
  assert.equal(entries.length, 169);
  assert.equal(new Set(entries.map((entry) => entry.name)).size, entries.length);
  assert.ok(entries.some((entry) => entry.name === "Momiji Inubashiri"));
});
