import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { readGitHubConfig } from "../src/github/activityWatcher.js";
import { inspectGitHubActivity } from "../src/github/diagnostics.js";

process.chdir(fileURLToPath(new URL("../", import.meta.url))); // Resolve data paths from the same release directory as the systemd service.
try {
  const settings = { ...dotenv.parse(readFileSync(process.argv[2] || ".env")), ...process.env };
  let config;
  try { config = readGitHubConfig(settings); }
  catch {
    console.error("FAIL: GitHub configuration is invalid. Set GITHUB_REPOSITORIES to comma-separated owner/repo names, GITHUB_TOKEN, and GITHUB_ACTIVITY_CHANNEL_ID (or CHANNEL_ID); poll interval must be at least 60000 ms.");
    process.exitCode = 1;
  }
  if (config) {
    try {
      const release = JSON.parse(readFileSync(new URL("../release.json", import.meta.url), "utf8"));
      console.log(JSON.stringify({ revision: release.revision, deployment: release.deployment }));
    } catch { console.log("No release metadata: running from a checkout or older release."); }
    const result = await inspectGitHubActivity(config);
    console.log(JSON.stringify(result, null, 2));
    if (!["loaded", "missing"].includes(result.stateStatus) || result.repositories.some(repo => !repo.metadata.ok || !repo.events.ok || !repo.commits.ok)) process.exitCode = 1;
    console.log("Read-only check complete. No updates were sent and no saved progress was changed. Discord delivery and AI are not tested.");
  } else if (!process.exitCode) console.log("GitHub activity is disabled: no repository/token configuration was found.");
} catch {
  console.error("FAIL: Could not read GitHub configuration or complete the check. Run as the bot user with the active dotenv file.");
  process.exitCode = 1;
} // Use the service's effective settings; never echo credentials or arbitrary errors.
