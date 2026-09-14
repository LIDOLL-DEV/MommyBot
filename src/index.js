import "dotenv/config";
import process from "process";
import { Events } from "discord.js"; // Use the library's current event names instead of deprecated aliases.
import { createClient } from "./bot/client.js";
import { handleMessage } from "./bot/handlers/message.js";
import { initCheckpointer } from "./db/checkpointer.js";
import { startGitHubActivityWatcher } from "./github/activityWatcher.js";
import { initializeTouhouTrader } from "./touhou/index.js";
import { initializeIdentity } from "./auth/index.js";
import { initializeWallet } from "./wallet/index.js";

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
  const wallet = initializeWallet(); // Enable consent-based online stars and coins only when configured.
  const touhouTrader = initializeTouhouTrader(wallet); // Open trading separately from the conversation-memory database.
  const identity = await initializeIdentity(wallet, touhouTrader); // Load all pending game payments before exposing browser purchases.
  let stopGitHubWatcher = () => {};

  // Handle message events
  client.on("messageCreate", async (message) => {
    if (message.author.bot) return; // Bot messages must never spend currency or trigger another bot reply.
    if (identity && await identity.handleMessage(message)) return; // Open the web game before the conversation channel gate or LLM routing.
    if (touhouTrader && await touhouTrader.handleMessage(message)) return; // Consume trader commands before calling the language model.
    // Gate to specific channel if configured
    if (CHANNEL_ID && message.channel.id !== CHANNEL_ID) {
      console.log(`🔇 Ignoring message in channel ${message.channel.id} (gate: ${CHANNEL_ID})`);
      return;
    }
    await handleMessage(message, client.user.id);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (identity && await identity.handleInteraction(interaction)) return;
      if (touhouTrader) await touhouTrader.handleInteraction(interaction);
    } catch {
      console.error("[Discord] Could not complete an interaction; retry the command.");
    } // Network or expired-interaction failures must not crash the bot or log private command input.
  }); // Route slash commands and menu buttons directly to the trader's authorization checks.
  client.on(Events.GuildCreate, async (guild) => {
    if (identity) await identity.registerGuild(guild);
    if (touhouTrader) await touhouTrader.registerGuild(guild);
  }); // Make the trader available when the bot joins another server.

  // Login
  client.once(Events.ClientReady, () => {
    console.log(`🌸 Sakura is online and ready to cuddle! (${client.user.tag})`);
    stopGitHubWatcher = startGitHubActivityWatcher(client);
    if (identity) for (const guild of client.guilds.cache.values()) void identity.registerGuild(guild);
    if (touhouTrader) {
      for (const guild of client.guilds.cache.values()) void touhouTrader.registerGuild(guild);
    } // Register guild commands after login without delaying the Discord-ready log used by deployment.
  });

  await client.login(DISCORD_TOKEN);

  // Graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\n🌸 Sakura is going to sleep... Sweet dreams!");
    stopGitHubWatcher();
    await identity?.close(); // Finish browser callbacks before closing account storage.
    await client.destroy();
    await wallet?.close(); // Finish payment journaling before closing trader storage.
    identity?.closeGames(); // Keep the diaper journal open until every wallet action has drained.
    touhouTrader?.close(); // Flush and close trading state before the process exits.
    process.exit(0);
  });
}

main().catch(error => { console.error(error); process.exit(1); }); // Fail startup visibly if authentication cannot bind or Discord login fails.
