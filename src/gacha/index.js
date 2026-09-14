import { fileURLToPath } from "node:url";
import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { gachaConfig, loadDiaperCatalog } from "./catalog.js";
import { DiaperStore, GachaError } from "./store.js";
import { GachaSessions } from "./sessions.js";
import { createGachaWeb } from "./web.js";

export function initializeGacha(config, identities, wallet) {
  const settings = gachaConfig();
  if (!wallet) return null;
  const game = new DiaperStore(fileURLToPath(new URL("../../data/diaper-gacha.db", import.meta.url)), loadDiaperCatalog(), wallet, settings);
  const sessions = new GachaSessions(game.db, identities);
  return {
    web: createGachaWeb(config, game, sessions),
    revoke: user => sessions.revoke(user),
    prune: () => sessions.prune(),
    close: () => game.close(),
    ...createGachaCommands(config, sessions),
  };
}

export function createGachaCommands(config, sessions) {
  const names = ["diaper", "diapers"];
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
