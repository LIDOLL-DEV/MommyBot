import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TouhouStore, MOMIJI_OWNER_ID } from "../src/touhou/store.js";
import { BattleService } from "../src/touhou/battles.js";
import { BATTLE_IDLE_MS, FAINT_DURATION_MS, FALLBACK_ATTACKS, levelThreshold, strike } from "../src/touhou/battleRules.js";

const catalog = ["Reimu Hakurei", "Marisa Kirisame", "Cirno", "Momiji Inubashiri"].map((name) => ({
  name, filename: `${name}.png`, baseRarity: 0, attacks: FALLBACK_ATTACKS,
}));

function setup(context, options = {}) {
  let now = 1000;
  const store = new TouhouStore(":memory:", catalog, { now: () => now });
  context.after(() => store.close());
  store.award("guild", "admin", "alice", "stars", 5, "stars");
  store.award("guild", "admin", "alice", "coins", 500, "coins");
  const fighter = store.adopt("guild", "alice", "stars", "adopt").character;
  const game = new BattleService(store, { rng: options.rng || (() => 0) });
  return { store, game, fighter, advance: (ms) => { now += ms; } };
} // Use deterministic combat and a controllable clock without waiting for real cooldowns.

function editBattle(store, id, edit) {
  const row = store.db.prepare("SELECT state FROM battles WHERE id = ?").get(id);
  const state = JSON.parse(row.state);
  edit(state);
  store.db.prepare("UPDATE battles SET state = ? WHERE id = ?").run(JSON.stringify(state), id);
} // Arrange near-victory and low-health fixtures while exercising real turn settlement afterward.

test("battle ownership, single active fight, stale controls and transfer locks", (context) => {
  const { game, store, fighter } = setup(context);
  assert.throws(() => game.start("guild", "bob", fighter.name, "Common", "steal"), /do not own/);
  assert.throws(() => game.start("guild", "alice", fighter.name, "invalid", "invalid"), /Choose/);
  const fight = game.start("guild", "alice", fighter.name, "Common", "fight");
  assert.throws(() => game.start("guild", "alice", fighter.name, "Common", "second"), /already have/);
  assert.throws(() => store.send("guild", "alice", "bob", fighter.name, "gift"), /Finish or run/);
  assert.throws(() => store.release("guild", "alice", fighter.name, "release"), /Finish or run/);
  assert.throws(() => game.buyback("guild", "alice", fighter.name, "buyback"), /Finish or run/);
  assert.throws(() => game.act("guild", "bob", fight.id, 0, "attack0", "intruder"), /does not belong/);
  const next = game.act("guild", "alice", fight.id, 0, "attack0", "turn");
  assert.equal(next.turn, 1);
  assert.deepEqual(game.act("guild", "alice", fight.id, 0, "attack0", "turn"), next);
  assert.throws(() => game.act("guild", "alice", fight.id, 0, "attack1", "double"), /turn already finished/);
  assert.equal(game.get("guild", "alice", fight.id).turn, 1);
});

test("victory pays once, awards EXP and rolls back completely when a payout fails", (context) => {
  const { game, store, fighter } = setup(context);
  const fight = game.start("guild", "alice", fighter.name, "gamble", "start");
  editBattle(store, fight.id, (state) => { state.enemy.hp = 1; state.player.stats.speed = 999; });
  store.db.exec("CREATE TRIGGER refuse_reward BEFORE UPDATE ON wallets BEGIN SELECT RAISE(ABORT, 'reward unavailable'); END");
  assert.throws(() => game.act("guild", "alice", fight.id, 0, "attack0", "win"), /reward unavailable/);
  assert.equal(game.get("guild", "alice", fight.id).outcome, null);
  assert.equal(game.profile("guild", fighter.name).wins, 0);
  store.db.exec("DROP TRIGGER refuse_reward");
  const win = game.act("guild", "alice", fight.id, 0, "attack0", "win");
  assert.equal(win.outcome, "victory");
  assert.equal(store.wallet("guild", "alice").coins, 500 + win.reward.coins);
  assert.equal(game.profile("guild", fighter.name).wins, 1);
  assert.ok(win.reward.exp > 0);
  game.act("guild", "alice", fight.id, 0, "attack0", "win");
  assert.equal(store.wallet("guild", "alice").coins, 500 + win.reward.coins);
  assert.throws(() => game.act("guild", "alice", fight.id, 1, "attack0", "another-win"), /has ended/);
});

test("potion purchases enforce cost/cap and use consumes a turn only when healing is possible", (context) => {
  const { game, store, fighter } = setup(context);
  game.buyPotions("guild", "alice", 5, "potions");
  assert.equal(store.wallet("guild", "alice").coins, 400);
  assert.throws(() => game.buyPotions("guild", "alice", 6, "too-many"), /at most 10/);
  assert.throws(() => game.buyPotions("guild", "alice", -1, "negative"), /between 1 and 10/);
  const fight = game.start("guild", "alice", fighter.name, "Common", "start");
  assert.throws(() => game.act("guild", "alice", fight.id, 0, "potion", "full"), /full health/);
  assert.equal(game.potions("guild", "alice"), 5);
  editBattle(store, fight.id, (state) => { state.player.hp = 10; });
  const after = game.act("guild", "alice", fight.id, 0, "potion", "drink");
  assert.equal(game.potions("guild", "alice"), 4);
  assert.ok(after.player.hp > 10 && after.player.hp < after.player.stats.hpMax);
  assert.equal(after.turn, 1);
  assert.match(after.log.join("\n"), /Potion restored/);
});

test("defeat and inactivity apply one cooldown; early healing costs 50 and later healing is free", (context) => {
  const { game, store, fighter, advance } = setup(context);
  const fight = game.start("guild", "alice", fighter.name, "Common", "start");
  editBattle(store, fight.id, (state) => { state.player.hp = 1; });
  assert.equal(game.act("guild", "alice", fight.id, 0, "defend", "lose").outcome, "defeat");
  assert.equal(game.profile("guild", fighter.name).losses, 1);
  assert.throws(() => game.start("guild", "alice", fighter.name, "Common", "too-soon"), /recovering/);
  assert.throws(() => game.heal("guild", "alice", fighter.name, false, "free-now"), /Still recovering/);
  assert.equal(game.heal("guild", "alice", fighter.name, true, "paid").price, 50);
  assert.equal(game.heal("guild", "alice", fighter.name, true, "paid-again").price, 0);
  assert.equal(store.wallet("guild", "alice").coins, 450);
  const idle = game.start("guild", "alice", fighter.name, "Common", "idle");
  advance(BATTLE_IDLE_MS);
  assert.equal(game.get("guild", "alice", idle.id).outcome, "timeout");
  game.get("guild", "alice", idle.id);
  assert.equal(game.profile("guild", fighter.name).losses, 2);
  advance(FAINT_DURATION_MS);
  assert.equal(game.heal("guild", "alice", fighter.name, false, "free-later").price, 0);
});

test("run success ends the battle without rewards or fainting; failed escape lets the enemy attack", (context) => {
  const { game, store, fighter } = setup(context);
  const fight = game.start("guild", "alice", fighter.name, "Common", "start");
  assert.equal(game.act("guild", "alice", fight.id, 0, "run", "run").outcome, "ran");
  assert.equal(store.wallet("guild", "alice").coins, 500);
  assert.equal(game.profile("guild", fighter.name).fainted_until, 0);
  store.send("guild", "alice", "bob", fighter.name, "now-transferable");
  const failed = new BattleService(store, { rng: (() => { const rolls = [0, 0, 0.99, 0, 0, 0]; return () => rolls.shift() ?? 0; })() });
  const again = failed.start("guild", "bob", fighter.name, "Common", "again");
  const result = failed.act("guild", "bob", again.id, 0, "run", "failed-run");
  assert.equal(result.outcome, null);
  assert.ok(result.player.hp < result.player.stats.hpMax);
});

test("level cap, character progression through gifts, buyback reset and Momiji's battle eligibility", (context) => {
  const { game, store, fighter } = setup(context);
  game.profile("guild", fighter.name);
  store.db.prepare("UPDATE battle_profiles SET level = 49, exp = ? WHERE name = ?").run(levelThreshold(49) - 1, fighter.name);
  const fight = game.start("guild", "alice", fighter.name, "Common", "start");
  editBattle(store, fight.id, (state) => { state.enemy.hp = 1; state.player.stats.speed = 999; });
  game.act("guild", "alice", fight.id, 0, "attack0", "win");
  assert.equal(game.profile("guild", fighter.name).level, 50);
  assert.equal(game.profile("guild", fighter.name).exp, 0);
  store.send("guild", "alice", "bob", fighter.name, "gift");
  assert.equal(game.party("guild", "bob")[0].level, 50);
  const quote = Math.floor(game.suggestedPrice("guild", fighter.name) * 2 / 3);
  assert.equal(game.buyback("guild", "bob", fighter.name, "buyback", quote).payout, quote);
  assert.equal(game.profile("guild", fighter.name).level, 1);
  assert.equal(store.character("guild", fighter.name).owner_id, null);
  const momiji = game.start("guild", MOMIJI_OWNER_ID, "Momiji", "Common", "momiji-battle");
  assert.equal(momiji.player.name, "Momiji Inubashiri");
  assert.throws(() => game.buyback("guild", MOMIJI_OWNER_ID, "Momiji", "forbidden"), /stays in Doll/);
  assert.equal(store.character("guild", "Momiji").owner_id, MOMIJI_OWNER_ID);
});

test("fights and inventory survive reopening their SQLite database", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "touhou-battle-"));
  const file = path.join(directory, "trader.db");
  let store = new TouhouStore(file, catalog);
  context.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  store.award("guild", "admin", "alice", "stars", 1, "stars");
  const fighter = store.adopt("guild", "alice", "stars", "adopt").character;
  let game = new BattleService(store, { rng: () => 0 });
  store.award("guild", "admin", "alice", "coins", 100, "potion-funds");
  game.buyPotions("guild", "alice", 2, "stock");
  const started = game.start("guild", "alice", fighter.name, "Common", "start");
  const state = game.act("guild", "alice", started.id, 0, "attack0", "turn");
  store.close(); store = new TouhouStore(file, catalog); game = new BattleService(store, { rng: () => 0 });
  assert.deepEqual(game.current("guild", "alice"), state);
  assert.equal(game.potions("guild", "alice"), 2);
  assert.equal(game.act("guild", "alice", state.id, 1, "attack0", "next").turn, 2);
});

test("elemental advantages and guarding change the original damage formula", () => {
  const attacker = { name: "A", level: 20, stats: { attack: 40 } };
  const target = () => ({ name: "B", type: "ice", hp: 100, stats: { defense: 20 } });
  const strong = target(), neutral = target(), guarded = target();
  strike(attacker, strong, { name: "Fire", type: "fire", accuracy: 100, basePower: 60 }, false, () => 0);
  strike(attacker, neutral, { name: "Shot", type: "danmaku", accuracy: 100, basePower: 60 }, false, () => 0);
  strike(attacker, guarded, { name: "Fire", type: "fire", accuracy: 100, basePower: 60 }, true, () => 0);
  assert.ok(strong.hp < neutral.hp);
  assert.ok(guarded.hp > strong.hp);
});
