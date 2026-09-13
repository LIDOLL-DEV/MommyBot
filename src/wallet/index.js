import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { WalletClient, walletConfig } from "./client.js";
import { WalletService } from "./service.js";

export function initializeWallet() {
  const config = walletConfig();
  if (!config) return null;
  if (process.env.LIDOLLID_ENABLED !== "true") throw new Error("Enable LIDOLLID_ENABLED to register the wallet commands.");
  if (process.env.TOUHOU_ENABLED === "false") throw new Error("Online wallets require Touhou Trader so pending payments can be recovered.");
  fs.mkdirSync(fileURLToPath(new URL("../../data/", import.meta.url)), { recursive: true });
  return new WalletService(fileURLToPath(new URL("../../data/online-wallet.db", import.meta.url)), new WalletClient(config));
} // Keep credentials in the protected persistent data directory included in stopped-service backups.
