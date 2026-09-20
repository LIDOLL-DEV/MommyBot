import { AttachmentBuilder, escapeMarkdown, MessageFlags, SlashCommandBuilder } from "discord.js";
import { WalletError } from "../wallet/client.js";
import { OnlineError, onlineFailure } from "./feed.js";
import { characterConfig, fetchCharacter, GEAR_SLOTS } from "./character.js";

const COLOR = 0xd58cdb;
const CLASS_NAMES = { fighter: "Fighter", mage: "Mage", diplomat: "Diplomat" };
const SLOT_NAMES = { weapon: "Weapon", head: "Head", mouth: "Mouth", torso: "Torso", pants: "Pants", panties: "Panties",
  plug: "Plug", socks: "Socks", shoes: "Shoes", gloves: "Gloves", bra: "Bra", diaper_cover: "Diaper cover",
  special: "Special", accessory_1: "Accessory 1", accessory_2: "Accessory 2", accessory_3: "Accessory 3" };
const SHOWCASE_COOLDOWN_MS = 60_000;

export function buildShowcaseCommand() {
  return new SlashCommandBuilder().setName("lidollmmo").setDescription("Show your LiDollQuest character in the showcase channel")
    .addStringOption(o => o.setName("character").setDescription("Which character to show, if you have more than one").setMaxLength(64));
} // Register a dedicated command rather than replacing any other application's commands.

const label = value => escapeMarkdown(String(value ?? "").slice(0, 80));
const yesNo = value => value ? "Yes" : "No";

export function paperdollMessage(character) {
  const info = character.info;
  const fields = [
    { name: "Gender", value: label(info.gender) || "Unknown", inline: true },
    { name: "Hair", value: `${label(info.hair_color) || "Unknown"} · style ${Number(info.hair_style) || 1}`, inline: true },
    { name: "Expression", value: label(info.face_expression) || "Unknown", inline: true },
  ];
  const attachment = character.portrait ? [new AttachmentBuilder(character.portrait, { name: "paperdoll.png" })] : [];
  const embed = { color: COLOR, title: `${label(character.name)} · Paperdoll`, fields,
    ...(attachment.length ? { image: { url: "attachment://paperdoll.png" } } : {}),
    footer: { text: attachment.length ? "LiDollQuest paperdoll" : "LiDollQuest paperdoll · image unavailable from the game server" } };
  return { embeds: [embed], files: attachment, allowedMentions: { parse: [] } };
} // Attach the game's own rendered paperdoll when it sends one, and still show the appearance when it does not.

export function statsMessage(character, member) {
  const info = character.info;
  const embed = { color: COLOR, title: `${label(character.name)} · Stats`,
    description: `${member ? `<@${member}>'s character` : "Character"} · ${character.online ? "Online now" : "Offline"}`,
    fields: [
      { name: "Level", value: String(character.level), inline: true },
      { name: "Class", value: CLASS_NAMES[character.classId] || label(character.classId), inline: true },
      { name: "Embarrassment", value: String(Number(info.inspection_embarrassment) || 0), inline: true },
      { name: "Had a wet accident", value: yesNo(info.had_wet_accident), inline: true },
      { name: "Had a messy accident", value: yesNo(info.had_tum_accident), inline: true },
      { name: "Padding bulk", value: String(Number(info.panties_bulk) || 0), inline: true },
    ] };
  return { embeds: [embed], allowedMentions: { parse: [], users: member ? [member] : [] } };
} // Report only the projection's public numbers; nothing here is a wallet balance, account ID or inventory listing.

export function equipmentMessage(character) {
  const worn = new Map(character.equipment.map(entry => [entry.slot, entry]));
  const lines = GEAR_SLOTS.map(slot => {
    const entry = worn.get(slot);
    const name = entry && entry.itemId ? label(entry.name) : "*(empty)*";
    return `**${SLOT_NAMES[slot]}:** ${name}`;
  });
  const filled = character.equipment.filter(entry => entry.itemId).length;
  const embed = { color: COLOR, title: `${label(character.name)} · Equipment`,
    description: lines.join("\n").slice(0, 4000), footer: { text: `${filled} of ${GEAR_SLOTS.length} slots equipped` } };
  return { embeds: [embed], allowedMentions: { parse: [] } };
} // List every slot, including empty ones, so a character's gear reads the same way every time.

export function createCharacterShowcase(client, wallet, identities, env = process.env, {
  settings = () => null, fetcher = fetch, now = Date.now, logger = console, config,
} = {}) {
  try { if (config === undefined) config = characterConfig(env); }
  catch { logger.error("[LiDollMMO] /lidollmmo disabled: check LIDOLLMMO_ONLINE_URL and MOMMYBOT_ONLINE_TOKEN."); return null; }
  if (!config) { logger.log?.("[LiDollMMO] /lidollmmo OFF: set LIDOLLMMO_CHARACTERS_ENABLED=true and configure the feed URL and shared token."); return null; }
  if (!wallet || !identities) { logger.log?.("[LiDollMMO] /lidollmmo OFF: requires LIDOLLID_ENABLED=true and LIDOLLCOIN_ENABLED=true."); return null; }
  logger.log?.("[LiDollMMO] /lidollmmo ON: each server chooses its own showcase channel.");
  const cooldowns = new Map(), active = new Set();

  function showcaseChannel(guildId) {
    const saved = settings(guildId)?.showcase;
    return saved?.enabled && saved.channel ? saved.channel : null;
  } // A server takes part only once an administrator has enabled the showcase and chosen a channel.

  async function show(interaction) {
    const channelId = showcaseChannel(interaction.guildId);
    if (!interaction.guildId || !channelId) {
      await interaction.reply({ content: "This server has no LiDollQuest showcase channel yet. Ask an administrator to choose one in MommyBot's admin panel.", flags: MessageFlags.Ephemeral });
      return;
    }
    const previous = cooldowns.get(interaction.user.id);
    if (previous !== undefined && now() - previous < SHOWCASE_COOLDOWN_MS) { // A member who has never posted is never on cooldown.
      await interaction.reply({ content: `Give the showcase a moment, sweetheart. Try again in ${Math.ceil((SHOWCASE_COOLDOWN_MS - (now() - previous)) / 1000)} seconds.`, flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      if (!identities.get(interaction.user.id)) throw new OnlineError("not_linked", "Make a LiD0llID account if you don't have one, then use /lidollid login before showing your character.");
      const connection = wallet.connection(interaction.user.id);
      if (!connection?.account_id) throw new OnlineError("not_connected", "Connect your wallet with /lidollid login so MommyBot knows which LiDollQuest account is yours.");
      const gameAccount = await wallet.questAccount(interaction.user.id); // Pairwise wallet IDs differ between lidollbot and lidollquest.
      const character = await fetchCharacter(config, gameAccount,
        { characterId: interaction.options.getString("character") ?? "", fetcher });
      const channel = await client.channels.fetch(channelId);
      if (!channel?.isTextBased?.() || channel.guildId !== interaction.guildId) throw new OnlineError("discord_channel_invalid", "The showcase channel is unavailable. Ask an administrator to choose one MommyBot can post in.");
      cooldowns.set(interaction.user.id, now()); // Reserve the slot before sending, so a slow post cannot be triggered twice.
      for (const payload of [paperdollMessage(character), statsMessage(character, interaction.user.id), equipmentMessage(character)]) {
        await channel.send(payload);
      } // Three separate messages, in the order asked for, so each can be reacted to and linked on its own.
      const others = character.characters.filter(entry => entry.id !== character.id);
      const choices = others.map(entry => `\`${label(entry.name)}\` (ID: \`${entry.id}\`)`).join(", ");
      await interaction.editReply({ content: `**${label(character.name)}** is on show in <#${channelId}>.\nCharacter ID: \`${character.id}\`.${others.length ? `\n\nOther characters: ${choices.slice(0, 1500)}${choices.length > 1500 ? "…" : ""}. Use \`/lidollmmo character:<name or id>\` to show one of those instead.` : ""}`,
        allowedMentions: { parse: [] } });
    } catch (error) {
      cooldowns.delete(interaction.user.id);
      if (!(error instanceof OnlineError) && !(error instanceof WalletError)) logger.error(`[LiDollMMO] ${onlineFailure(error, "showcase")}`);
      await interaction.editReply({ content: error instanceof OnlineError || error instanceof WalletError ? error.message : "MommyBot could not show your character just now. Try again shortly.",
        allowedMentions: { parse: [] } }).catch(() => {});
    }
  } // Answer privately either way; only the character sheet itself is ever posted publicly.

  return {
    async handleInteraction(interaction) {
      if (!interaction.isChatInputCommand?.() || interaction.commandName !== "lidollmmo") return false;
      const activity = Symbol(`showcase:${interaction.id}`);
      active.add(activity);
      try { await show(interaction); }
      catch { logger.error("[LiDollMMO] Could not answer a showcase request."); }
      finally { active.delete(activity); }
      return true;
    }, // Own only this command so other applications' slash commands keep reaching their own handlers.
    async registerGuild(guild) {
      try { await guild.commands.create(buildShowcaseCommand()); }
      catch { logger.error(`[LiDollMMO] Could not register /lidollmmo in guild ${guild.id}.`); }
    },
    async stop() { while (active.size) await new Promise(resolve => setTimeout(resolve, 25)); },
  };
}
