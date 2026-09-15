import { mkdir, writeFile } from "node:fs/promises";
import { loadDressupCatalog } from "../src/dressup/catalog.js";
import { renderDollPng } from "../src/dressup/render.js";

const catalog = loadDressupCatalog(), folder = new URL("../data/dressup-review/", import.meta.url);
await mkdir(folder, { recursive: true });
const select = expression => catalog.clothes.find(item => expression.test(item.image));
const samples = [
  { name: "dress", top: select(/TQ_Clothing_Onesie_1A/), outfit: {} },
  { name: "skirt", top: select(/TShirt_1A/), outfit: { bottom: select(/Skirts_Chequered\.png/) } },
  { name: "stockings", top: select(/TQ_Clothing_Onesie_1A/), outfit: { socks: select(/Stockings_Striped_Black_Yellow/), shoes: select(/Shoes_MaryJanes\.png/) } },
  { name: "frilly", top: select(/NEWTQ_Clothing_FrillyDress_1A/), outfit: {} },
];
for (const shape of ["soft", "angular"]) for (const sample of samples) {
  for (const variant of ["narrow", "unfitted", "fitted"]) {
    const stance = variant === "narrow" ? "narrow" : "wide";
    const diaper = catalog.diapers.find(item => item.id === (stance === "wide" ? "ribbon-bouquet" : "cloud-tapes"));
    const state = { ...sample, player: { shape, name: "Fit preview", hair: catalog.hair[0], face: catalog.faces[0] },
      base: catalog.bases[shape][stance], diaper, stance, ...(variant === "unfitted" ? { fitProfiles: {} } : {}) };
    await writeFile(new URL(`fit-${shape}-${sample.name}-${variant}.png`, folder), await renderDollPng(state));
  }
}
console.log("Saved narrow / unfitted wide / fitted wide comparison PNGs for both body shapes in data/dressup-review.");
// Render synthetic outfits only; no account, inventory, care or wallet is modified.
