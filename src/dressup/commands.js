import { AttachmentBuilder, EmbedBuilder, SlashCommandBuilder, escapeMarkdown } from "discord.js";
import { renderDollPng } from "./render.js";
class PetShareError extends Error {}

export function createPetCommands(config, identities, doll, render = renderDollPng) {
  const names = ["doll", "pottchistats"], pending = new Set(); let renders = 0;
  const url = new URL("/littlepottchi/", config.origin).href;
  const link = `Try Littlepottchi: ${url}`;
  const resolve = discordId => {
    const identity = identities.get(discordId);
    if (!identity) throw new PetShareError("Link your LiD0llID account with /lidollid login first.");
    const user = identities.gameAccount(identity).player_id;
    if (!doll.db.prepare("SELECT 1 FROM littlepottchi_players WHERE user_id=?").get(user)) throw new PetShareError("Open Littlepottchi and create your doll first.");
    return { user, identity };
  }; // Resolve verified identities exactly as browser sign-in does, including accounts created on the web first.

  async function response(discordId, command) {
    if (pending.has(discordId)) return { content:`Your Littlepottchi is already being checked. Try again in a moment.\n${link}` };
    pending.add(discordId);
    try {
      let owner;
      try { owner = resolve(discordId); } catch (error) {
        if (error instanceof PetShareError) return {content:`${error.message}\n${link}`};
        throw error;
      }
      const snapshot = doll.snapshot(owner.user), p = snapshot.player, c = p.care;
      const embed = new EmbedBuilder().setColor(0xe8abc0).setTitle(escapeMarkdown(p.name)).setURL(url)
        .setFooter({text:"Littlepottchi · dress, collect, care"});
      const status = c.needsWipe ? "Cleanup needed · use 1 baby wipe before changing" : c.leaking ? "Cleaned up · ready for a fresh change"
        : c.uncomfortable ? "Full and uncomfortable · no leak yet" : c.mess ? "Messy" : c.wetness ? "Wet" : "Fresh";
      const diaperField = {name:"Diaper",value:snapshot.diaper
        ? `${escapeMarkdown(doll.diapers.catalog.find(item=>item.id===snapshot.diaper.id)?.name || snapshot.diaper.id)} · ${snapshot.usedBulk} / ${snapshot.diaper.bulk} bulk\n${c.wetness} wet · ${c.mess} messy\n${c.leaking && c.needsWipe ? "Leaking · " : ""}${status}`
        : `Diaper-free${c.needsWipe ? " · cleanup needed · use 1 baby wipe before changing" : ""}`};
      if (command === "doll") {
        if (renders >= 2) return {content:`The doll camera is busy. Try again in a moment.\n${link}`};
        renders++;
        let png;
        try { png = await render(snapshot); } finally { renders--; }
        const current = identities.get(discordId);
        if (!current || current.issuer !== owner.identity.issuer || current.subject !== owner.identity.subject) return {content:`Your account link changed. Run the command again after linking.\n${link}`};
        embed.setDescription("My saved doll and outfit").setImage("attachment://littlepottchi.png").addFields(diaperField);
        return { content:`<@${discordId}> is sharing their doll.\n${link}`, embeds:[embed],
          files:[new AttachmentBuilder(png,{name:"littlepottchi.png",description:"Saved Littlepottchi doll and outfit"})] };
      }
      embed.setDescription("A public Littlepottchi check-in").addFields(
        ...Object.entries({hunger:"Fullness",hydration:"Hydration",energy:"Energy",comfort:"Comfort",joy:"Happiness"}).map(([key,name])=>({name,value:`${Math.round(p[key])} / 100`,inline:true})),
        {name:"Excitement",value:`${Math.round(p.excitement)} / ${snapshot.excitementRules.max}`,inline:true},
        diaperField,
        {name:"Activity",value:c.task ? c.task.kind === "play" ? "Playing" : "Resting" : "Ready for care",inline:true},
        {name:"Care moments",value:String(p.careCount),inline:true});
      return {content:`<@${discordId}> is checking their Littlepottchi.\n${link}`,embeds:[embed]};
    } catch { return {content:`Littlepottchi could not be shared right now. Please try again shortly.\n${link}`}; }
    finally { pending.delete(discordId); }
  } // Share only the invoking user's saved appearance or selected game stats; never serialize identity, wallet or accident schedules.

  return {
    async registerGuild(guild) {
      for(const name of names) try {
        await guild.commands.create(new SlashCommandBuilder().setName(name).setDescription(name === "doll" ? "Publicly share your saved Littlepottchi doll as a PNG" : "Publicly check your Littlepottchi's stats"));
      } catch { console.warn(`[Littlepottchi] Could not register /${name}.`); }
    },
    async handleInteraction(interaction) {
      if (!interaction.isChatInputCommand() || !names.includes(interaction.commandName)) return false;
      await interaction.deferReply(); // Deliberately public: both sharing and checking appear in the invoking channel.
      await interaction.editReply({...await response(interaction.user.id,interaction.commandName),allowedMentions:{parse:[]}});
      return true;
    },
    async handleMessage(message) {
      const match = /^\s*!(doll|pottchistats)\s*$/i.exec(message.content || "");
      if (message.author.bot || !match) return false;
      try { await message.reply({...await response(message.author.id,match[1].toLowerCase()),allowedMentions:{parse:[],repliedUser:false}}); }
      catch { console.warn("[Littlepottchi] Could not send public doll response."); }
      return true;
    },
  };
} // Exact prefix aliases bypass conversation routing; no arbitrary target player or private login ticket can be supplied.
