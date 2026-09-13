import path from "node:path";
import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  MessageFlags, PermissionFlagsBits, SlashCommandBuilder,
} from "discord.js";
import { IMAGE_DIRECTORY, rarity } from "./catalog.js";
import { TraderError } from "./store.js";
import { BattleService } from "./battles.js";
import { TouhouMenus } from "./menu.js";
import { RARITIES } from "./battleRules.js";

const PAGE_SIZE = 10;
const noMentions = { parse: [], repliedUser: false };
const currencyLabel = (currency) => currency === "stars" ? "star(s)" : "LiDollcoins";

export function buildTouhouCommand() {
  const command = new SlashCommandBuilder().setName("touhou").setDescription("Adopt, collect and trade Touhous.").setDMPermission(false);
  command.addSubcommand((s) => s.setName("menu").setDescription("Open the Touhou trader: 1 star or 25 LiDollcoins per adoption."));
  command.addSubcommand((s) => s.setName("adopt").setDescription("Adopt one random available Touhou.")
    .addStringOption((o) => o.setName("payment").setDescription("Choose one payment method").setRequired(true)
      .addChoices({ name: "1 star", value: "stars" }, { name: "25 LiDollcoins", value: "coins" })));
  for (const name of ["collection", "wallet"]) {
    command.addSubcommand((s) => {
      s.setName(name).setDescription(name === "collection" ? "View a Touhou collection." : "View stars and LiDollcoins.")
        .addUserOption((o) => o.setName("user").setDescription("Player (defaults to you)"));
      if (name === "collection") s.addIntegerOption((o) => o.setName("page").setDescription("Page number").setMinValue(1));
      return s;
    });
  }
  command.addSubcommand((s) => s.setName("market").setDescription("Browse adoption stock and player listings.")
    .addIntegerOption((o) => o.setName("page").setDescription("Page number").setMinValue(1)));
  for (const [name, description] of Object.entries({ info: "Show a character and its artwork.", delist: "Remove your sale listing.", buy: "Buy a listed Touhou at its current LiDollcoin price." })) {
    command.addSubcommand((s) => s.setName(name).setDescription(description)
      .addStringOption((o) => o.setName("name").setDescription("Touhou name").setRequired(true)));
  }
  command.addSubcommand((s) => s.setName("send").setDescription("Gift one of your Touhous to another player.")
    .addStringOption((o) => o.setName("name").setDescription("Your Touhou").setRequired(true))
    .addUserOption((o) => o.setName("user").setDescription("Recipient").setRequired(true)));
  command.addSubcommand((s) => s.setName("trade").setDescription("Offer a swap; the other player must accept within one minute.")
    .addStringOption((o) => o.setName("yours").setDescription("Your Touhou").setRequired(true))
    .addUserOption((o) => o.setName("user").setDescription("Other player").setRequired(true))
    .addStringOption((o) => o.setName("theirs").setDescription("Their Touhou").setRequired(true)));
  command.addSubcommand((s) => s.setName("sell").setDescription("List your Touhou for LiDollcoins.")
    .addStringOption((o) => o.setName("name").setDescription("Your Touhou").setRequired(true))
    .addIntegerOption((o) => o.setName("price").setDescription("LiDollcoin asking price").setMinValue(1).setMaxValue(1_000_000).setRequired(true)));
  command.addSubcommand((s) => s.setName("release").setDescription("Return your Touhou to the trader without a refund.")
    .addStringOption((o) => o.setName("name").setDescription("Your Touhou").setRequired(true))
    .addBooleanOption((o) => o.setName("confirm").setDescription("Confirm release without a refund").setRequired(true)));
  command.addSubcommand((s) => s.setName("award").setDescription("(Manage Server) Award stars or LiDollcoins.")
    .addUserOption((o) => o.setName("user").setDescription("Recipient").setRequired(true))
    .addStringOption((o) => o.setName("currency").setDescription("Reward currency").setRequired(true)
      .addChoices({ name: "Stars", value: "stars" }, { name: "LiDollcoins", value: "coins" }))
    .addIntegerOption((o) => o.setName("amount").setDescription("Amount to award").setMinValue(1).setMaxValue(1_000_000).setRequired(true)));
  command.addSubcommand((s) => s.setName("battle").setDescription("Start a turn-based PvE battle with your Touhou.")
    .addStringOption((o) => o.setName("name").setDescription("Your fighter").setRequired(true))
    .addStringOption((o) => o.setName("rarity").setDescription("Opponent tier").setRequired(true)
      .addChoices(...[...RARITIES, "gamble"].map((value) => ({ name: value, value })))));
  command.addSubcommand((s) => s.setName("party").setDescription("View levels, EXP, attacks and recovery timers."));
  command.addSubcommand((s) => s.setName("heal").setDescription("Heal freely after recovery, or pay 50 coins for instant healing.")
    .addStringOption((o) => o.setName("name").setDescription("Your Touhou").setRequired(true))
    .addBooleanOption((o) => o.setName("pay").setDescription("Pay 50 coins if still recovering")));
  command.addSubcommand((s) => s.setName("potions").setDescription("Buy health potions for 20 coins each (carry up to 10).")
    .addIntegerOption((o) => o.setName("amount").setDescription("How many (defaults to 1)").setMinValue(1).setMaxValue(10)));
  command.addSubcommand((s) => s.setName("buyback").setDescription("Sell your Touhou back for two-thirds of its suggested value.")
    .addStringOption((o) => o.setName("name").setDescription("Your Touhou").setRequired(true))
    .addBooleanOption((o) => o.setName("confirm").setDescription("Confirm buyback and reset this character's battle levels").setRequired(true)));
  return command.toJSON();
} // Register only the trader's own command instead of replacing unrelated bot commands.

export function canAward(interaction, adminRoleId = "") {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  const roles = interaction.member?.roles;
  return Boolean(adminRoleId && (roles?.cache?.has(adminRoleId) || (Array.isArray(roles) && roles.includes(adminRoleId))));
} // Check trusted Discord permission/role data on every reward request, including uncached guild members.

function button(id, label, style = ButtonStyle.Secondary) {
  return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
} // Keep component construction consistent across menus, pagination and trade offers.

export function createTouhouHandlers(store, { channelId = "", adminRoleId = "", imageDirectory = IMAGE_DIRECTORY } = {}) {
  const game = new BattleService(store);
  const menus = new TouhouMenus(store, game, { channelId, imageDirectory });
  function menu(guildId, userId) {
    return menus.open(guildId, userId);
  } // Open the full clickable trader, party, battle, healing and marketplace UI.

  function characterCard(character, description) {
    const profile = game.profile(character.guild_id, character.name);
    const attachmentName = `touhou${path.extname(character.filename).toLowerCase()}`;
    const attachment = new AttachmentBuilder(path.join(imageDirectory, character.filename), { name: attachmentName });
    return { files: [attachment], embeds: [new EmbedBuilder().setColor(0xd58cdb).setTitle(character.name)
      .setDescription(`${description}\n${rarity(character, profile.level)} • Lv ${profile.level} • ${character.trade_count} trades`)
      .setImage(`attachment://${attachmentName}`)] };
  } // Display the ported character artwork alongside the committed ownership result.

  function page(guildId, userId, action, requestedPage = 1, targetId = userId) {
    const entries = action === "market" ? store.market(guildId) : game.party(guildId, targetId);
    const pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
    const current = Math.max(1, Math.min(pages, Math.trunc(Number(requestedPage)) || 1));
    const lines = entries.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE).map((entry) =>
      `**${entry.name}** — ${rarity(entry, entry.level || 0)}${action === "market" ? (entry.price ? ` · ${entry.price} LiDollcoins (player listing)` : " · adoption stock") : ` · Lv ${entry.level}`}`);
    const nav = new ActionRowBuilder().addComponents(button(`th:menu:${userId}`, "Trader"));
    if (current > 1) nav.addComponents(button(`th:view:${action}:${userId}:${current - 1}:${targetId}`, "Previous"));
    if (current < pages) nav.addComponents(button(`th:view:${action}:${userId}:${current + 1}:${targetId}`, "Next"));
    return { embeds: [new EmbedBuilder().setColor(0xd58cdb).setTitle(action === "market" ? "Touhou market" : "Touhou collection")
      .setDescription((action === "market" ? "Random adoption: **1 star OR 25 LiDollcoins**.\nPlayer listings: `/touhou buy name`.\n\n" : `<@${targetId}>'s collection\n\n`) + (lines.join("\n") || "No Touhous here yet."))
      .setFooter({ text: `Page ${current}/${pages} · ${entries.length} Touhous` })], components: [nav] };
  } // Paginate stock and collections so even a complete catalog fits Discord's message limits.

  async function execute(interaction) {
    const { guildId, user } = interaction;
    const action = interaction.options.getSubcommand();
    const options = interaction.options;
    const target = options.getUser("user") || user;
    if (["send", "trade", "award"].includes(action)) {
      if (target.bot || target.id === user.id && action !== "award") throw new TraderError("Choose another human player.");
      await interaction.guild.members.fetch(target.id); // Confirm the recipient is in this server before changing ownership or balances.
    }
    switch (action) {
      case "menu": return menu(guildId, user.id);
      case "party": return menus.open(guildId, user.id, "party");
      case "battle": {
        const state = game.start(guildId, user.id, options.getString("name", true), options.getString("rarity", true), interaction.id);
        return menus.open(guildId, user.id, "battle", state.id);
      }
      case "heal": {
        const result = game.heal(guildId, user.id, options.getString("name", true), options.getBoolean("pay") === true, interaction.id);
        return { content: `**${result.name}** is ready. Healing cost: **${result.price} LiDollcoins**.` };
      }
      case "potions": {
        const result = game.buyPotions(guildId, user.id, options.getInteger("amount") || 1, interaction.id);
        return { content: `Bought potions for **${result.price} LiDollcoins**. You now carry **${result.count}/10**.` };
      }
      case "buyback": {
        if (options.getBoolean("confirm") !== true) throw new TraderError("Buyback cancelled. Use the market menu to preview the payout.");
        const result = game.buyback(guildId, user.id, options.getString("name", true), interaction.id);
        return { content: `Returned **${result.name}** for **${result.payout} LiDollcoins**. Battle levels were reset.` };
      }
      case "adopt": {
        const result = store.adopt(guildId, user.id, options.getString("payment", true), interaction.id);
        return characterCard(result.character, `<@${user.id}> adopted this Touhou for **${result.price} ${currencyLabel(result.currency)}**.`);
      }
      case "collection": return page(guildId, user.id, action, options.getInteger("page"), target.id);
      case "market": return page(guildId, user.id, action, options.getInteger("page"));
      case "wallet": {
        const wallet = store.wallet(guildId, target.id);
        return { content: `<@${target.id}> has **${wallet.stars} stars** and **${wallet.coins} LiDollcoins**.` };
      }
      case "info": {
        const entry = store.character(guildId, options.getString("name", true));
        return characterCard(entry, entry.owner_id ? `Owned by <@${entry.owner_id}>.` : "Available through random adoption.");
      }
      case "award": {
        if (!canAward(interaction, adminRoleId)) throw new TraderError("You need Manage Server or the configured trader admin role to award currency.");
        const result = store.award(guildId, user.id, target.id, options.getString("currency", true), options.getInteger("amount", true), interaction.id);
        return { content: `Awarded <@${target.id}> **${result.amount} ${currencyLabel(result.currency)}**.` };
      }
      case "send": {
        const result = store.send(guildId, user.id, target.id, options.getString("name", true), interaction.id);
        return { content: `Gifted **${result.character.name}** to <@${target.id}>.` };
      }
      case "trade": {
        const result = store.offer(guildId, user.id, target.id, options.getString("yours", true), options.getString("theirs", true), interaction.id);
        return { content: `<@${user.id}> offers **${result.offered}** for <@${target.id}>'s **${result.requested}**.\nOnly <@${target.id}> can accept or decline. Expires in one minute.`,
          allowedMentions: { parse: [], users: [target.id] }, // Notify only the specifically invited trade recipient.
          components: [new ActionRowBuilder().addComponents(
            button(`th:trade:accept:${result.id}`, "Accept swap", ButtonStyle.Success),
            button(`th:trade:decline:${result.id}`, "Decline", ButtonStyle.Danger))] };
      }
      case "sell": {
        const result = store.list(guildId, user.id, options.getString("name", true), options.getInteger("price", true), interaction.id);
        return { content: `Listed **${result.name}** for **${result.price} LiDollcoins**.` };
      }
      case "delist": {
        const result = store.delist(guildId, user.id, options.getString("name", true), interaction.id);
        return { content: `Removed the listing for **${result.name}**.` };
      }
      case "buy": {
        const result = store.buy(guildId, user.id, options.getString("name", true), interaction.id);
        return characterCard(result.character, `Bought by <@${user.id}> for **${result.price} LiDollcoins**, paid to <@${result.sellerId}>.`);
      }
      case "release": {
        if (!options.getBoolean("confirm", true)) throw new TraderError("Release cancelled; set confirm:true only to release without a refund.");
        const result = store.release(guildId, user.id, options.getString("name", true), interaction.id);
        return { content: `Returned **${result.name}** to the trader. No currency was refunded.` };
      }
      default: throw new TraderError("Open /touhou menu to use the trader.");
    }
  } // Dispatch actual Discord commands to the transactional store; no language-model decisions can spend currency.

  async function handleInteraction(interaction) {
    if (await menus.handle(interaction)) return true; // Includes select menus and modals, not just buttons.
    const slash = interaction.isChatInputCommand() && interaction.commandName === "touhou";
    const component = interaction.isButton() && interaction.customId.startsWith("th:");
    if (!slash && !component) return false;
    try {
      if (!interaction.guildId || !interaction.guild) throw new TraderError("Use the Touhou trader in a server.");
      if (channelId && interaction.channelId !== channelId) throw new TraderError(`Use the trader in <#${channelId}>.`);
      let result;
      if (component) {
        const [, action, value, owner, nonce, target] = interaction.customId.split(":");
        const intendedUser = action === "menu" ? value : owner;
        if (action !== "trade" && intendedUser !== interaction.user.id) throw new TraderError("Open your own trader menu to use these buttons.");
        if (action === "trade") {
          // Authorize before deferring an update so an unrelated player cannot clear someone else's trade message.
          const offer = store.db.prepare("SELECT to_id FROM trade_offers WHERE guild_id = ? AND id = ?").get(interaction.guildId, owner);
          if (!offer || offer.to_id !== interaction.user.id) throw new TraderError("Only the invited player can respond to this trade.");
        }
        await interaction.deferUpdate();
        if (action === "menu") result = menu(interaction.guildId, interaction.user.id);
        else if (action === "view" && ["collection", "market"].includes(value)) result = page(interaction.guildId, interaction.user.id, value, nonce, target);
        else if (action === "adopt") {
          const receipt = store.adopt(interaction.guildId, interaction.user.id, value, `menu:${nonce}`);
          result = characterCard(receipt.character, `Adopted by <@${interaction.user.id}> for **${receipt.price} ${currencyLabel(receipt.currency)}**. Use /touhou menu for another adoption.`);
        } else if (action === "trade" && ["accept", "decline"].includes(value)) {
          const receipt = store.resolveOffer(interaction.guildId, interaction.user.id, owner, value === "accept", interaction.id);
          result = { content: receipt.accepted ? `Trade complete: **${receipt.offered}** ↔ **${receipt.requested}**.` : "Trade declined. Both collections are unchanged." };
        } else throw new TraderError("This menu is no longer valid. Open /touhou menu.");
      } else {
        await interaction.deferReply();
        result = await execute(interaction);
      }
      await interaction.editReply({ content: null, embeds: [], components: [], attachments: [], allowedMentions: noMentions, ...result });
    } catch (error) {
      const content = error instanceof TraderError ? error.message : "The trader could not finish this request. Check your collection and wallet before trying again.";
      if (!(error instanceof TraderError)) console.error("[TOUHOU] Request failed:", error);
      const reply = { content, allowedMentions: noMentions };
      if (interaction.deferred || interaction.replied) await interaction.editReply({ ...reply, embeds: [], components: [], attachments: [] }).catch(console.error);
      else await interaction.reply({ ...reply, flags: MessageFlags.Ephemeral }).catch(console.error);
    }
    return true;
  } // Acknowledge interactions promptly, enforce menu ownership and keep failures out of the chat graph.

  async function handleMessage(message) {
    if (message.author.bot) return false;
    const match = message.content.match(/^!(?:touhou|lumi-touhou|2hu)(?:\s+(.*))?$/i);
    if (!match) return false;
    try {
      if (!message.guildId) throw new TraderError("Use the Touhou trader in a server.");
      if (channelId && message.channelId !== channelId) throw new TraderError(`Use the trader in <#${channelId}>.`);
      const [rawAction = "menu", ...rest] = (match[1] || "").trim().split(/\s+/);
      const action = rawAction.toLowerCase() || "menu";
      let result;
      if (action === "menu") result = menu(message.guildId, message.author.id);
      else if (["battle", "party", "heal", "potions", "shop"].includes(action)) {
        const current = action === "battle" ? game.current(message.guildId, message.author.id) : null;
        result = menus.open(message.guildId, message.author.id, action === "battle" ? (current ? "battle" : "battle-pick") : action, current?.id);
      }
      else if (["market", "collection"].includes(action)) result = page(message.guildId, message.author.id, action, Number(rest[0]) || 1);
      else if (action === "wallet") {
        const wallet = store.wallet(message.guildId, message.author.id);
        result = { content: `Your wallet: **${wallet.stars} stars • ${wallet.coins} LiDollcoins**.` };
      } else if (action === "adopt") {
        const payment = { star: "stars", stars: "stars", coin: "coins", coins: "coins", lidollcoins: "coins" }[rest[0]?.toLowerCase()];
        if (!payment || rest.length !== 1) throw new TraderError("Use !touhou adopt star or !touhou adopt coins. The price is 1 star OR 25 LiDollcoins.");
        const receipt = store.adopt(message.guildId, message.author.id, payment, message.id);
        result = characterCard(receipt.character, `Adopted for **${receipt.price} ${currencyLabel(receipt.currency)}**.`);
      } else if (action === "info") result = characterCard(store.character(message.guildId, rest.join(" ")), "Touhou details");
      else throw new TraderError("Use !touhou for the full battle and trading menu, or /touhou for individual commands.");
      await message.reply({ ...result, allowedMentions: noMentions });
    } catch (error) {
      if (!(error instanceof TraderError)) console.error("[TOUHOU] Prefix command failed:", error);
      await message.reply({ content: error instanceof TraderError ? error.message : "The trader could not finish this request. Check your wallet and collection before retrying.", allowedMentions: noMentions }).catch(console.error);
    }
    return true;
  } // Keep familiar LumiBot prefix entry points available even while slash commands are registering.

  return { handleInteraction, handleMessage };
} // Build handlers around an injected store so tests can exercise real commands with disposable wallets.
