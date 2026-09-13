import "dotenv/config";
import process from "process";
import { Events } from "discord.js"; // Use the library's current event names instead of deprecated aliases.
import { createClient } from "./bot/client.js";
import { handleMessage } from "./bot/handlers/message.js";
import { initCheckpointer } from "./db/checkpointer.js";
import { startGitHubActivityWatcher } from "./github/activityWatcher.js";
import { initializeTouhouTrader } from "./touhou/index.js";

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
  const touhouTrader = initializeTouhouTrader(); // Open trading separately from the conversation-memory database.
  let stopGitHubWatcher = () => {};

  // Handle message events
  client.on("messageCreate", async (message) => {
    if (message.author.bot) return; // Bot messages must never spend currency or trigger another bot reply.
    if (touhouTrader && await touhouTrader.handleMessage(message)) return; // Consume trader commands before calling the language model.
    // Gate to specific channel if configured
    if (CHANNEL_ID && message.channel.id !== CHANNEL_ID) {
      console.log(`🔇 Ignoring message in channel ${message.channel.id} (gate: ${CHANNEL_ID})`);
      return;
    }
    await handleMessage(message, client.user.id);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (touhouTrader) await touhouTrader.handleInteraction(interaction);
  }); // Route slash commands and menu buttons directly to the trader's authorization checks.
  client.on(Events.GuildCreate, async (guild) => {
    if (touhouTrader) await touhouTrader.registerGuild(guild);
  }); // Make the trader available when the bot joins another server.

  // Login
  client.once(Events.ClientReady, () => {
    console.log(`🌸 Sakura is online and ready to cuddle! (${client.user.tag})`);
    stopGitHubWatcher = startGitHubActivityWatcher(client);
    if (touhouTrader) {
      for (const guild of client.guilds.cache.values()) void touhouTrader.registerGuild(guild);
    } // Register guild commands after login without delaying the Discord-ready log used by deployment.
  });

  client.login(DISCORD_TOKEN);

  // Graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\n🌸 Sakura is going to sleep... Sweet dreams!");
    stopGitHubWatcher();
    await client.destroy();
    touhouTrader?.close(); // Flush and close trading state before the process exits.
    process.exit(0);
  });
}

main().catch(console.error);
