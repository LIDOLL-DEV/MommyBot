import "dotenv/config";
import process from "process";
import { Events } from "discord.js"; // Use the library's current event names instead of deprecated aliases.
import { createClient } from "./bot/client.js";
import { handleMessage } from "./bot/handlers/message.js";
import { initCheckpointer } from "./db/checkpointer.js";
import { startGitHubActivityWatcher } from "./github/activityWatcher.js";

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;

if (!DISCORD_TOKEN) {
  console.error("🌸 Missing DISCORD_TOKEN in .env file!");
  process.exit(1);
}

async function main() {
  console.log("🌸 Sakura is waking up...");
  console.log(`🔒 Channel gate set to: ${CHANNEL_ID || "unlocked (all channels)"}`);

  // Initialize the SQLite memory database
  await initCheckpointer();

  // Create and login the Discord client
  const client = createClient();
  let stopGitHubWatcher = () => {};

  // Handle message events
  client.on("messageCreate", async (message) => {
    // Gate to specific channel if configured
    if (CHANNEL_ID && message.channel.id !== CHANNEL_ID) {
      console.log(`🔇 Ignoring message in channel ${message.channel.id} (gate: ${CHANNEL_ID})`);
      return;
    }
    await handleMessage(message, client.user.id);
  });

  // Login
  client.once(Events.ClientReady, () => {
    console.log(`🌸 Sakura is online and ready to cuddle! (${client.user.tag})`);
    stopGitHubWatcher = startGitHubActivityWatcher(client);
  });

  client.login(DISCORD_TOKEN);

  // Graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\n🌸 Sakura is going to sleep... Sweet dreams!");
    stopGitHubWatcher();
    await client.destroy();
    process.exit(0);
  });
}

main().catch(console.error);
