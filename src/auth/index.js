import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { authConfig } from "./config.js";
import { IdentityStore } from "./store.js";
import { createOidc } from "./oidc.js";
import { createAuthServer } from "./server.js";
import { handleWalletInteraction } from "../wallet/commands.js";

export function buildIdentityCommand() {
  return new SlashCommandBuilder().setName("lidollid").setDescription("Connect your LiD0llID account")
    .addSubcommand(c => c.setName("login").setDescription("Sign in with LiD0llID"))
    .addSubcommand(c => c.setName("confirm").setDescription("Finish your browser sign-in")
      .addStringOption(o => o.setName("code").setDescription("Code shown after signing in").setRequired(true).setMinLength(32).setMaxLength(32)))
    .addSubcommand(c => c.setName("status").setDescription("Check your linked account"))
    .addSubcommand(c => c.setName("unlink").setDescription("Remove your LiDollBot account link"))
    .addSubcommandGroup(g => g.setName("wallet").setDescription("Connect Little Log stars and LiDollcoins")
      .addSubcommand(c => c.setName("connect").setDescription("Approve your Little Log wallet for Touhou adoption"))
      .addSubcommand(c => c.setName("balance").setDescription("Privately check your online stars and LiDollcoins"))
      .addSubcommand(c => c.setName("retry").setDescription("Safely finish an interrupted adoption or refund"))
      .addSubcommand(c => c.setName("disconnect").setDescription("Revoke your Little Log wallet connection")));
} // Add a dedicated command without replacing the trader or any other application's commands.

export function createIdentityHandler(store, config, wallet = null) {
  return async interaction => {
    if (await handleWalletInteraction(interaction, wallet, store)) return true;
    if (!interaction.isChatInputCommand() || interaction.commandName !== "lidollid") return false;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    let content;
    try {
      const discordId = interaction.user.id;
      switch (interaction.options.getSubcommand()) {
        case "login": {
          const ticket = store.begin(discordId);
          content = `Sign in with LiD0llID: ${config.origin}/auth/login?ticket=${ticket}\nOpen this link in your browser and press Continue with LiD0llID. This private link expires in 10 minutes. After signing in, use the confirmation code here. Do not share the link or confirm someone else's sign-in.`;
          break;
        }
        case "confirm": {
          store.confirm(discordId, interaction.options.getString("code", true));
          content = "Your LiD0llID account is now linked. Use /lidollid status to check it.";
          break;
        }
        case "status": {
          const account = store.get(discordId);
          content = account ? `Linked LiD0llID username: ${account.username}\nVerified at: ${new Date(account.linked_at).toISOString()}` : "No LiD0llID linked. Use /lidollid login to sign in.";
          break;
        }
        case "unlink":
          await wallet?.disconnect(discordId); // Revoke wallet access and settle pending purchases before removing identity.
          store.unlink(discordId);
          content = "Your LiDollBot account link and pending sign-ins were removed. Your shared LiD0llID browser session remains signed in.";
          break;
        default: content = "Unknown account command.";
      }
    } catch (error) {
      content = error.code?.startsWith("SQLITE") ? "Account storage is unavailable. Please try again later." : error.message;
    }
    await interaction.editReply({ content, allowedMentions: { parse: [] }, flags: MessageFlags.SuppressEmbeds });
    return true;
  }; // Only Discord's authenticated interaction user can read, confirm or remove their link; replies stay private.
}

export async function initializeIdentity(wallet = null) {
  const config = authConfig();
  if (!config) return null;
  fs.mkdirSync(fileURLToPath(new URL("../../data/", import.meta.url)), { recursive: true });
  const store = new IdentityStore(fileURLToPath(new URL("../../data/lidollid.db", import.meta.url)));
  const server = createAuthServer(config, store, createOidc(config));
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(config.port, config.host, resolve); });
  } catch (error) { store.close(); throw error; }
  const cleanup = setInterval(() => store.prune(), 60000);
  cleanup.unref();
  console.log(`[LiD0llID] Callback listener ready on ${config.host}:${config.port}.`);
  return {
    handleInteraction: createIdentityHandler(store, config, wallet),
    async registerGuild(guild) {
      try { await guild.commands.create(buildIdentityCommand()); }
      catch { console.error(`[LiD0llID] Could not register /lidollid in guild ${guild.id}.`); }
    },
    async close() {
      clearInterval(cleanup);
      await new Promise(resolve => server.close(resolve));
      store.close();
    }, // Let in-flight callbacks finish before closing their database.
  };
} // Start the optional HTTP listener before Discord readiness so bind/configuration failures cannot look like healthy deployments.
