export const FAINT_DURATION_MS = 10 * 60_000;
export const BATTLE_IDLE_MS = 90_000;
export const POTION_PRICE = 20;
export const POTION_CAP = 10;
export const HEAL_PRICE = 50;
export const MAX_LEVEL = 50;
export const RARITIES = ["Common", "Uncommon", "Rare", "Epic", "Legendary"];
export const FALLBACK_ATTACKS = [
  { name: "Danmaku Burst", type: "danmaku", basePower: 60, accuracy: 95 },
  { name: "Spirit Shot", type: "spirit", basePower: 45, accuracy: 100 },
  { name: "Focus Strike", type: "danmaku", basePower: 80, accuracy: 80 },
];
const TYPES = {
  fire: { ice: 1.5, dark: 0.75 }, ice: { wind: 1.5, fire: 0.75 },
  wind: { spirit: 1.5, ice: 0.75 }, spirit: { holy: 1.5, wind: 0.75 },
  holy: { dark: 1.5, spirit: 0.75 }, dark: { fire: 1.5, holy: 0.75 }, danmaku: {},
};

export function levelThreshold(level) { return 20 + level * 15; } // Preserve LumiBot's EXP curve.

export function stats(character, level, mainCharacter = false) {
  const base = character.base_rarity || 0;
  return { hpMax: Math.floor(50 + level * 8 + base * 3), attack: Math.floor(10 + level * 2 + base),
    defense: Math.floor(8 + level * 1.5 + base), speed: Math.floor(10 + level + (mainCharacter ? 5 : 0)) };
} // Derive the original combat stats from level and seeded rarity.

export function strike(attacker, defender, move, defending, rng = Math.random) {
  if (rng() * 100 >= move.accuracy - (defending ? 5 : 0)) return `${attacker.name}'s ${move.name} missed!`;
  const multiplier = TYPES[move.type]?.[defender.type] ?? 1;
  const ratio = attacker.stats.attack / Math.max(1, defender.stats.defense);
  let damage = Math.floor((((2 * attacker.level) / 5 + 2) * move.basePower * ratio) / 50 + 2);
  damage = Math.floor(damage * (0.85 + rng() * 0.15) * multiplier);
  if (defending) damage = Math.floor(damage * 0.5);
  damage = Math.max(1, damage);
  defender.hp = Math.max(0, defender.hp - damage);
  return `${attacker.name} used ${move.name}: ${damage} damage${defending ? " (guarded)" : ""}${multiplier > 1 ? " — super effective!" : multiplier < 1 ? " — resisted." : "."}`;
} // Resolve accuracy, elemental advantage and defense without touching wallets or persistent state.

export function resolveTurn(state, action, rng = Math.random) {
  const { player, enemy } = state;
  const enemyMove = () => enemy.attacks[Math.floor(rng() * enemy.attacks.length)];
  if (action === "run") {
    if (rng() < 0.75) { state.outcome = "ran"; state.log.push("You escaped safely."); return; }
    state.log.push("You could not escape!");
    state.log.push(strike(enemy, player, enemyMove(), false, rng));
  } else if (action === "potion") {
    const old = player.hp;
    player.hp = Math.min(player.stats.hpMax, player.hp + Math.max(1, Math.floor(player.stats.hpMax * 0.5)));
    state.log.push(`Health Potion restored ${player.hp - old} HP.`);
    state.log.push(strike(enemy, player, enemyMove(), false, rng));
  } else {
    const defending = action === "defend";
    const playerMove = defending ? null : player.attacks[Number(action.slice(-1))];
    const first = player.stats.speed > enemy.stats.speed || (player.stats.speed === enemy.stats.speed && rng() < 0.5);
    const enemyAttack = enemyMove();
    if (defending) state.log.push(`${player.name} braces for impact!`);
    const hitPlayer = () => state.log.push(strike(enemy, player, enemyAttack, defending, rng));
    const hitEnemy = () => { if (playerMove) state.log.push(strike(player, enemy, playerMove, false, rng)); };
    if (first) { hitEnemy(); if (enemy.hp > 0) hitPlayer(); }
    else { hitPlayer(); if (player.hp > 0) hitEnemy(); }
  }
  if (player.hp <= 0) state.outcome = "defeat";
  else if (enemy.hp <= 0) state.outcome = "victory";
  state.log = state.log.slice(-8);
} // Port the original attack/defend/potion/run round; the service handles inventory and settlement atomically.
