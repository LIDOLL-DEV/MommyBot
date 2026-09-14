import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, SlashCommandBuilder } from "discord.js";
import { authConfig } from "./config.js";
import { IdentityStore } from "./store.js";
import { createOidc } from "./oidc.js";
import { createAuthServer } from "./server.js";
import { handleWalletInteraction } from "../wallet/commands.js";
import { awardLinkedRole } from "./linkedRole.js";
import { initializeGacha } from "../gacha/index.js";

export function buildIdentityCommand() {
  return new SlashCommandBuilder().setName("lidollid").setDescription("Connect your LiD0llID account")
    .addSubcommand(c => c.setName("login").setDescription("Connect your LiD0llID account and wallet"))
    .addSubcommand(c => c.setName("confirm").setDescription("Finish your browser sign-in")
      .addStringOption(o => o.setName("code").setDescription("Code shown after signing in").setRequired(true).setMinLength(32).setMaxLength(32)))
    .addSubcommand(c => c.setName("status").setDescription("Check your linked account"))
    .addSubcommand(c => c.setName("unlink").setDescription("Unlink your account and wallet, or reset an unfinished sign-in"))
    .addSubcommandGroup(g => g.setName("wallet").setDescription("Connect Little Log stars and LiDollcoins")
      .addSubcommand(c => c.setName("connect").setDescription("Connect your LiD0llID account and wallet"))
      .addSubcommand(c => c.setName("balance").setDescription("Privately check your online stars and LiDollcoins"))
      .addSubcommand(c => c.setName("retry").setDescription("Finish your pending payment, gift, reward or refund"))
      .addSubcommand(c => c.setName("gift").setDescription("(Admin) Give someone online LiDollcoins or stars")
        .addUserOption(o => o.setName("user").setDescription("Recipient with a connected wallet").setRequired(true))
        .addStringOption(o => o.setName("currency").setDescription("Currency to give").setRequired(true)
          .addChoices({ name: "LiDollcoins", value: "coins" }, { name: "Stars", value: "stars" }))
        .addIntegerOption(o => o.setName("amount").setDescription("Amount to give").setMinValue(1).setMaxValue(1_000_000).setRequired(true)))
      .addSubcommand(c => c.setName("gift-retry").setDescription("(Admin) Finish a recipient's pending gift without paying twice")
        .addUserOption(o => o.setName("user").setDescription("Recipient of a pending gift in this server").setRequired(true)))
      .addSubcommand(c => c.setName("disconnect").setDescription("Revoke your Little Log wallet connection")));
} // Add a dedicated command without replacing the trader or any other application's commands.

export function createIdentityHandler(store, config, wallet = null, gacha = null) {
  return async interaction => {
    if (gacha && await gacha.handleInteraction(interaction)) return true;
    const unlinkButton = interaction.isButton?.() && interaction.customId?.startsWith("lidollid:unlink:");
    const combined=Boolean(wallet?.stageIdentity);
    const walletLogin=combined&&interaction.isChatInputCommand()&&interaction.commandName==='lidollid'&&interaction.options.getSubcommandGroup?.()==='wallet'&&interaction.options.getSubcommand()==='connect';
    if (!unlinkButton && !walletLogin && await handleWalletInteraction(interaction, wallet, store)) return true;
    if (!unlinkButton && (!interaction.isChatInputCommand() || interaction.commandName !== "lidollid")) return false;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    let content;
    let components = [];
    try {
      const discordId = interaction.user.id;
      if (unlinkButton && interaction.customId !== `lidollid:unlink:${discordId}`) {
        throw new Error("Use /lidollid status to manage your own account link.");
      } // A button can only unlink the Discord user whose private status message created it.
      switch (unlinkButton ? "unlink" : walletLogin ? "login" : interaction.options.getSubcommand()) {
        case "login": {
          const ticket = combined ? await wallet.exclusive(discordId, () => store.begin(discordId, true)) : store.begin(discordId); // Keep a new login from replacing an in-flight wallet confirmation.
          content = `Connect your LiD0llID account${combined ? " and wallet" : ""}: ${config.origin}/auth/login?ticket=${ticket}\nOpen this link in your browser and press Continue with LiD0llID. This private link expires in 10 minutes. After signing in, use the confirmation code here. Do not share the link or confirm someone else's sign-in.`;
          break;
        }
        case "confirm": {
          const code=interaction.options.getString("code",true);
          if(combined)await wallet.confirmIdentity(discordId,store.pendingConfirmation(discordId,code),activate=>store.confirm(discordId,code,activate),()=>store.pendingConfirmation(discordId,code));
          else store.confirm(discordId,code);
          content=combined?"Your LiD0llID account and wallet are connected. Use /lidollid wallet balance to check your stars and coins.":"Your LiD0llID account is now linked. Use /lidollid status to check it.";
          content += `\n${await awardLinkedRole(interaction, () => Boolean(store.get(discordId)), config.linkedRoleId)}`;
          break;
        }
        case "status": {
          const account = store.get(discordId);
          content = account ? `Linked LiD0llID username: ${account.username}\nVerified at: ${new Date(account.linked_at).toISOString()}` : "No LiD0llID linked. Use /lidollid login to sign in.";
          if (account) content += `\n${await awardLinkedRole(interaction, () => Boolean(store.get(discordId)), config.linkedRoleId)}`;
          content += "\nUse Unlink account to remove your account and wallet connection or cancel an unfinished sign-in. Your balances, Touhou collection and awarded role stay.";
          components = [new ActionRowBuilder().addComponents(new ButtonBuilder()
            .setCustomId(`lidollid:unlink:${discordId}`).setLabel("Unlink account").setStyle(ButtonStyle.Danger))];
          break;
        }
        case "unlink":
          await wallet?.disconnect(discordId); // Require wallet revocation and refuse unsettled payments before removing identity.
          store.unlink(discordId);
          gacha?.revoke(discordId); // Invalidate every browser game session when its identity link is removed.
          content = "Your LiDollBot account link, wallet connection and pending sign-ins were removed. Your stars, LiDollcoins, Touhou collection and awarded Discord role stay. Your shared LiD0llID browser session remains signed in.\nReady to test again? Run /lidollid login for a fresh link. To choose a different LiD0llID, sign out in your browser first or open the fresh link in a private window.";
          break;
        default: content = "Unknown account command.";
      }
    } catch (error) {
      content = error.code?.startsWith("SQLITE") ? "Account storage is unavailable. Please try again later." : error.message;
    }
    await interaction.editReply({ content, components, allowedMentions: { parse: [] }, flags: MessageFlags.SuppressEmbeds });
    return true;
  }; // Only Discord's authenticated interaction user can read, confirm or remove their link; replies stay private.
}

export async function initializeIdentity(wallet = null) {
  const config = authConfig();
  if (!config) return null;
  fs.mkdirSync(fileURLToPath(new URL("../../data/", import.meta.url)), { recursive: true });
  if(wallet&&wallet.client.config.clientId!==config.clientId)throw new Error("Combined login requires matching LiD0llID and wallet client IDs.");
  const store = new IdentityStore(fileURLToPath(new URL("../../data/lidollid.db", import.meta.url)));
  if(wallet)wallet.identityFor=id=>store.get(id);
  const gacha = initializeGacha(config, store, wallet);
  const server = createAuthServer(config, store, createOidc(config,Boolean(wallet)),wallet,gacha?.web);
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(config.port, config.host, resolve); });
  } catch (error) { gacha?.close(); store.close(); throw error; }
  const cleanup = setInterval(() => {store.prune();wallet?.pruneProofs();gacha?.prune();}, 60000);
  cleanup.unref();
  console.log(`[LiD0llID] Callback listener ready on ${config.host}:${config.port}.`);
  return {
    handleInteraction: createIdentityHandler(store, config, wallet, gacha),
    handleMessage: message => gacha?.handleMessage(message) || false,
    closeGames: () => gacha?.close(),
    async registerGuild(guild) {
      try { await guild.commands.create(buildIdentityCommand()); }
      catch { console.error(`[LiD0llID] Could not register /lidollid in guild ${guild.id}.`); }
      await gacha?.registerGuild(guild);
    },
    async close() {
      clearInterval(cleanup);
      await new Promise(resolve => server.close(resolve));
      store.close();
    }, // Let in-flight callbacks finish before closing their database.
  };
} // Start the optional HTTP listener before Discord readiness so bind/configuration failures cannot look like healthy deployments.
