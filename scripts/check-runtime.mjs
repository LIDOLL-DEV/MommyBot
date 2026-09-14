import fs from "node:fs";
import dotenv from "dotenv";
import { reportModelEndpoints } from "../src/graph/connection.js";
import { swearJarStatus } from "../src/swearJar.js";

try {
  const settings = { ...dotenv.parse(fs.readFileSync(process.argv[2] || new URL("../.env", import.meta.url))), ...process.env };
  try {
    const release = JSON.parse(fs.readFileSync(new URL("../release.json", import.meta.url), "utf8"));
    console.log(`[Release] ${release.revision}${release.modified ? " (local changes)" : ""}; deployed ${release.deployment}`);
  } catch { console.log("[Release] Checkout or deployment without release metadata."); }
  console.log(`[Swear jar] ${swearJarStatus(settings)}`);
  if (!await reportModelEndpoints(settings)) {
    console.error("Check /etc/mommybot/mommybot.env on Fedora. Deployment preserves that file; checkout .env edits do not update it.");
    process.exitCode = 1;
  }
} catch {
  console.error("Runtime check could not read the configuration. Run as the bot user with a readable dotenv file path.");
  process.exitCode = 1;
} // Inspect active settings and GET model lists without opening databases, sending Discord messages or exposing secrets.
