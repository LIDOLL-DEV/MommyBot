import { readFileSync, existsSync } from "node:fs";
import { tiers } from "../gacha/catalog.js";

export const dressupRoot = new URL("../../assets/dressup/", import.meta.url);
export const slots = ["diaper", "underwear", "socks", "bra", "bottom", "shoes", "top", "corset", "belt", "gloves", "accessory", "hand", "bag", "head"];

export function loadDressupCatalog() {
  const data = JSON.parse(readFileSync(new URL("catalog.json", dressupRoot), "utf8"));
  const image = name => typeof name === "string" && /^[\w-]+\.png$/.test(name) && existsSync(new URL(name, dressupRoot));
  if (JSON.stringify(data.canvas) !== "[387,875]" || !data.faces?.length || !data.hair?.length) throw new Error("Invalid doll canvas or appearance choices.");
  for (const shape of ["soft", "angular"]) for (const stance of ["narrow", "wide"]) {
    if (!image(data.bases?.[shape]?.[stance])) throw new Error("Missing doll base.");
  }
  for (const name of [...data.faces, ...data.hair]) if (!image(name)) throw new Error("Invalid appearance image.");
  for (const group of [data.clothes, data.diapers]) {
    const ids = new Set();
    for (const item of group) {
      if (!/^[a-z0-9-]{1,80}$/.test(item.id) || ids.has(item.id) || !image(item.image)) throw new Error("Invalid or duplicate wardrobe asset.");
      ids.add(item.id);
      if (item.parts && (!Array.isArray(item.parts) || item.parts.some(name => !image(name)))) throw new Error("Missing garment section.");
      if (item.backParts && (!Array.isArray(item.backParts) || item.backParts.some(name => !image(name)))) throw new Error("Missing back garment section.");
      if (group === data.clothes && (!slots.includes(item.slot) || item.slot === "diaper" || !Object.hasOwn(tiers, item.rarity) ||
          !item.name || !Array.isArray(item.stances) || !item.stances.length || item.stances.some(s => !["narrow", "wide"].includes(s)))) throw new Error("Invalid clothing fit or rarity.");
      if (group === data.diapers && !["narrow", "wide"].includes(item.stance)) throw new Error("Invalid diaper stance.");
      if (item.rect && (item.rect.length !== 4 || item.rect.some(n => !Number.isInteger(n) || n < 0) ||
          item.rect[2] < 1 || item.rect[3] < 1 || item.rect[0] + item.rect[2] > 387 || item.rect[1] + item.rect[3] > 875)) throw new Error("Invalid illustration fit rectangle.");
    }
  }
  for (const rarity of Object.keys(tiers)) if (!data.clothes.some(item => item.rarity === rarity)) throw new Error("Every clothing rarity needs a design.");
  return data;
} // Validate modded catalogs before either game starts or charges for a roll.
