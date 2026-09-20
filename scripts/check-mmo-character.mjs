import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { inspectCharacter } from "../src/mmo/characterDiagnostics.js";

process.chdir(fileURLToPath(new URL("../", import.meta.url))); // Read the active release's shared data directory, regardless of the caller's working directory.
const discordId = process.argv[2], envPath = process.argv[3] || ".env";
if (!discordId) {
  console.error("Usage: node scripts/check-mmo-character.mjs <discord-user-id> [env-file]");
  process.exitCode = 1;
} else {
  try {
    const env = { ...dotenv.parse(readFileSync(envPath)), ...process.env };
    const result = await inspectCharacter(env, discordId);
    console.log(JSON.stringify(result, null, 2));
    console.log("Read-only check complete. No Discord messages sent and no saved progress changed.");
    if (!result.ok) process.exitCode = 1;
  } catch {
    console.error("FAIL: Could not read configuration or finish diagnostics. Run as mommybot with /etc/mommybot/mommybot.env. No credentials were printed.");
    process.exitCode = 1;
  }
}
