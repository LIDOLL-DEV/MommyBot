import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const assetRoot = new URL("../../diaper-gacha/", import.meta.url);
export const tiers = Object.freeze({
  common: { label: "Common", chance: 55, buy: .4 },
  uncommon: { label: "Uncommon", chance: 25, buy: .8 },
  rare: { label: "Rare", chance: 14, buy: 1.6 },
  epic: { label: "Epic", chance: 5, buy: 4 },
  legendary: { label: "Legendary", chance: 1, buy: 8 },
}); // Roll a rarity first, then choose equally among its designs; catalog size cannot silently change tier odds.

export function gachaConfig(env = process.env) {
  const enabled = env.DIAPER_GACHA_ENABLED !== "false" && env.LIDOLLID_ENABLED === "true" && env.LIDOLLCOIN_ENABLED === "true";
  if (env.DIAPER_GACHA_ENABLED === "true" && !enabled) throw new Error("Diaper Gacha requires LiD0llID and online wallets.");
  const price = Number(env.DIAPER_GACHA_ROLL_PRICE || 3);
  if (!Number.isSafeInteger(price) || price < 3 || price > 10000) throw new Error("DIAPER_GACHA_ROLL_PRICE must be a whole number from 3 to 10000.");
  return { enabled, price };
} // Enable alongside configured account/wallet services; an explicit false pauses new transactions but retains recovery.

export function loadDiaperCatalog() {
  const catalog = JSON.parse(readFileSync(new URL("catalog.json", assetRoot), "utf8")), ids = new Set();
  for (const item of catalog) {
    if (!/^[a-z0-9-]+$/.test(item.id) || ids.has(item.id) || !Object.hasOwn(tiers, item.rarity) ||
        typeof item.name !== "string" || !item.name || typeof item.description !== "string" ||
        !/^[\w-]+\.png$/.test(item.image) || !existsSync(fileURLToPath(new URL(item.image, assetRoot)))) {
      throw new Error("Invalid Diaper Gacha catalog entry.");
    }
    ids.add(item.id);
  }
  for (const rarity of Object.keys(tiers)) if (!catalog.some(item => item.rarity === rarity)) throw new Error(`Missing diaper rarity: ${rarity}`);
  return catalog;
} // Explicit art-reviewed rarity and stable IDs keep the economy editable without ranking by filename or file size.
