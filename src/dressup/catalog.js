import { readFileSync, existsSync } from "node:fs";
import { tiers } from "../gacha/catalog.js";

export const dressupRoot = new URL("../../assets/dressup/", import.meta.url);
export const slots = ["diaper", "socks", "bra", "bottom", "shoes", "top", "corset", "belt", "gloves", "accessory", "hand", "bag", "head"];

export function loadDressupCatalog() {
  const data = JSON.parse(readFileSync(new URL("catalog.json", dressupRoot), "utf8"));
  const fitRules = JSON.parse(readFileSync(new URL("clothing-fit-rules.json", dressupRoot), "utf8"));
  data.clothes = data.clothes.map(item => ({ ...fitRules[item.image], ...item })); // Explicit mod settings override imported lidollquest hem rules.
  const image = name => typeof name === "string" && /^[\w-]+\.png$/.test(name) && existsSync(new URL(name, dressupRoot));
  if (JSON.stringify(data.canvas) !== "[387,875]" || !data.faces?.length || !data.hair?.length) throw new Error("Invalid doll canvas or appearance choices.");
  for (const shape of ["soft", "angular"]) for (const stance of ["narrow", "wide"]) {
    if (!image(data.bases?.[shape]?.[stance])) throw new Error("Missing doll base.");
  }
  for (const name of [...data.faces, ...data.hair]) if (!image(name)) throw new Error("Invalid appearance image.");
  for (const [key, defaultId] of Object.entries({ chest: "base", nipples: "none", genitals: "neutral", pubes: "none" })) {
    const choices = data.appearance?.[key], ids = new Set();
    if (!Array.isArray(choices) || !choices.some(choice => choice.id === defaultId)) throw new Error("Missing default anatomy choice.");
    for (const choice of choices) {
      if (!/^[a-z0-9-]+$/.test(choice.id) || ids.has(choice.id) || !choice.name || !Array.isArray(choice.layers)) throw new Error("Invalid anatomy choice.");
      ids.add(choice.id);
      if (key === "genitals" && (!image(choice.camera) || !data.provenance[choice.camera])) throw new Error("Missing anatomy camera.");
      for (const layer of choice.layers) {
        if (!image(layer.image) || !data.provenance[layer.image]) throw new Error("Missing anatomy layer.");
        for (const [rect, size] of [[layer.sourceRect, data.provenance[layer.image].size], [layer.rect, data.canvas]]) {
          if (rect && (!Array.isArray(rect) || rect.length !== 4 || rect.some(n => !Number.isInteger(n) || n < 0) || rect[2] < 1 || rect[3] < 1 || rect[0] + rect[2] > size[0] || rect[1] + rect[3] > size[1])) throw new Error("Invalid anatomy crop.");
        }
        if (layer.sourceRect && !layer.rect) throw new Error("Anatomy crops need a destination rectangle.");
      }
    }
  } // Modded anatomical layers remain allowlisted, registered to the doll canvas and independent of gender.
  if (!Array.isArray(data.appearance.hair) || data.appearance.hair.length !== data.hair.length || new Set(data.appearance.hair.map(choice => choice.image)).size !== data.hair.length ||
      data.appearance.hair.some(choice => !data.hair.includes(choice.image) || !choice.style || !choice.color)) throw new Error("Invalid hairstyle/color choices.");
  for (const group of [data.clothes, data.diapers]) {
    const ids = new Set();
    for (const item of group) {
      if (!/^[a-z0-9-]{1,80}$/.test(item.id) || ids.has(item.id) || !image(item.image)) throw new Error("Invalid or duplicate wardrobe asset.");
      ids.add(item.id);
      if (group === data.clothes && (/Trousers|Pants|Jeans|Leggings|Shorts|Dungarees|Overalls/i.test(item.image) || /\/Trousers\//i.test(data.provenance[item.image]?.source || "")))
        throw new Error("Trousers and pants are retired from the clothing catalog."); // Atelier diapers and training pants remain in their separate catalog.
      if (item.warp !== undefined && !["auto", "none"].includes(item.warp)) throw new Error("Invalid clothing warp mode.");
      if (item.warpFullHem !== undefined && typeof item.warpFullHem !== "boolean") throw new Error("Invalid extended hem flag.");
      if (item.parts && (!Array.isArray(item.parts) || item.parts.some(name => !image(name)))) throw new Error("Missing garment section.");
      if (item.backParts && (!Array.isArray(item.backParts) || item.backParts.some(name => !image(name)))) throw new Error("Missing back garment section.");
      if (group === data.clothes && (!slots.includes(item.slot) || item.slot === "diaper" || !Object.hasOwn(tiers, item.rarity) ||
          !item.name || !Array.isArray(item.stances) || !item.stances.length || item.stances.some(s => !["narrow", "wide"].includes(s)))) throw new Error("Invalid clothing fit or rarity.");
      if (group === data.diapers && !["narrow", "wide"].includes(item.stance)) throw new Error("Invalid diaper stance.");
      if (group === data.diapers && (!Array.isArray(item.buttcams) || !item.buttcams.length || item.buttcams.some(name => !image(name)) || !item.buttcams[0].endsWith("_1.png"))) throw new Error("Invalid diaper camera sequence.");
      if (group === data.diapers && (!Number.isInteger(item.bulk) || item.bulk < 1 || item.bulk > 100)) throw new Error("Diaper bulk must be a whole number from 1 to 100.");
      if (item.rect && (item.rect.length !== 4 || item.rect.some(n => !Number.isInteger(n) || n < 0) ||
          item.rect[2] < 1 || item.rect[3] < 1 || item.rect[0] + item.rect[2] > 387 || item.rect[1] + item.rect[3] > 875)) throw new Error("Invalid illustration fit rectangle.");
    }
  }
  for (const rarity of Object.keys(tiers)) if (!data.clothes.some(item => item.rarity === rarity)) throw new Error("Every clothing rarity needs a design.");
  const foodIds = new Set();
  for (const shape of ["soft", "angular"]) if (!image(data.bareCameras?.[shape])) throw new Error("Missing diaper-free camera.");
  if (!image(data.wipeImage)) throw new Error("Missing baby wipe artwork.");
  if (!Array.isArray(data.foods) || !data.foods.length) throw new Error("The pantry needs food.");
  for (const food of data.foods) {
    if (!/^[a-z0-9-]{1,40}$/.test(food.id) || foodIds.has(food.id) || !food.name || !image(food.image) ||
        [food.fullness, food.joy].some(n => !Number.isInteger(n) || n < 0 || n > 100)) throw new Error("Invalid pantry food.");
    foodIds.add(food.id);
  }
  return data;
} // Validate modded catalogs before either game starts or charges for a roll.
