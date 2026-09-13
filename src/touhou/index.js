import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { loadCatalog } from "./catalog.js";
import { TouhouStore } from "./store.js";
import { buildTouhouCommand, createTouhouHandlers } from "./commands.js";

export function initializeTouhouTrader() {
  if (process.env.TOUHOU_ENABLED === "false") return null;
  const dataDirectory = fileURLToPath(new URL("../../data/", import.meta.url));
  fs.mkdirSync(dataDirectory, { recursive: true });
  const store = new TouhouStore(fileURLToPath(new URL("../../data/touhou-trader.db", import.meta.url)), loadCatalog());
  const handlers = createTouhouHandlers(store, {
    channelId: process.env.CHANNEL_ID || "",
    adminRoleId: process.env.TOUHOU_ADMIN_ROLE_ID || "",
  });
  return {
    ...handlers,
    close: () => store.close(),
    async registerGuild(guild) {
      try {
        await guild.commands.create(buildTouhouCommand()); // Upsert only /touhou; leave all other registered application commands intact.
        console.log(`[TOUHOU] Trader command ready in guild ${guild.id}.`);
      } catch (error) {
        console.error(`[TOUHOU] Could not register /touhou in guild ${guild.id}; !touhou remains available:`, error.message);
      }
    },
  };
} // Initialize a persistent local trader whose database is included in Fedora's existing stopped-state backups.
