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
    async registerGuild(guild) {
      try { await guild.commands.create(new SlashCommandBuilder().setName("diapers").setDescription("Open your Diaper Gacha collection, rolls and bank in your browser")); }
      catch { console.error(`[Diaper Gacha] Could not register /diapers in guild ${guild.id}.`); }
    },
    async handleInteraction(interaction) {
      if (!interaction.isChatInputCommand() || interaction.commandName !== "diapers") return false;
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      let content;
      try {
        const ticket = sessions.begin(interaction.user.id);
        content = `Open your Diaper Atelier: ${config.origin}/diapers/open?ticket=${ticket}\nRoll for cute diapers, view your collection, and buy or sell at the shared diaper bank using LiDollcoins. Open the link and press Open my atelier. This private link expires in 10 minutes and signs your browser in for 8 hours. Do not share it.`;
      } catch (error) { content = error instanceof GachaError ? error.message : "The atelier is unavailable. Please try again shortly."; }
      await interaction.editReply({ content, allowedMentions: { parse: [] }, flags: MessageFlags.SuppressEmbeds });
      return true;
    }, // Discord only issues a private browser handoff; all collection, roll and bank interactions happen on the website.
  };
}
