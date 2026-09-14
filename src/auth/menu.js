import { randomUUID } from "node:crypto";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags,
  ModalBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder } from "discord.js";
import { canAward } from "../permissions.js";
import { WalletError } from "../wallet/client.js";
import { TraderError } from "../touhou/store.js";
import { GachaError } from "../gacha/store.js";
import { HangmanError } from "../hangman/store.js";

const row = (...components) => new ActionRowBuilder().addComponents(...components);
const privateReply = { flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
const IDLE_MS = 5 * 60_000;
class MenuError extends Error {}

export class IdentityMenus {
  constructor({ accountAction, walletAction, atelier, trader, hangman, now = Date.now }) {
    this.accountAction = accountAction; this.walletAction = walletAction;
    this.atelier = atelier; this.trader = trader; this.hangman = hangman; this.now = now;
    this.sessions = new Map();
  } // Store only short-lived menu selections; account links and gift receipts stay in their existing databases.

  isAdmin(interaction) {
    return Boolean(interaction.guildId && canAward(interaction, process.env.TOUHOU_ADMIN_ROLE_ID || ""));
  } // Recheck current Discord permissions on every administrator action, including modal submissions.

  id(s, action) { return `lm:${s.id}:${s.version}:${action}`; } // Revisions invalidate old controls after an action.
  button(s, action, label, style = ButtonStyle.Secondary) {
    return new ButtonBuilder().setCustomId(this.id(s, action)).setLabel(label).setStyle(style);
  } // Keep button styling consistent with Touhou Trader.

  open(interaction) {
    for (const [id, session] of this.sessions) if (session.expires <= this.now()) this.sessions.delete(id);
    const existing = [...this.sessions.values()].filter(s => s.user === interaction.user.id);
    for (const session of existing.slice(0, Math.max(0, existing.length - 3))) this.sessions.delete(session.id);
    const s = { id: randomUUID(), user: interaction.user.id, guild: interaction.guildId ?? null,
      version: 0, screen: "home", expires: this.now() + IDLE_MS, busy: false, banner: "" };
    this.sessions.set(s.id, s);
    return this.render(s, interaction);
  } // Bound each user's open menus and bind every private panel to its original user and server.

  render(s, interaction) {
    const home = () => row(this.button(s, "home", "Main menu"));
    let description = s.banner ? `${s.banner}\n\n` : "";
    let components;
    if (s.screen === "recipient") {
      description += s.intent === "gift-retry" ? "**Retry a pending gift**\nChoose its recipient. This resumes the saved reward." :
        `**Gift ${s.asset === "diamonds" ? "diamonds" : s.asset === "stars" ? "stars" : "LiDollcoins"}**\nChoose someone with a connected wallet. This is an admin reward; your own balance is not charged.`;
      components = [row(new UserSelectMenuBuilder().setCustomId(this.id(s, "recipient"))
        .setPlaceholder("Choose a recipient").setMinValues(1).setMaxValues(1)), home()];
    } else if (s.screen === "amount") {
      description += `**Gift ${s.asset === "diamonds" ? "diamonds" : s.asset === "stars" ? "stars" : "LiDollcoins"} to <@${s.recipient.id}>**\nEnter a whole-number amount from 1 to 1,000,000. You will review the gift before sending it.`;
      components = [row(this.button(s, "amount", "Enter amount", ButtonStyle.Primary)), home()];
    } else if (s.screen === "review") {
      description += `**Review your gift**\nRecipient: <@${s.recipient.id}>\nAmount: **${s.amount} ${s.asset === "diamonds" ? "diamonds" : s.asset === "stars" ? "stars" : "LiDollcoins"}**\nThis adds currency to their online wallet. Little Log's daily earning limits apply.`;
      components = [row(this.button(s, "send-gift", "Send gift", ButtonStyle.Success), this.button(s, "home", "Cancel", ButtonStyle.Secondary))];
    } else if (s.screen === "disconnect" || s.screen === "unlink") {
      description += s.screen === "unlink" ? "**Unlink your account?**\nThis removes your bot account link, revokes wallet access and closes your atelier sessions. Your balances, collections and awarded Discord role stay." :
        "**Disconnect your wallet?**\nThis revokes the bot's wallet access. Your account link and online balances stay.";
      description += "\nPending payments must be settled first.";
      components = [row(this.button(s, `confirm-${s.screen}`, "Confirm", ButtonStyle.Danger), this.button(s, "home", "Cancel"))];
    } else {
      description += "**Your account & wallet**\nConnect LiD0llID, check your online coins, stars and diamonds, or finish a pending payment. Use **Enter sign-in code** after approving your browser sign-in.";
      components = [row(this.button(s, "login", "Connect / renew", ButtonStyle.Primary), this.button(s, "code", "Enter sign-in code"), this.button(s, "status", "Account status")),
        row(this.button(s, "balance", "Online balance", ButtonStyle.Success), this.button(s, "retry", "Retry payment"), this.button(s, "disconnect", "Disconnect wallet")),
        row(this.button(s, "unlink", "Unlink account", ButtonStyle.Danger), this.button(s, "home", "Refresh menu"))];
      const games = [];
      if (this.trader) games.push(this.button(s, "trader", "Touhou Trader"));
      if (this.atelier) games.push(this.button(s, "atelier", "Diaper Atelier"));
      if (this.hangman) games.push(this.button(s, "hangman", "Cozy Hangman"));
      if (games.length) components.push(row(...games));
      if (this.isAdmin(interaction)) components.push(row(this.button(s, "gift-coins", "Gift coins", ButtonStyle.Primary),
        this.button(s, "gift-stars", "Gift stars", ButtonStyle.Primary), this.button(s, "gift-diamonds", "Gift diamonds", ButtonStyle.Primary), this.button(s, "gift-retry", "Retry a gift")));
    }
    const embed = new EmbedBuilder().setColor(0xd58cdb).setTitle("LiDollBot · Account & Wallet")
      .setDescription(description.slice(0, 4096)).setFooter({ text: "Only you can use this menu · Expires after 5 minutes idle" });
    return { content: null, embeds: [embed], components, allowedMentions: { parse: [] } };
  } // Keep balances and controls private, with an explicit review before gifts or account removal.

  async handleInteraction(interaction) {
    const command = interaction.isChatInputCommand?.() && (interaction.commandName === "menu" ||
      (interaction.commandName === "lidollid" && interaction.options.getSubcommand() === "menu"));
    const component = interaction.customId?.startsWith("lm:");
    if (!command && !component) return false;
    if (command) {
      await interaction.reply({ ...this.open(interaction), ...privateReply });
      return true;
    }
    const [, id, revision, action, extra] = interaction.customId.split(":");
    const s = this.sessions.get(id);
    let locked = false;
    try {
      if (!s || s.expires <= this.now()) throw new MenuError("This menu expired. Open /menu or /lidollid menu again.");
      if (s.user !== interaction.user.id || s.guild !== (interaction.guildId ?? null)) throw new MenuError("Open your own /lidollid menu to use these controls.");
      if (extra || s.busy || String(s.version) !== revision) throw new MenuError("This menu already changed. Use its latest controls or reopen /menu.");
      if (!(interaction.isButton?.() || interaction.isUserSelectMenu?.() || interaction.isModalSubmit?.())) throw new MenuError("Use the buttons and selections in this menu.");
      if ((s.intent || action.startsWith("gift-") || action === "send-gift") && !this.isAdmin(interaction) && action !== "home") {
        throw new MenuError("You need Manage Server or the configured trader admin role to gift currency.");
      }
      s.busy = true; locked = true;
      if (action === "code" || action === "amount") {
        if (!interaction.isButton?.() || (action === "code" ? s.screen !== "home" : s.screen !== "amount")) throw new MenuError("Use the current menu before opening this form.");
        const code = action === "code";
        const field = new TextInputBuilder().setCustomId(code ? "code" : "amount")
          .setLabel(code ? "Your browser sign-in confirmation code" : "Amount (1–1,000,000)")
          .setStyle(TextInputStyle.Short).setRequired(true).setMinLength(code ? 32 : 1).setMaxLength(code ? 32 : 7);
        s.modal = `${action}-submit`;
        await interaction.showModal(new ModalBuilder().setCustomId(this.id(s, s.modal))
          .setTitle(code ? "Confirm your LiD0llID" : "Enter gift amount").addComponents(row(field)));
        s.expires = this.now() + IDLE_MS;
        return true;
      }
      if (action.endsWith("-submit")) {
        if (!interaction.isModalSubmit?.() || s.modal !== action) throw new MenuError("Open a fresh form from this menu.");
      } else if (action === "recipient") {
        if (!interaction.isUserSelectMenu?.()) throw new MenuError("Choose a recipient from the menu.");
      } else if (!interaction.isButton?.()) throw new MenuError("Use this menu's buttons.");
      await interaction.deferUpdate();
      s.version++; s.modal = null; s.banner = ""; // Consume this revision before any async credit, unlink or login operation.
      await this.dispatch(s, action, interaction);
      s.expires = this.now() + IDLE_MS;
      await interaction.editReply(this.render(s, interaction));
    } catch (error) {
      const content = error instanceof MenuError || error instanceof WalletError || error instanceof TraderError || error instanceof GachaError || error instanceof HangmanError ? error.message :
        "The menu could not finish. Use Retry payment for an uncertain payment, or reopen /menu.";
      if (locked && interaction.deferred) {
        s.banner = content;
        await interaction.editReply(this.render(s, interaction)).catch(() => {});
      } else await interaction.reply({ content, ...privateReply }).catch(() => {});
    } finally { if (locked) s.busy = false; }
    return true;
  } // Owner, guild, revision and busy checks protect buttons, selections and forms against stale or concurrent requests.

  async dispatch(s, action, interaction) {
    const homeActions = ["login", "status", "balance", "retry", "disconnect", "unlink", "atelier", "trader", "hangman", "gift-coins", "gift-stars", "gift-diamonds", "gift-retry", "code-submit"];
    if (homeActions.includes(action) && s.screen !== "home") throw new MenuError("Return to the main menu first.");
    if (action === "home") {
      s.screen = "home"; s.intent = null; s.recipient = null; s.amount = null;
    } else if (["login", "status", "code-submit"].includes(action)) {
      const options = { getString: () => interaction.fields.getTextInputValue("code").trim() };
      const result = await this.accountAction(interaction, action === "code-submit" ? "confirm" : action, options);
      s.banner = result.content;
    } else if (["balance", "retry"].includes(action)) {
      s.banner = (await this.walletAction(interaction, action)).content;
    } else if (["disconnect", "unlink"].includes(action)) s.screen = action;
    else if (["confirm-disconnect", "confirm-unlink"].includes(action)) {
      const intent = action.slice(8);
      if (s.screen !== intent) throw new MenuError("Review the account action first.");
      s.screen = "home";
      s.banner = (await (intent === "unlink" ? this.accountAction : this.walletAction)(interaction, intent)).content;
    } else if (action === "atelier" && this.atelier) {
      s.banner = this.atelier(s.user);
    } else if (action === "hangman" && this.hangman) {
      s.banner = this.hangman(s.user);
    } else if (action === "trader" && this.trader) {
      await interaction.followUp({ ...await this.trader(interaction), ...privateReply });
      s.banner = "Your Touhou Trader menu is open below.";
    } else if (["gift-coins", "gift-stars", "gift-diamonds", "gift-retry"].includes(action)) {
      s.screen = "recipient"; s.intent = action === "gift-retry" ? action : "gift";
      s.asset = action === "gift-diamonds" ? "diamonds" : action === "gift-stars" ? "stars" : "coins";
      s.recipient = null; s.amount = null;
    } else if (action === "recipient") {
      if (s.screen !== "recipient") throw new MenuError("Choose a gift action first.");
      const id = interaction.values?.[0];
      const target = interaction.users?.get(id);
      if (!target || target.bot) throw new MenuError("Choose a person with a connected wallet.");
      s.recipient = { id: target.id, bot: false };
      if (s.intent === "gift-retry") {
        s.screen = "home"; s.intent = null;
        s.banner = (await this.walletAction(interaction, "gift-retry", { getUser: () => s.recipient })).content;
      } else s.screen = "amount";
    } else if (action === "amount-submit") {
      if (s.screen !== "amount" || s.intent !== "gift") throw new MenuError("Choose a gift recipient first.");
      const text = interaction.fields.getTextInputValue("amount").trim();
      if (!/^[0-9]{1,7}$/.test(text) || Number(text) < 1 || Number(text) > 1_000_000) throw new MenuError("Enter a whole-number amount from 1 to 1,000,000.");
      s.amount = Number(text); s.screen = "review";
    } else if (action === "send-gift") {
      if (s.screen !== "review" || s.intent !== "gift") throw new MenuError("Review the recipient and amount first.");
      s.screen = "home"; s.intent = null; // Recovery starts from Retry a gift; the send button cannot create a replacement credit.
      s.banner = (await this.walletAction(interaction, "gift", {
        getUser: () => s.recipient, getString: () => s.asset, getInteger: () => s.amount,
      })).content;
    } else throw new MenuError("This control is no longer available. Reopen /menu.");
  } // Route each reviewed action through the same account and wallet functions as slash commands.
}
