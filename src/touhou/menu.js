import { randomUUID } from "node:crypto";
import path from "node:path";
import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags,
  StringSelectMenuBuilder, UserSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { TraderError } from "./store.js";
import { WalletError } from "../wallet/client.js";
import { balanceText } from "../wallet/commands.js";
import { rarity, IMAGE_DIRECTORY } from "./catalog.js";
import { RARITIES, POTION_PRICE, POTION_CAP, HEAL_PRICE, levelThreshold } from "./battleRules.js";

const PAGE_SIZE = 20;
const MENU_IDLE_MS = 5 * 60_000;
const safeMentions = { parse: [], repliedUser: false };
const row = (...items) => new ActionRowBuilder().addComponents(...items);
const remaining = (until, now) => `${Math.ceil(Math.max(0, until - now) / 1000)}s`;

export class TouhouMenus {
  constructor(store, game, { channelId = "", imageDirectory = IMAGE_DIRECTORY, wallet = null, adopt = (...args) => store.adopt(...args), economy = null } = {}) {
    this.store = store; this.game = game; this.channelId = channelId; this.imageDirectory = imageDirectory;
    this.sessions = new Map();
    this.wallet = wallet; this.adopt = adopt;
    this.economy = economy;
  } // Keep short-lived UI selections separate from persistent battles and currency transactions.

  open(guild, user, screen = "home", battleId = null) {
    for (const [id, session] of this.sessions) if (session.expiresAt <= this.store.now()) this.sessions.delete(id);
    const existing = [...this.sessions.values()].filter((session) => session.guild === guild && session.user === user);
    for (const session of existing.slice(0, Math.max(0, existing.length - 4))) this.sessions.delete(session.id);
    const session = { id: randomUUID(), guild, user, screen, battleId, version: 0, page: 0, banner: "",
      selected: null, recipient: null, expiresAt: this.store.now() + MENU_IDLE_MS, busy: false };
    this.sessions.set(session.id, session);
    return this.render(session);
  } // Open a bounded, owner-only menu; expired sessions cannot spend or transfer anything.

  id(session, action) { return `tm:${session.id}:${session.version}:${action}`; } // Include a UI revision so stale dropdowns and double clicks cannot repeat an action.
  button(session, action, label, style = ButtonStyle.Secondary) {
    return new ButtonBuilder().setCustomId(this.id(session, action)).setLabel(label).setStyle(style);
  } // Use short server-side action keys instead of placing character names or prices in custom IDs.

  choose(session, entries, action, placeholder, describe = () => "") {
    const pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
    session.page = Math.min(Math.max(0, session.page), pages - 1);
    session.choices = entries.slice(session.page * PAGE_SIZE, (session.page + 1) * PAGE_SIZE);
    const components = [];
    if (session.choices.length) components.push(row(new StringSelectMenuBuilder().setCustomId(this.id(session, action))
      .setPlaceholder(placeholder).addOptions(session.choices.map((entry, index) => ({
        label: entry.name.slice(0, 100), value: String(index), description: (describe(entry) || rarity(entry)).slice(0, 100),
      })))));
    const nav = [this.button(session, "home", "Trader")];
    if (session.page > 0) nav.push(this.button(session, "prev", "Previous"));
    if (session.page < pages - 1) nav.push(this.button(session, "next", "Next"));
    components.push(row(...nav));
    return components;
  } // Paginate select menus below Discord's 25-option limit, including oversized inherited collections.

  render(session) {
    const { guild, user, screen } = session;
    const wallet = this.store.wallet(guild, user);
    const embed = new EmbedBuilder().setColor(0xd58cdb).setTitle("Touhou Trader");
    let text = session.banner ? `${session.banner}\n\n` : "";
    let components = [];
    const files = [];
    const home = () => row(this.button(session, "home", "Trader"), this.button(session, "shop", "Market & items"));
    const picture = (name, attachmentName = "character") => {
      const entry = this.store.character(guild, name);
      const filename = `${attachmentName}${path.extname(entry.filename).toLowerCase()}`;
      files.push(new AttachmentBuilder(path.join(this.imageDirectory, entry.filename), { name: filename }));
      return `attachment://${filename}`;
    };
    if (screen === "home") {
      text += (this.wallet ? "All payments and rewards use your **Little Log wallet**. Press **Online balance** to check it privately, or connect with /lidollid login.\n" : `**${wallet.stars} stars • ${wallet.coins} LiDollcoins**\n`) + `Adopt one random Touhou for **1 star OR 25 LiDollcoins**.\nParty: ${this.store.collection(guild, user).length}/6 · Potions: ${this.game.potions(guild, user)}/${POTION_CAP}`;
      components = [row(this.button(session, "adopt-stars", "Adopt · 1 star", ButtonStyle.Primary), this.button(session, "adopt-coins", "Adopt · 25 LiDollcoins", ButtonStyle.Success)),
        row(this.button(session, "battle", "Battle"), this.button(session, "party", "My party"), this.button(session, "shop", "Market & items"), this.button(session, "heal", "Heal"))];
      if (session.hero) embed.setThumbnail(picture(session.hero));
      if (this.wallet) components.push(row(this.button(session, "online-balance", "Online balance"), this.button(session, "retry-payment", "Retry pending payment")));
    } else if (screen === "shop") {
      text += (this.wallet ? "**Little Log LiDollcoins**\n" : `**${wallet.coins} LiDollcoins**\n`) + "Browse player listings, buy health potions, send gifts or offer a swap. Buyback pays two-thirds of a character's suggested value.";
      components = [row(this.button(session, "listings", "Buy a listing"), this.button(session, "stock", "Adoption stock"), this.button(session, "potions", "Health potions")),
        row(this.button(session, "sell", "List for sale"), this.button(session, "delist", "Delist"), this.button(session, "buyback", "Buyback")),
        row(this.button(session, "send", "Send gift"), this.button(session, "trade", "Offer swap"), this.button(session, "home", "Trader"))];
    } else if (screen === "potions") {
      text += `Health potions cost **${POTION_PRICE} LiDollcoins** each and restore **50% maximum HP** in battle. The enemy acts after you drink one.\nStock: **${this.game.potions(guild, user)}/${POTION_CAP}**\n` + (this.wallet ? "Payment uses your Little Log wallet." : `Wallet: **${wallet.coins} LiDollcoins**`);
      components = [row(this.button(session, "potion1", "Buy 1 · 20 coins"), this.button(session, "potion5", "Buy 5 · 100 coins")), home()];
    } else if (["party", "battle-pick", "heal", "sell", "delist", "buyback", "send", "trade"].includes(screen)) {
      let party = this.game.party(guild, user);
      if (screen === "delist") party = party.filter((entry) => this.store.market(guild).some((listing) => listing.name === entry.name && listing.price));
      text += `**${{ party: "Your party", "battle-pick": "Choose your fighter", heal: "Choose a Touhou to heal", sell: "Choose a Touhou to list", delist: "Choose a listing to remove", buyback: "Choose a Touhou for buyback", send: "Choose your gift", trade: "Choose the Touhou you offer" }[screen]}**\n`;
      if (!party.length) text += "No matching Touhous. Adopt one from the trader first.";
      components = this.choose(session, party, "pick", "Choose a Touhou", (entry) =>
        `Lv ${entry.level} · ${rarity(entry, entry.level)}${entry.fainted_until > this.store.now() ? ` · Rest ${remaining(entry.fainted_until, this.store.now())}` : ""}`);
      text += party.slice(session.page * PAGE_SIZE, (session.page + 1) * PAGE_SIZE).map((entry) =>
        `\n**${entry.name}** · Lv ${entry.level} · ${entry.wins}W/${entry.losses}L`).join("");
    } else if (screen === "detail") {
      const entry = this.store.character(guild, session.selected);
      const profile = this.game.profile(guild, entry.name);
      const moves = this.game.fighter(entry, profile.level).attacks;
      embed.setTitle(entry.name).setThumbnail(picture(entry.name));
      text += `${rarity(entry, profile.level)} · **Level ${profile.level}**\nEXP: ${profile.exp}/${levelThreshold(profile.level)} · ${profile.wins} wins / ${profile.losses} losses\nRecovery: ${remaining(profile.fainted_until, this.store.now())}\n\n` + moves.map((move) => `**${move.name}** · ${move.type} · power ${move.basePower} · ${move.accuracy}%`).join("\n");
      components = [row(this.button(session, "rarity", "Battle with this Touhou"), this.button(session, "heal-selected", "Heal")), home()];
    } else if (screen === "rarity") {
      text += `Fight with **${session.selected}**. Select the enemy's rarity, or Gamble for a random tier and **20% more EXP and coins**.`;
      components = [row(new StringSelectMenuBuilder().setCustomId(this.id(session, "difficulty")).setPlaceholder("Opponent rarity")
        .addOptions([...RARITIES, "gamble"].map((value) => ({ label: value === "gamble" ? "Gamble (+20% rewards)" : value, value })))), home()];
    } else if (screen === "recipient") {
      text += `**${session.selected}** — select a server member to ${session.intent === "send" ? "receive your gift" : "trade with"}.`;
      components = [row(new UserSelectMenuBuilder().setCustomId(this.id(session, "recipient")).setPlaceholder("Choose a player").setMaxValues(1)), home()];
    } else if (screen === "their-party") {
      const entries = this.game.party(guild, session.recipient);
      text += `Choose a Touhou from <@${session.recipient}> to request in exchange for **${session.selected}**.`;
      components = this.choose(session, entries, "their-pick", "Their Touhou");
      if (!entries.length) text += "\nThey have no Touhous to trade.";
    } else if (["listings", "stock"].includes(screen)) {
      const entries = this.store.market(guild).filter((entry) => screen === "stock" ? !entry.owner_id : Boolean(entry.price));
      text += screen === "stock" ? "Random adoption stock: **1 star OR 25 LiDollcoins**. Select a name for details; a draw is random." : "Select a listing to review its current seller and price before buying.";
      components = this.choose(session, entries, "listing-pick", "Choose a Touhou", (entry) => entry.price ? `${entry.price} LiDollcoins` : rarity(entry));
      text += session.choices.map((entry) => `\n**${entry.name}**${entry.price ? ` · ${entry.price} coins` : ""}`).join("");
      if (!entries.length) text += "\nNothing available here yet.";
    } else if (screen === "price-entry") {
      text += `Set a LiDollcoin asking price for **${session.selected}**.`;
      components = [row(this.button(session, "price", "Enter price", ButtonStyle.Primary)), home()];
    } else if (screen === "confirm") {
      text += session.prompt;
      if (session.selected) embed.setThumbnail(picture(session.selected));
      components = [row(this.button(session, "confirm", "Confirm", ButtonStyle.Success), this.button(session, "cancel", "Cancel", ButtonStyle.Danger))];
    } else if (screen === "battle") {
      const state = this.game.get(guild, user, session.battleId);
      session.battleTurn = state.turn;
      embed.setTitle(`${state.player.name} vs Evil ${state.enemy.name}`).setThumbnail(picture(state.player.name, "player"));
      text += `**${state.player.name}** Lv ${state.player.level} · ${state.player.type}\nHP: **${state.player.hp}/${state.player.stats.hpMax}**\n\n**Evil ${state.enemy.name}** Lv ${state.enemy.level} · ${state.enemy.type}\nHP: **${state.enemy.hp}/${state.enemy.stats.hpMax}**\n\n${state.log.slice(-6).join("\n")}`;
      if (state.reward?.payment) text += `\nOnline payout: **${state.reward.payment === "paid" ? "paid" : "waiting — use /lidollid wallet retry"}**.`;
      embed.setImage(picture(state.enemy.name, "enemy"));
      if (!state.outcome) {
        text += `\n\nTurn ${state.turn + 1} · Potions: ${this.game.potions(guild, user)} · Idle limit: 90s`;
        components = [row(...state.player.attacks.map((move, index) => this.button(session, `attack${index}`, move.name.slice(0, 80), ButtonStyle.Primary))),
          row(this.button(session, "defend", "Defend"), this.button(session, "potion", "Use potion"), this.button(session, "run", "Run"), this.button(session, "home", "Trader (battle continues)"))];
      } else components = [row(this.button(session, "battle", "Battle again"), this.button(session, "heal", "Heal")), home()];
    }
    if (this.wallet && screen !== "home") text += "\n\nPayments and rewards use Little Log LiDollcoins. Adoption also accepts 1 star.";
    embed.setDescription(text.slice(0, 4096)).setFooter({ text: "Only you can use this menu · Expires after 5 minutes idle" });
    return { content: null, embeds: [embed], components, files, attachments: [], allowedMentions: safeMentions };
  } // Render every gameplay path in the same message, with real art, bounded controls and fresh balances.

  async handle(interaction) {
    if (!interaction.customId?.startsWith("tm:")) return false;
    const [, id, revision, action] = interaction.customId.split(":");
    const session = this.sessions.get(id);
    let locked = false;
    try {
      if (!session || session.expiresAt <= this.store.now()) throw new TraderError("This menu expired. Open /touhou menu or !touhou again.");
      if (session.guild !== interaction.guildId || session.user !== interaction.user.id) throw new TraderError("Open your own trader menu to use these controls.");
      if (this.channelId && this.channelId !== interaction.channelId) throw new TraderError(`Use the trader in <#${this.channelId}>.`);
      if (session.busy || session.version !== Number(revision)) throw new TraderError("This menu already changed. Use its latest controls.");
      session.busy = true; locked = true; // Lock before acknowledging so concurrent button events cannot share a menu revision.
      if (action === "online-balance" && this.wallet) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        let content;
        try { content = balanceText(await this.wallet.balance(session.user)); }
        catch (error) { content = error instanceof WalletError ? error.message : "The wallet could not be read. Try again shortly."; }
        await interaction.editReply({ content, allowedMentions: safeMentions });
        return true;
      } // Keep balances private even when this trader menu was posted publicly through a prefix command.
      if (action === "price") {
        if (session.screen !== "price-entry" || session.intent !== "sell-price") throw new TraderError("Choose a Touhou to sell first.");
        const modal = new ModalBuilder().setCustomId(this.id(session, "price-submit")).setTitle("List your Touhou")
          .addComponents(row(new TextInputBuilder().setCustomId("price").setLabel("Price in LiDollcoins (1–1,000,000)")
            .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(7)));
        await interaction.showModal(modal);
        return true;
      }
      await interaction.deferUpdate();
      session.banner = "";
      await this.dispatch(session, action, interaction);
      session.version++;
      session.expiresAt = this.store.now() + MENU_IDLE_MS;
      await interaction.editReply(this.render(session));
    } catch (error) {
      if (!((error instanceof TraderError || error instanceof WalletError))) console.error("[TOUHOU MENU]", error);
      const content = (error instanceof TraderError || error instanceof WalletError) ? error.message : "The menu could not finish. Check your wallet and collection before retrying.";
      if (locked && interaction.deferred) {
        session.banner = content;
        session.version++;
        await interaction.editReply(this.render(session)).catch(console.error);
      } else await interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: safeMentions }).catch(console.error);
    } finally {
      if (locked) session.busy = false;
    }
    return true;
  } // Handle buttons, dropdowns and price modals with owner checks, expiry and a per-session concurrency guard.

  async dispatch(s, action, interaction) {
    const { guild, user } = s;
    const request = `menu:${s.id}:${s.version}`;
    const select = () => {
      const value = interaction.values?.[0];
      if (!/^\d+$/.test(value || "") || !s.choices?.[Number(value)]) throw new TraderError("Choose a character from the current list.");
      return s.choices[Number(value)];
    };
    const confirm = (intent, prompt) => { s.intent = intent; s.prompt = prompt; s.screen = "confirm"; };
    if (action === "retry-payment" && this.wallet) {
      if (this.wallet.adoptions?.pending(user)) {
        const result = await this.wallet.adoptions.retry(user);
        s.banner = `Adopted **${result.character.name}** in server ${result.character.guild_id}.`;
      } else s.banner = (await this.economy.retry(user)).content;
    } else if (["home", "shop", "party", "heal", "sell", "delist", "buyback", "send", "trade", "potions", "stock", "listings"].includes(action)) {
      s.screen = action; s.page = 0;
    } else if (action === "prev" || action === "next") s.page += action === "next" ? 1 : -1;
    else if (action === "cancel") { s.screen = "shop"; s.page = 0; }
    else if (action.startsWith("adopt-")) {
      const receipt = await this.adopt(guild, user, action.slice(6), request);
      s.banner = `Adopted **${receipt.character.name}** for ${receipt.price} ${receipt.currency === "stars" ? "star" : "LiDollcoins"}!`;
      s.hero = receipt.character.name; s.screen = "home";
    } else if (action === "battle") {
      const current = this.game.current(guild, user);
      s.screen = current ? "battle" : "battle-pick"; s.battleId = current?.id; s.page = 0;
    } else if (action === "pick") {
      s.selected = select().name;
      if (s.screen === "party") s.screen = "detail";
      else if (s.screen === "battle-pick") s.screen = "rarity";
      else if (["send", "trade"].includes(s.screen)) { s.intent = s.screen; s.screen = "recipient"; }
      else if (s.screen === "heal") this.healPrompt(s, confirm);
      else if (s.screen === "buyback") {
        this.store.owned(guild, user, s.selected);
        s.quote = Math.max(1, Math.floor(this.game.suggestedPrice(guild, s.selected) * 2 / 3));
        confirm("buyback", `Return **${s.selected}** for **${s.quote} LiDollcoins**? Battle levels will reset.`);
      } else if (s.screen === "delist") confirm("delist", `Remove your listing for **${s.selected}**?`);
      else if (s.screen === "sell") { this.store.owned(guild, user, s.selected); s.screen = "confirm"; s.intent = "sell-price"; s.prompt = `List **${s.selected}**? Confirm to enter your price.`; }
    } else if (action === "rarity") s.screen = "rarity";
    else if (action === "heal-selected") this.healPrompt(s, confirm);
    else if (action === "difficulty") {
      const state = await this.game.start(guild, user, s.selected, interaction.values?.[0], request);
      s.battleId = state.id; s.screen = "battle";
    } else if (["attack0", "attack1", "attack2", "defend", "potion", "run"].includes(action)) {
      if (s.screen !== "battle") throw new TraderError("Resume the battle before choosing an action.");
      await this.game.act(guild, user, s.battleId, s.battleTurn, action, request);
    } else if (action === "recipient") {
      const id = interaction.values?.[0];
      const member = await interaction.guild.members.fetch(id);
      if (!member || member.user?.bot || id === user) throw new TraderError("Choose another human member of this server.");
      s.recipient = id;
      if (s.intent === "send") confirm("send", `Gift **${s.selected}** to <@${id}> for free?`);
      else { s.screen = "their-party"; s.page = 0; }
    } else if (action === "their-pick") {
      s.theirs = select().name;
      confirm("trade", `Offer **${s.selected}** for <@${s.recipient}>'s **${s.theirs}**? They must accept the swap.`);
    } else if (action === "listing-pick") {
      const entry = select(); s.selected = entry.name;
      if (!entry.owner_id) { s.banner = `**${entry.name}** is in random adoption stock. Choose a payment on the trader to draw a random character.`; s.hero = entry.name; s.screen = "home"; }
      else { s.quote = entry.price; s.seller = entry.seller_id; confirm("buy", `Buy **${entry.name}** from <@${entry.seller_id}> for **${entry.price} LiDollcoins**?`); }
    } else if (action === "potion1" || action === "potion5") {
      const count = action === "potion1" ? 1 : 5;
      const result = await this.game.buyPotions(guild, user, count, request);
      s.banner = `Bought ${count} potion(s) for ${result.price} LiDollcoins.`;
    } else if (action === "price-submit") {
      if (s.intent !== "sell-price") throw new TraderError("Choose a Touhou to sell first.");
      const value = interaction.fields.getTextInputValue("price").trim();
      if (!/^\d+$/.test(value)) throw new TraderError("Enter a whole-number LiDollcoin price.");
      const result = await (this.economy || this.store).list(guild, user, s.selected, Number(value), request);
      s.banner = `Listed **${result.name}** for **${result.price} LiDollcoins**.`; s.screen = "shop";
    } else if (action === "confirm") {
      if (s.screen !== "confirm") throw new TraderError("Review an action before confirming it.");
      if (s.intent === "sell-price") { s.screen = "price-entry"; return; }
      if (s.intent === "buyback") { const result = await this.game.buyback(guild, user, s.selected, request, s.quote); s.banner = `Returned **${result.name}** for ${result.payout} LiDollcoins.`; }
      else if (s.intent === "heal") { const result = await this.game.heal(guild, user, s.selected, s.payHeal, request); s.banner = `**${result.name}** is ready! Cost: ${result.price} LiDollcoins.`; }
      else if (s.intent === "delist") { this.store.delist(guild, user, s.selected, request); s.banner = "Listing removed."; }
      else if (s.intent === "send") {
        const member = await interaction.guild.members.fetch(s.recipient);
        if (member.user?.bot) throw new TraderError("Choose a human recipient.");
        this.store.send(guild, user, s.recipient, s.selected, request); s.banner = `Gifted **${s.selected}** to <@${s.recipient}>.`;
      } else if (s.intent === "buy") {
        const receipt = await (this.economy || this.store).buy(guild, user, s.selected, request, { price: s.quote, sellerId: s.seller });
        s.banner = `Bought **${receipt.character.name}** for ${receipt.price} LiDollcoins.`;
      } else if (s.intent === "trade") {
        const member = await interaction.guild.members.fetch(s.recipient);
        if (member.user?.bot) throw new TraderError("Choose a human recipient.");
        const offer = this.store.offer(guild, user, s.recipient, s.selected, s.theirs, request);
        await interaction.followUp({ content: `<@${user}> offers **${offer.offered}** for <@${s.recipient}>'s **${offer.requested}**. Recipient: accept within one minute.`,
          components: [row(new ButtonBuilder().setCustomId(`th:trade:accept:${offer.id}`).setLabel("Accept swap").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`th:trade:decline:${offer.id}`).setLabel("Decline").setStyle(ButtonStyle.Danger))],
          allowedMentions: { parse: [], users: [s.recipient] } });
        s.banner = "Trade offer sent. Ownership changes only if the recipient accepts.";
      }
      s.screen = "shop";
    } else throw new TraderError("This menu action is unavailable.");
  } // Drive every market and battle interaction through fresh ownership checks and transaction-backed services.

  healPrompt(session, confirm) {
    const profile = this.game.profile(session.guild, session.selected);
    session.payHeal = profile.fainted_until > this.store.now();
    confirm("heal", `Heal **${session.selected}** for **${session.payHeal ? HEAL_PRICE : 0} LiDollcoins**?${session.payHeal ? ` Free recovery in ${remaining(profile.fainted_until, this.store.now())}.` : ""}`);
  } // Quote paid early healing explicitly; recovery after the cooldown remains free.
}
