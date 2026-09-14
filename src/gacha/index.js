import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { AttachmentBuilder, EmbedBuilder, MessageFlags, SlashCommandBuilder } from "discord.js";
import { assetRoot, gachaConfig, loadDiaperCatalog, tiers } from "./catalog.js";
import { DiaperStore, GachaError } from "./store.js";
import { WalletError } from "../wallet/client.js";
import { GachaSessions } from "./sessions.js";
import { createGachaWeb } from "./web.js";

export function initializeGacha(config, identities, wallet) {
  const settings = gachaConfig();
  if (!wallet) return null;
  const game = new DiaperStore(fileURLToPath(new URL("../../data/diaper-gacha.db", import.meta.url)), loadDiaperCatalog(), wallet, settings);
  const sessions = new GachaSessions(game.db, identities);
  return {
    sessions,
    web: createGachaWeb(config, game, sessions),
    revoke: user => sessions.revoke(user),
    prune: () => sessions.prune(),
    close: () => game.close(),
    ...createGachaCommands(config, sessions, game),
  };
}

const rarityColors = { common: 0xf4c2d7, uncommon: 0x9fd8b8, rare: 0x8fb8f0, epic: 0xc39bf0, legendary: 0xf5c45e };

export function createGachaCommands(config, sessions, game = null) {
  const names = ["diaper", "diapers"];
  const rollMessage = async user => {
    const { amount, item } = await game.act(user, "roll", null, randomUUID());
    const embed = new EmbedBuilder().setColor(rarityColors[item.rarity]).setTitle(item.name).setDescription(item.description)
      .addFields({ name: "Rarity", value: tiers[item.rarity].label, inline: true }, { name: "Paid", value: `${amount} LiDollcoin${amount === 1 ? "" : "s"}`, inline: true })
      .setImage(`attachment://${item.image}`).setFooter({ text: "Added to your collection · /diapers opens your atelier" });
    return { content: `The capsule pops open... you got **${item.name}**! ✦`, embeds: [embed],
      files: [new AttachmentBuilder(fileURLToPath(new URL(item.image, assetRoot)), { name: item.image })] };
  }; // Rolls journal and settle through the website's store, so odds, payment and recovery stay identical.
  const linkMessage = user => {
    const ticket = sessions.begin(user);
    return `Open your Diaper Atelier: ${config.origin}/diapers/open?ticket=${ticket}\nRoll for cute diapers, view your collection, and buy or sell at the shared diaper bank using LiDollcoins. Open the link and press Open my atelier. This private link expires in 10 minutes and signs your browser in for 8 hours. Do not share it.`;
  }; // Use the same authenticated-user handoff for slash replies and private prefix-command messages.
  return {
    linkMessage, // Allow the private account menu to issue the same owner-bound browser handoff.
    async registerGuild(guild) {
      for (const name of names) {
        try {
          await guild.commands.create(new SlashCommandBuilder().setName(name).setDescription("Open your Diaper Gacha collection, rolls and bank in your browser"));
          console.log(`[Diaper Gacha] /${name} ready in guild ${guild.id}.`);
        } catch (error) {
          const code = Number.isSafeInteger(error.code) ? ` (Discord code ${error.code})` : "";
          console.error(`[Diaper Gacha] Could not register /${name} in guild ${guild.id}${code}.`);
        } // Register each alias independently and report only a numeric error code, never private Discord response data.
      }
    },
    async handleMessage(message) {
      if (!message.author.bot && game && /^\s*!diaper\s*$/i.test(message.content || "")) {
        message.channel?.sendTyping?.()?.catch(() => {});
        let response;
        try { response = await rollMessage(message.author.id); }
        catch (error) {
          response = { content: error instanceof GachaError || error instanceof WalletError ? error.message
            : "The capsule machine is temporarily unavailable. Use /lidollid wallet retry to finish any pending payment; do not roll again." };
        }
        try { await message.reply({ ...response, allowedMentions: { parse: [], repliedUser: false } }); }
        catch { console.warn("[Diaper Gacha] Could not send a roll result; the prize stays in the collection."); }
        return true;
      } // !diaper rolls one capsule in the channel; only locally authored game and wallet errors are shown.
      if (message.author.bot || !/^\s*!diapers\s*$/i.test(message.content || "")) return false;
      const reply = async content => {
        try { await message.reply({ content, allowedMentions: { parse: [], repliedUser: false } }); }
        catch { console.warn("[Diaper Gacha] Could not send prefix-command instructions."); }
      }; // A missing channel permission must not crash the message handler or send the command to the language model.
      let content;
      try { content = linkMessage(message.author.id); }
      catch (error) {
        await reply(error instanceof GachaError ? error.message : "The atelier is unavailable. Please try again shortly.");
        return true;
      }
      try {
        await message.author.send({ content, allowedMentions: { parse: [] }, flags: MessageFlags.SuppressEmbeds });
      } catch {
        await reply("I could not send you a DM. Use /diapers in this server to get a private game link.");
        return true;
      }
      if (message.guild) await reply("Your private Diaper Atelier link is in your DMs!");
      return true;
    }, // Consume only the exact prefix command; private login tickets must never appear in a server-channel reply.
    async handleInteraction(interaction) {
      if (!interaction.isChatInputCommand() || !names.includes(interaction.commandName)) return false;
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      let content;
      try {
        content = linkMessage(interaction.user.id);
      } catch (error) { content = error instanceof GachaError ? error.message : "The atelier is unavailable. Please try again shortly."; }
      await interaction.editReply({ content, allowedMentions: { parse: [] }, flags: MessageFlags.SuppressEmbeds });
      return true;
    }, // Discord only issues a private browser handoff; all collection, roll and bank interactions happen on the website.
  };
}
