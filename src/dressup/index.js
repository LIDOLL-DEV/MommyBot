import { fileURLToPath } from "node:url";
import { DiaperStore } from "../gacha/store.js";
import { loadDressupCatalog } from "./catalog.js";
import { LittlepottchiStore } from "./store.js";
import { createDressupWeb } from "./web.js";
import { createPetCommands } from "./commands.js";
import { GameClock } from "./clock.js";

export function initializeDressup(config, diapers, sessions) {
  const catalog = loadDressupCatalog();
  const price = Number(process.env.CLOTHES_GACHA_ROLL_PRICE || 3);
  if (!Number.isSafeInteger(price) || price < 3 || price > 10000) throw new Error("CLOTHES_GACHA_ROLL_PRICE must be a whole number from 3 to 10000.");
  const clothes = new DiaperStore(fileURLToPath(new URL("../../data/clothes-gacha.db", import.meta.url)), catalog.clothes, diapers.wallet,
    { enabled: diapers.config.enabled && process.env.CLOTHES_GACHA_ENABLED !== "false", suppliesEnabled: diapers.config.enabled,
      price, walletKey: "clothes", wipePrice: Number(process.env.BABYWIPES_PRICE || 1) });
  const clock = new GameClock(clothes.db);
  const doll = new LittlepottchiStore(clothes, diapers, catalog, clock.now);
  doll.clock = clock; // The web routes and admin command read the same clock the simulation runs on.
  const timer = setInterval(() => {
    if (clock.frozen) return; // Nothing can change while time is stopped, so there is nothing to advance.
    try { doll.tick(); } catch { console.error("Littlepottchi care tick failed; saved timers will retry."); }
  }, 30000);
  timer.unref();
  return { doll, clock, web: createDressupWeb(config, clothes, doll, sessions, catalog),
    commands:createPetCommands(config, sessions.identities, doll), close: () => { clearInterval(timer); clothes.close(); } };
} // Keep clothing payments in their own durable journal while sharing Atelier inventory and login.
