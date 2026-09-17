import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, SlashCommandBuilder } from "discord.js";
import { authConfig } from "./config.js";
import { IdentityStore } from "./store.js";
import { createOidc } from "./oidc.js";
import { createAuthServer } from "./server.js";
import { handleWalletInteraction, runWalletAction } from "../wallet/commands.js";
import { awardLinkedRole } from "./linkedRole.js";
import { initializeGacha } from "../gacha/index.js";
import { IdentityMenus } from "./menu.js";
import { initializeHangman } from "../hangman/index.js";
import { initializeBallDrop } from "../balldrop/index.js";
import { initializeGoFish } from "../gofish/index.js";
import { initializeTouhouWeb } from "../touhou/web.js";
import { createGameLogin } from "../games/login.js";
import { CoinLeaderboard, createLeaderboardWeb } from "../leaderboard/web.js";

export function buildIdentityCommand() {
  return new SlashCommandBuilder().setName("lidollid").setDescription("Connect your LiD0llID account")
    .addSubcommand(c => c.setName("menu").setDescription("Open your account, wallet and admin gift buttons"))
    .addSubcommand(c => c.setName("login").setDescription("Connect your LiD0llID account and wallet"))
    .addSubcommand(c => c.setName("confirm").setDescription("Finish your browser sign-in")
      .addStringOption(o => o.setName("code").setDescription("Code shown after signing in").setRequired(true).setMinLength(32).setMaxLength(32)))
    .addSubcommand(c => c.setName("status").setDescription("Check your linked account"))
    .addSubcommand(c => c.setName("unlink").setDescription("Unlink your account and wallet, or reset an unfinished sign-in"))
    .addSubcommandGroup(g => g.setName("wallet").setDescription("Connect Little Log stars and LiDollcoins")
      .addSubcommand(c => c.setName("menu").setDescription("Open your account, wallet and admin gift buttons"))
      .addSubcommand(c => c.setName("connect").setDescription("Connect your LiD0llID account and wallet"))
      .addSubcommand(c => c.setName("balance").setDescription("Privately check your online stars, diamonds and LiDollcoins"))
      .addSubcommand(c => c.setName("retry").setDescription("Finish your pending payment, gift, reward or refund"))
      .addSubcommand(c => c.setName("gift").setDescription("(Admin) Give someone online coins, stars or diamonds")
        .addUserOption(o => o.setName("user").setDescription("Recipient with a connected wallet").setRequired(true))
        .addStringOption(o => o.setName("currency").setDescription("Currency to give").setRequired(true)
          .addChoices({ name: "LiDollcoins", value: "coins" }, { name: "Stars", value: "stars" }, { name: "Diamonds", value: "diamonds" }))
        .addIntegerOption(o => o.setName("amount").setDescription("Amount to give").setMinValue(1).setMaxValue(1_000_000).setRequired(true)))
      .addSubcommand(c => c.setName("gift-retry").setDescription("(Admin) Finish a recipient's pending gift without paying twice")
        .addUserOption(o => o.setName("user").setDescription("Recipient of a pending gift in this server").setRequired(true)))
      .addSubcommand(c => c.setName("disconnect").setDescription("Revoke your Little Log wallet connection")));
} // Add a dedicated command without replacing the trader or any other application's commands.

export function createIdentityHandler(store, config, wallet = null, gacha = null, trader = null, hangman = null, touhouWeb = null, balldrop = null, gofish = null) {
  const accountAction = (interaction, action, options) => runIdentityAction(interaction, store, config, wallet, gacha, action, options, hangman, touhouWeb, balldrop, gofish);
  const menus = new IdentityMenus({
    accountAction, walletAction: (interaction, action, options) => runWalletAction(interaction, wallet, store, action, options),
    atelier: gacha?.linkMessage, trader: trader?.openMenu, hangman: hangman?.linkMessage,
    balldrop: balldrop?.linkMessage,
    gofish: gofish?.linkMessage,
    leaderboardUrl: wallet ? `${config.origin}/leaderboard/` : null,
  }); // Menus share the slash-command actions, including linked-role assignment and payment recovery.
  return async interaction => {
    if (await menus.handleInteraction(interaction)) return true;
    if (hangman && await hangman.handleInteraction(interaction)) return true;
    if (balldrop && await balldrop.handleInteraction(interaction)) return true;
    if (gofish && await gofish.handleInteraction(interaction)) return true;
    if (gacha && await gacha.handleInteraction(interaction)) return true;
    const unlinkButton = interaction.isButton?.() && interaction.customId?.startsWith("lidollid:unlink:");
    const combined=Boolean(wallet?.stageIdentity);
    const walletLogin=combined&&interaction.isChatInputCommand()&&interaction.commandName==='lidollid'&&interaction.options.getSubcommandGroup?.()==='wallet'&&interaction.options.getSubcommand()==='connect';
    if (!unlinkButton && !walletLogin && await handleWalletInteraction(interaction, wallet, store)) return true;
    if (!unlinkButton && (!interaction.isChatInputCommand() || interaction.commandName !== "lidollid")) return false;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (unlinkButton && interaction.customId !== `lidollid:unlink:${interaction.user.id}`) {
      await interaction.editReply({ content: "Use /lidollid status to manage your own account link.", allowedMentions: { parse: [] } });
      return true;
    }
    const result = await accountAction(interaction, unlinkButton ? "unlink" : walletLogin ? "login" : interaction.options.getSubcommand());
    await interaction.editReply({ ...result, allowedMentions: { parse: [] }, flags: MessageFlags.SuppressEmbeds });
    return true;
  }; // Only Discord's authenticated interaction user can read, confirm or remove their link; replies stay private.
}

export async function runIdentityAction(interaction, store, config, wallet, gacha, action, options = interaction.options, hangman = null, touhouWeb = null, balldrop = null, gofish = null) {
    const combined = Boolean(wallet?.stageIdentity);
    let content;
    let components = [];
    try {
      const discordId = interaction.user.id;
      switch (action) {
        case "login": {
          const ticket = combined ? await wallet.exclusive(discordId, () => store.begin(discordId, true)) : store.begin(discordId); // Keep a new login from replacing an in-flight wallet confirmation.
          content = `Connect your LiD0llID account${combined ? " and wallet" : ""}: ${config.origin}/auth/login?ticket=${ticket}\nOpen this link in your browser and press Continue with LiD0llID. This private link expires in 10 minutes. After signing in, use the confirmation code here. Do not share the link or confirm someone else's sign-in.`;
          break;
        }
        case "confirm": {
          const code=options.getString("code",true);
          if(combined)await wallet.confirmIdentity(discordId,store.pendingConfirmation(discordId,code),activate=>store.confirm(discordId,code,activate),()=>store.pendingConfirmation(discordId,code));
          else store.confirm(discordId,code);
          content=combined?"Your LiD0llID account and wallet are connected. Use /lidollid wallet balance to check your stars, coins and diamonds.":"Your LiD0llID account is now linked. Use /lidollid status to check it.";
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
          hangman?.revoke(discordId);
          balldrop?.revoke(discordId);
          gofish?.revoke(discordId);
          touhouWeb?.revoke(discordId);
          content = "Your LiDollBot account link, wallet connection and pending sign-ins were removed. Your stars, LiDollcoins, Touhou collection and awarded Discord role stay. Your shared LiD0llID browser session remains signed in.\nReady to test again? Run /lidollid login for a fresh link. To choose a different LiD0llID, sign out in your browser first or open the fresh link in a private window.";
          break;
        default: content = "Unknown account command.";
      }
    } catch (error) {
      content = error.code?.startsWith("SQLITE") ? "Account storage is unavailable. Please try again later." : error.message;
    }
    return { content, components };
} // Reuse the same account validation, revocation and role behavior from slash commands and menu buttons.

export async function initializeIdentity(wallet = null, trader = null, client = null) {
  const config = authConfig();
  if (!config) return null;
  fs.mkdirSync(fileURLToPath(new URL("../../data/", import.meta.url)), { recursive: true });
  if(wallet&&wallet.client.config.clientId!==config.clientId)throw new Error("Combined login requires matching LiD0llID and wallet client IDs.");
  const store = new IdentityStore(fileURLToPath(new URL("../../data/lidollid.db", import.meta.url)));
  if(wallet)wallet.identityFor=id=>store.gameIdentity(id);
  const gacha = initializeGacha(config, store, wallet);
  const hangman = initializeHangman(config, store, wallet);
  const balldrop = initializeBallDrop(config, store, wallet); // Register pending bet guards before opening the shared listener.
  const gofish = initializeGoFish(config, store, wallet); // Register pending book rewards before opening the shared listener.
  const touhouWeb = initializeTouhouWeb(config, store, trader, client);
  const games = Object.fromEntries([["diapers", gacha, "Diaper Atelier"], ["clothes", gacha, "Clothes Emporium"], ["littlepottchi", gacha, "Littlepottchi"], ["hangman", hangman, "Cozy Hangman"], ["balldrop", balldrop, "Prism Drop"], ["gofish", gofish, "Go Fish"], ["touhou", touhouWeb, "Touhou Trader"]]
    .filter(([, game]) => game).map(([key, game, title]) => [key, { sessions: game.sessions, title }]));
  const gameLogin = createGameLogin(config, store, createOidc(config, Boolean(wallet), { statePrefix: "game." }), games, Date.now, wallet);
  const leaderboardWeb = wallet ? createLeaderboardWeb(config, new CoinLeaderboard(store, wallet)) : null;
  const gameWeb = async (request, response) => Boolean(await leaderboardWeb?.(request, response) || await gameLogin.route(request, response) || await gacha?.web(request, response) || await hangman?.web(request, response) || await balldrop?.web(request, response) || await gofish?.web(request, response) || await touhouWeb?.web(request, response));
  const server = createAuthServer(config, store, createOidc(config,Boolean(wallet)),wallet,gameWeb);
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(config.port, config.host, resolve); });
  } catch (error) { gacha?.close(); hangman?.close(); balldrop?.close(); gofish?.close(); store.close(); throw error; }
  const cleanup = setInterval(() => {store.prune();wallet?.pruneProofs();gacha?.prune();hangman?.prune();balldrop?.prune();gofish?.prune();touhouWeb?.prune();gameLogin.prune();}, 60000);
  cleanup.unref();
  console.log(`[LiD0llID] Callback listener ready on ${config.host}:${config.port}.`);
  return {
    handleInteraction: createIdentityHandler(store, config, wallet, gacha, trader, hangman, touhouWeb, balldrop, gofish),
    identities: store, // Share verified Discord links with the swear jar's server-membership checks.
    handleMessage: async message => Boolean(await gacha?.handleMessage(message) || await hangman?.handleMessage(message) || await balldrop?.handleMessage(message) || await gofish?.handleMessage(message)),
    closeGames: () => { gacha?.close(); hangman?.close(); balldrop?.close(); gofish?.close(); }, // Game journals remain open until wallet actions drain at shutdown.
    async registerGuild(guild) {
      try { await guild.commands.create(buildIdentityCommand()); }
      catch { console.error(`[LiD0llID] Could not register /lidollid in guild ${guild.id}.`); }
      try { await guild.commands.create(new SlashCommandBuilder().setName("menu").setDescription("Open LiDollBot's account, wallet, games and admin gift menu")); }
      catch { console.error(`[LiD0llID] Could not register /menu in guild ${guild.id}.`); }
      await gacha?.registerGuild(guild);
      await hangman?.registerGuild(guild);
      await balldrop?.registerGuild(guild);
      await gofish?.registerGuild(guild);
    },
    async close() {
      clearInterval(cleanup);
      await new Promise(resolve => server.close(resolve));
      store.close();
    }, // Let in-flight callbacks finish before closing their database.
  };
} // Start the optional HTTP listener before Discord readiness so bind/configuration failures cannot look like healthy deployments.
