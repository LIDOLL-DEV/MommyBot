import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const IMAGE_DIRECTORY = fileURLToPath(new URL("../../assets/touhous/", import.meta.url));

export function loadCatalog(directory = IMAGE_DIRECTORY) {
  const seed = JSON.parse(fs.readFileSync(new URL("../../assets/touhou-rarity-seed.json", import.meta.url), "utf8"));
  const moves = JSON.parse(fs.readFileSync(new URL("../../assets/touhou-attacks-seed.json", import.meta.url), "utf8"));
  const characters = fs.readdirSync(directory).filter((file) => /\.(png|jpe?g|gif|webp)$/i.test(file)).map((filename) => {
    const name = path.parse(filename).name;
    return { name, filename, baseRarity: Number(seed.characters?.[name]?.baseRarityScore || 0),
      isMain: Boolean(seed.characters?.[name]?.isMainCharacter), attacks: moves.characters?.[name]?.attacks || [] };
  });
  if (!characters.length) throw new Error("The Touhou character catalog is empty.");
  return characters.sort((a, b) => a.name.localeCompare(b.name));
} // Load the character artwork and original LumiBot rarity seed from deployed assets.

export function rarity(character, level = 0) {
  if (character.name === "Momiji Inubashiri") return "✦ Ultra-Plus Infinity Rare";
  const score = character.trade_count + character.base_rarity + Math.floor(level / 5);
  if (score >= 24) return "🌟 Legendary";
  if (score >= 14) return "💜 Epic";
  if (score >= 8) return "🔷 Rare";
  if (score >= 4) return "🟢 Uncommon";
  return "⚪ Common";
} // Preserve LumiBot's rarity thresholds and increases from completed player transfers.
