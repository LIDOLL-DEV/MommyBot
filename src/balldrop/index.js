import { fileURLToPath } from "node:url";
import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { BallDropStore, BallDropError } from "./store.js";
import { ballDropConfig } from "./rules.js";
import { GameSessions } from "../games/sessions.js";
import { createBallDropWeb } from "./web.js";

export function initializeBallDrop(config, identities, wallet) {
  if (!wallet) return null;
  const game = new BallDropStore(fileURLToPath(new URL("../../data/balldrop.db", import.meta.url)), wallet, ballDropConfig());
  const sessions = new GameSessions(game.db, identities, { prefix: "balldrop", command: "/balldrop", ErrorClass: BallDropError });
  return { sessions, web: createBallDropWeb(config, game, sessions), revoke: user => sessions.revoke(user),
    prune: () => sessions.prune(), close: () => game.close(), ...createBallDropCommands(config, sessions) };
} // Load pending balldrop payments before the shared auth listener accepts browser actions.

export function createBallDropCommands(config, sessions) {
  const linkMessage = user => `Open Prism Drop: ${config.origin}/balldrop/open?ticket=${sessions.begin(user)}\nPick pocket 1-10 and bet 1, 5, 10, 25, 50 or 100 coins. Exact: 2x return; one away: 1.5x rounded up; two away: stake returned. This private link expires in ten minutes; do not share it.`;
  return {
    linkMessage,
    async registerGuild(guild) {
      try { await guild.commands.create(new SlashCommandBuilder().setName("balldrop").setDescription("Open Prism Drop: guess the landing pocket and bet LiDollcoins")); }
      catch { console.error(`[BallDrop] Could not register /balldrop in guild ${guild.id}.`); }
    },
    async handleInteraction(interaction) {
      if (!interaction.isChatInputCommand?.() || interaction.commandName !== "balldrop") return false;
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      let content;
      try { content = linkMessage(interaction.user.id); }
      catch (error) { content = error instanceof BallDropError ? error.message : "The ball-drop arcade is unavailable. Try again shortly."; }
      await interaction.editReply({ content, allowedMentions: { parse: [] }, flags: MessageFlags.SuppressEmbeds }); return true;
    },
    async handleMessage(message) {
      if (message.author.bot || !/^\s*!balldrop\s*$/i.test(message.content || "")) return false;
      const reply = content => message.reply({ content, allowedMentions: { parse: [], repliedUser: false } }).catch(() => {});
      let content;
      try { content = linkMessage(message.author.id); }
      catch (error) { await reply(error instanceof BallDropError ? error.message : "The ball-drop arcade is unavailable. Try again shortly."); return true; }
      try { await message.author.send({ content, allowedMentions: { parse: [] }, flags: MessageFlags.SuppressEmbeds }); }
      catch { await reply("I could not send you a DM. Use /balldrop for your private game link."); return true; }
      if (message.guild) await reply("Your private Prism Drop link is in your DMs!");
      return true;
    },
  }; // Slash and menu links are private; prefix commands put their handoff in a DM instead of the channel.
}
