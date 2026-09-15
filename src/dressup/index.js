import { fileURLToPath } from "node:url";
import { DiaperStore } from "../gacha/store.js";
import { loadDressupCatalog } from "./catalog.js";
import { LittlepottchiStore } from "./store.js";
import { createDressupWeb } from "./web.js";

export function initializeDressup(config, diapers, sessions) {
  const catalog = loadDressupCatalog();
  const price = Number(process.env.CLOTHES_GACHA_ROLL_PRICE || 3);
  if (!Number.isSafeInteger(price) || price < 3 || price > 10000) throw new Error("CLOTHES_GACHA_ROLL_PRICE must be a whole number from 3 to 10000.");
  const clothes = new DiaperStore(fileURLToPath(new URL("../../data/clothes-gacha.db", import.meta.url)), catalog.clothes, diapers.wallet,
    { enabled: diapers.config.enabled && process.env.CLOTHES_GACHA_ENABLED !== "false", price, walletKey: "clothes" });
  const doll = new LittlepottchiStore(clothes, diapers, catalog);
  const timer = setInterval(() => { try { doll.tick(); } catch { console.error("Littlepottchi care tick failed; saved timers will retry."); } }, 30000);
  timer.unref();
  return { web: createDressupWeb(config, clothes, doll, sessions, catalog), close: () => { clearInterval(timer); clothes.close(); } };
} // Keep clothing payments in their own durable journal while sharing Atelier inventory and login.
