import { randomUUID } from "node:crypto";
import { TraderError } from "./store.js";
import { rarity } from "./catalog.js";
import { BATTLE_IDLE_MS, FAINT_DURATION_MS, POTION_CAP, POTION_PRICE, HEAL_PRICE, MAX_LEVEL,
  RARITIES, FALLBACK_ATTACKS, levelThreshold, stats, resolveTurn } from "./battleRules.js";

export class BattleService {
  constructor(store, { rng = Math.random } = {}) { this.store = store; this.rng = rng; } // Share the trader's SQLite transaction boundary and allow deterministic combat tests.

  profile(guild, name) {
    const entry = this.store.character(guild, name);
    this.store.db.prepare("INSERT OR IGNORE INTO battle_profiles(guild_id, name) VALUES (?, ?)").run(guild, entry.name);
    return this.store.db.prepare("SELECT * FROM battle_profiles WHERE guild_id = ? AND name = ?").get(guild, entry.name);
  } // Levels and cooldowns belong to the unique character and follow gifts and sales automatically.

  party(guild, user) {
    this.store.expireBattles();
    return this.store.collection(guild, user).map((entry) => ({ ...entry, ...this.profile(guild, entry.name) }));
  } // Render the complete party with current levels, wins, losses and recovery deadlines.

  potions(guild, user) {
    return this.store.db.prepare("SELECT potions FROM battle_inventory WHERE guild_id = ? AND user_id = ?").get(guild, user)?.potions || 0;
  } // Inventory is per player and server, independently of character transfers.

  buyPotions(guild, user, count, request) {
    if (!Number.isInteger(count) || count < 1 || count > POTION_CAP) throw new TraderError("Choose between 1 and 10 potions.");
    return this.store.mutate(guild, user, request, `potions:${count}`, () => {
      if (this.potions(guild, user) + count > POTION_CAP) throw new TraderError("You can carry at most 10 potions.");
      this.store.changeBalance(guild, user, "coins", -POTION_PRICE * count);
      this.store.db.prepare(`INSERT INTO battle_inventory VALUES (?, ?, ?)
        ON CONFLICT(guild_id, user_id) DO UPDATE SET potions = potions + excluded.potions`).run(guild, user, count);
      return { count: this.potions(guild, user), price: count * POTION_PRICE };
    });
  } // Debit 20 LiDollcoins per potion and add stock together; never exceed the original ten-potion cap.

  heal(guild, user, name, pay, request) {
    this.store.expireBattles();
    return this.store.mutate(guild, user, request, `heal:${name}:${pay}`, () => {
      const entry = this.store.character(guild, name);
      if (entry.owner_id !== user) throw new TraderError("You do not own that Touhou.");
      this.store.assertNotBattling(guild, entry.name);
      const profile = this.profile(guild, entry.name);
      const recovering = profile.fainted_until > this.store.now();
      if (recovering && !pay) throw new TraderError("Still recovering. Wait for the timer or choose instant heal for 50 LiDollcoins.");
      if (recovering) this.store.changeBalance(guild, user, "coins", -HEAL_PRICE);
      this.store.db.prepare("UPDATE battle_profiles SET fainted_until = 0 WHERE guild_id = ? AND name = ?").run(guild, entry.name);
      return { name: entry.name, price: recovering ? HEAL_PRICE : 0 };
    });
  } // Heal freely after ten minutes, charging only when the player explicitly requests early recovery; Momiji may heal normally.

  suggestedPrice(guild, name) {
    const entry = this.store.character(guild, name);
    const level = this.profile(guild, entry.name).level;
    return Math.floor(25 * (1 + entry.trade_count * 0.45 + entry.base_rarity * 0.35)) + Math.floor(level / 5) * 8;
  } // Port the original rarity/trade/level valuation for buyback previews.

  buyback(guild, user, name, request, expectedPrice) {
    return this.store.mutate(guild, user, request, `buyback:${name}`, () => {
      const entry = this.store.owned(guild, user, name);
      const payout = Math.max(1, Math.floor(this.suggestedPrice(guild, entry.name) * 2 / 3));
      if (expectedPrice !== undefined && payout !== expectedPrice) throw new TraderError("The buyback value changed. Review a fresh quote.");
      this.store.changeBalance(guild, user, "coins", payout);
      this.store.db.prepare("DELETE FROM listings WHERE guild_id = ? AND name = ?").run(guild, entry.name);
      this.store.db.prepare("DELETE FROM battle_profiles WHERE guild_id = ? AND name = ?").run(guild, entry.name);
      this.store.db.prepare("UPDATE characters SET owner_id = NULL, revision = revision + 1 WHERE guild_id = ? AND name = ?").run(guild, entry.name);
      return { name: entry.name, payout };
    });
  } // Return a nonreserved character and pay two-thirds of its value atomically, resetting its battle progression.

  current(guild, user) {
    this.store.expireBattles();
    const row = this.store.db.prepare("SELECT * FROM battles WHERE guild_id = ? AND user_id = ? AND status = 'active'").get(guild, user);
    return row ? this.unpack(row) : null;
  } // Find a resumable fight after navigation or a bot restart.

  unpack(row) { return { ...JSON.parse(row.state), id: row.id, turn: row.turn, expiresAt: row.expires_at }; } // Keep the database's turn counter authoritative for stale-button protection.

  get(guild, user, id) {
    this.store.expireBattles();
    const row = this.store.db.prepare("SELECT * FROM battles WHERE id = ? AND guild_id = ? AND user_id = ?").get(id, guild, user);
    if (!row) throw new TraderError("That battle does not belong to you in this server.");
    return this.unpack(row);
  } // Authorize every battle read against both the server and player.

  fighter(character, level) {
    const seed = this.store.catalog.find((entry) => entry.name === character.name);
    const attacks = seed?.attacks?.length ? seed.attacks.slice(0, 3) : FALLBACK_ATTACKS;
    const derived = stats(character, level, seed?.isMain);
    return { name: character.name, filename: character.filename, level, type: attacks[0].type || "danmaku",
      row: character, attacks, stats: derived, hp: derived.hpMax };
  } // Combine the ported spell-card seed with the character's current combat level.

  start(guild, user, name, choice, request) {
    if (![...RARITIES, "gamble"].includes(choice)) throw new TraderError("Choose an opponent rarity or Gamble.");
    this.store.expireBattles();
    return this.store.mutate(guild, user, request, `battle-start:${name}:${choice}`, () => {
      if (this.current(guild, user)) throw new TraderError("You already have an active battle. Resume it from Battle.");
      const entry = this.store.character(guild, name);
      if (entry.owner_id !== user) throw new TraderError("You do not own that Touhou.");
      const profile = this.profile(guild, entry.name);
      if (profile.fainted_until > this.store.now()) throw new TraderError("This Touhou is recovering. Heal it or wait for its timer.");
      const all = this.store.db.prepare("SELECT * FROM characters WHERE guild_id = ? AND name != ?").all(guild, entry.name);
      let pool = choice === "gamble" ? all : all.filter((row) => rarity(row).endsWith(` ${choice}`));
      const fallback = pool.length === 0;
      if (fallback) pool = all;
      if (!pool.length) throw new TraderError("No opponents are available.");
      const opponent = pool[Math.floor(this.rng() * pool.length)];
      const enemyLevel = Math.max(1, Math.min(MAX_LEVEL, profile.level + Math.floor(this.rng() * 5) - 2));
      const state = { player: this.fighter(entry, profile.level), enemy: this.fighter(opponent, enemyLevel),
        choice, outcome: null, reward: null, log: [`Evil ${opponent.name} appeared!`, ...(fallback ? ["No opponents in that tier; matched another available character."] : [])] };
      const id = randomUUID();
      const expiresAt = this.store.now() + BATTLE_IDLE_MS;
      this.store.db.prepare("INSERT INTO battles(id, guild_id, user_id, name, character_revision, state, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(id, guild, user, entry.name, entry.revision, JSON.stringify(state), expiresAt);
      return { ...state, id, turn: 0, expiresAt };
    });
  } // Start one owned-character PvE fight per player; enemy copies never change actual character ownership.

  act(guild, user, id, expectedTurn, action, request) {
    if (!["attack0", "attack1", "attack2", "defend", "potion", "run"].includes(action)) throw new TraderError("Invalid battle action.");
    this.store.expireBattles();
    return this.store.mutate(guild, user, request, `battle-action:${id}:${expectedTurn}:${action}`, () => {
      const row = this.store.db.prepare("SELECT * FROM battles WHERE id = ? AND guild_id = ? AND user_id = ?").get(id, guild, user);
      if (!row) throw new TraderError("That battle does not belong to you.");
      if (row.status !== "active") throw new TraderError("This battle has ended. Return to the trader.");
      if (row.turn !== expectedTurn) throw new TraderError("That turn already finished. Resume Battle for the latest controls.");
      const state = JSON.parse(row.state);
      const owner = this.store.character(guild, row.name);
      if (owner.owner_id !== user || owner.revision !== row.character_revision) throw new TraderError("The character's ownership changed; this battle cannot continue.");
      if (action.startsWith("attack") && !state.player.attacks[Number(action.slice(-1))]) throw new TraderError("That attack is unavailable.");
      if (action === "potion") {
        if (state.player.hp >= state.player.stats.hpMax) throw new TraderError("Your Touhou is already at full health.");
        const used = this.store.db.prepare("UPDATE battle_inventory SET potions = potions - 1 WHERE guild_id = ? AND user_id = ? AND potions > 0").run(guild, user);
        if (!used.changes) throw new TraderError("You have no health potions. Buy them in the shop.");
      }
      resolveTurn(state, action, this.rng);
      if (state.outcome === "victory") this.reward(guild, user, state);
      else if (state.outcome === "defeat") {
        this.store.db.prepare("UPDATE battle_profiles SET losses = losses + 1, fainted_until = ? WHERE guild_id = ? AND name = ?")
          .run(this.store.now() + FAINT_DURATION_MS, guild, row.name);
        state.log.push("Defeated. Rest for ten minutes or pay 50 LiDollcoins for instant healing.");
      }
      const expiresAt = this.store.now() + BATTLE_IDLE_MS;
      this.store.db.prepare("UPDATE battles SET state = ?, status = ?, turn = turn + 1, expires_at = ? WHERE id = ?")
        .run(JSON.stringify(state), state.outcome || "active", expiresAt, id);
      return { ...state, id, turn: row.turn + 1, expiresAt };
    });
  } // Commit a single turn, potion debit, EXP gain and victory payout together; replays cannot pay twice.

  reward(guild, user, state) {
    const tier = rarity(state.enemy.row, state.enemy.level);
    const bonuses = { Common: 0, Uncommon: 5, Rare: 12, Epic: 25, Legendary: 50, "Ultra-Plus Infinity Rare": 100 };
    const bonus = bonuses[tier.replace(/^\S+\s/, "")] || 0;
    let gained = 15 + state.enemy.level * 3 + bonus;
    let coins = Math.floor(gained * 0.6);
    if (state.choice === "gamble") { gained = Math.floor(gained * 1.2); coins = Math.floor(coins * 1.2); }
    const profile = this.profile(guild, state.player.name);
    let level = profile.level;
    let exp = profile.exp + gained;
    while (level < MAX_LEVEL && exp >= levelThreshold(level)) { exp -= levelThreshold(level); level++; }
    if (level === MAX_LEVEL) exp = 0;
    this.store.changeBalance(guild, user, "coins", coins);
    this.store.db.prepare("UPDATE battle_profiles SET level = ?, exp = ?, wins = wins + 1 WHERE guild_id = ? AND name = ?")
      .run(level, exp, guild, state.player.name);
    state.reward = { exp: gained, coins, level };
    state.log.push(`Victory! +${gained} EXP, +${coins} LiDollcoins. ${state.player.name} is level ${level}.`);
  } // Port rarity-scaled rewards and the 20% Gamble bonus, with a level-50 progression cap.
}
