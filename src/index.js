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
import { createSwearJar } from "./swearJar.js";
import { reportModelEndpoints } from "./graph/connection.js";
import { readFileSync } from "node:fs";
import { createMemberWelcome } from "./welcome.js";
import { createReportPublisher } from "./reports/publisher.js";
import { initializeCommunity } from "./admin/index.js";
import { createOnlinePublisher } from "./mmo/online.js";

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;

if (!DISCORD_TOKEN) {
  console.error("🌸 Missing DISCORD_TOKEN in .env file!");
  process.exit(1);
}

async function main() {
  try {
    const release = JSON.parse(readFileSync(new URL("../release.json", import.meta.url), "utf8"));
    console.log(`[Release] ${release.revision}${release.modified ? " (local changes)" : ""}; deployed ${release.deployment}`);
  } catch { console.log("[Release] Checkout or older deployment without release metadata."); } // Identify stale releases directly in the same startup log as feature readiness.
  console.log("🌸 Sakura is waking up...");
  console.log(`🔒 Channel gate set to: ${CHANNEL_ID || "unlocked (all channels)"}`);

  // Initialize the SQLite memory database
  await initCheckpointer();

  // Create and login the Discord client
  const client = createClient();
  const community = initializeCommunity(client);
  const welcome = createMemberWelcome(client);
  const reports = createReportPublisher(client); // Open durable report delivery storage before Discord starts.
  const mmoOnline = createOnlinePublisher(client); // Read only authenticated game-server arrivals, independently of bot account linking.
  client.on(Events.GuildMemberAdd, member => { if (community.enabled(member.guild.id, "welcomes")) void welcome.handleMemberAdd(member); }); // Server admins can pause welcomes without changing global deployment settings.
  const wallet = initializeWallet(); // Enable consent-based online stars and coins only when configured.
  const touhouTrader = initializeTouhouTrader(wallet); // Open trading separately from the conversation-memory database.
  const identity = await initializeIdentity(wallet, touhouTrader, client, community); // Load all pending game payments before exposing browser purchases and admin routes.
  const swearJar = createSwearJar(client, wallet, identity?.identities);
  let stopGitHubWatcher = () => {};

  // Handle message events
  client.on("messageCreate", async (message) => {
    if (message.author.bot) return; // Bot messages must never spend currency or trigger another bot reply.
    try { if (swearJar && (!message.guildId || community.enabled(message.guildId, "swearJar")) && await swearJar.handleMessage(message)) return; }
    catch { console.error("[Swear jar] Could not process a message; check storage availability."); }
    if (identity && await identity.handleMessage(message)) return; // Open the web game before the conversation channel gate or LLM routing.
    if (touhouTrader && await touhouTrader.handleMessage(message)) return; // Consume trader commands before calling the language model.
    if (message.guildId && !community.enabled(message.guildId, "chat")) return;
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
    community.start(); // Partial reaction events and periodic reconciliation use the same saved per-server settings as the admin panel.
    reports?.start(); // Poll completed nightly and explicitly shared reports independently of chat and wallet configuration.
    mmoOnline?.start();
    swearJar?.start(); // Recover saved payments and check weekly draws once Discord can resolve members and channels.
    void reportModelEndpoints().catch(() => console.error("[Brain] Startup probe could not finish; run scripts/check-runtime.mjs."));
    if (identity) for (const guild of client.guilds.cache.values()) void identity.registerGuild(guild);
    if (touhouTrader) {
      for (const guild of client.guilds.cache.values()) void touhouTrader.registerGuild(guild);
    } // Register guild commands after login without delaying the Discord-ready log used by deployment.
  });

  await client.login(DISCORD_TOKEN);

  // Graceful shutdown
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\n🌸 Sakura is going to sleep... Sweet dreams!");
    stopGitHubWatcher();
    await reports?.stop(); // Finish report receipts before closing storage or disconnecting Discord.
    await mmoOnline?.stop();
    await welcome.stop(); // Stop new greetings and finish any Discord send before destroying the client.
    await swearJar?.stop(); // Stop scheduled draws and finish replies before closing identity or wallet storage.
    await identity?.close(); // Finish browser callbacks before closing account storage.
    await community.stop(); community.store.close(); // Drain reaction operations after admin HTTP writes, then close their journal.
    await client.destroy();
    await wallet?.close(); // Finish payment journaling before closing trader storage.
    identity?.closeGames(); // Keep the diaper journal open until every wallet action has drained.
    touhouTrader?.close(); // Flush and close trading state before the process exits.
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown); // Fedora service stops must drain the same journals as an interactive stop.
}

main().catch(error => { console.error(error); process.exit(1); }); // Fail startup visibly if authentication cannot bind or Discord login fails.
