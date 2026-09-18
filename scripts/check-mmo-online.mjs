import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { inspectOnline } from "../src/mmo/diagnostics.js";

process.chdir(fileURLToPath(new URL("../", import.meta.url))); // Read the active release's shared data directory, regardless of the caller's working directory.
try {
  const env = { ...dotenv.parse(readFileSync(process.argv[2] || ".env")), ...process.env };
  const result = await inspectOnline(env);
  console.log(JSON.stringify(result, null, 2));
  console.log("Read-only check complete. No Discord messages sent or saved progress changed. Restart services after changing their environment files.");
  if (!result.ok) process.exitCode = 1;
} catch {
  console.error("FAIL: Could not read configuration or finish diagnostics. Run as mommybot with /etc/mommybot/mommybot.env. No credentials were printed.");
  process.exitCode = 1;
}
