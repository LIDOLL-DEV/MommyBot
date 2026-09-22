import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

export const PET_COMMANDS = ["littlepottchi", "doll", "pottchistats"];
const PET_PREFIX = /^\s*!(doll|pottchistats)\s*$/i;
const OFF = "Littlepottchi is turned off in this server right now. Your doll is resting safely and nothing has changed.";

export function buildPottchiAdminCommand() {
  return new SlashCommandBuilder().setName("pottchiadmin").setDescription("Littlepottchi server controls")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator).setDMPermission(false)
    .addSubcommand(c => c.setName("disable").setDescription("(Admin) Turn Littlepottchi off in this server"))
    .addSubcommand(c => c.setName("enable").setDescription("(Admin) Turn Littlepottchi back on in this server"))
    .addSubcommand(c => c.setName("status").setDescription("(Admin) Show whether Littlepottchi is on here, and whether dolls are paused"));
} // Discord hides the command from non-administrators, and the handler rechecks the live permission before acting.

export function createPottchiControl(client, { clock = null, settings = () => ({}), setEnabled = () => {}, logger = console, interval = 30_000 } = {}) {
  let timer = null;
  const enabledIn = guildId => settings(guildId)?.littlepottchi !== false;

  function sync() {
    if (!clock) return null;
    const guilds = [...client.guilds.cache.keys()];
    const allOff = guilds.length > 0 && guilds.every(id => !enabledIn(id));
    if (allOff && clock.freeze()) logger.log?.("[Littlepottchi] Paused: turned off in every server. Doll clocks are frozen.");
    if (!allOff && clock.thaw()) logger.log?.("[Littlepottchi] Resumed: doll clocks continue exactly where they stopped.");
    return clock.frozen;
  } // Dolls belong to players, not servers, so time only stops once no server still has Littlepottchi switched on.

  async function refuse(target, isMessage) {
    const options = { content: OFF, allowedMentions: { parse: [] } };
    try { if (isMessage) await target.reply({ ...options, allowedMentions: { parse: [], repliedUser: false } }); else await target.reply({ ...options, flags: MessageFlags.Ephemeral }); }
    catch { logger.error?.("[Littlepottchi] Could not explain that Littlepottchi is off here."); }
    return true;
  }

  async function admin(interaction) {
    if (!interaction.guildId || !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({ content: "Only a server administrator can change Littlepottchi here.", flags: MessageFlags.Ephemeral });
      return;
    } // Recheck the live permission; the command's default-permission hint alone is not an authorization check.
    const action = interaction.options.getSubcommand();
    if (action !== "status") {
      const want = action === "enable";
      if (enabledIn(interaction.guildId) !== want) setEnabled(interaction.guildId, want, interaction.user?.username ?? interaction.user?.id ?? "discord");
    }
    const frozen = sync();
    const here = enabledIn(interaction.guildId);
    const clockLine = frozen === null ? "" : frozen
      ? "\nDoll clocks are **paused**: no time passes for any doll, and each resumes exactly where it stopped."
      : here ? "\nDoll clocks are running." : "\nDoll clocks keep running because Littlepottchi is still on in another server this bot is in.";
    const verb = action === "status" ? "is" : "is now";
    await interaction.reply({ content: `Littlepottchi ${verb} **${here ? "on" : "off"}** in this server.${here ? "" : " /littlepottchi, /doll and /pottchistats are refused here, and diaper checks here stop using doll accidents."}${clockLine}`,
      flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  }

  return {
    enabledIn, sync,
    async handleInteraction(interaction) {
      if (!interaction.isChatInputCommand?.()) return false;
      if (interaction.commandName === "pottchiadmin") {
        try { await admin(interaction); }
        catch { logger.error?.("[Littlepottchi] Could not complete an administrator's request."); }
        return true;
      }
      if (PET_COMMANDS.includes(interaction.commandName) && interaction.guildId && !enabledIn(interaction.guildId)) return refuse(interaction, false);
      return false;
    }, // Intercept only the pet commands in a server that has switched Littlepottchi off; everything else passes straight through.
    async handleMessage(message) {
      if (!message.guildId || message.author?.bot || !PET_PREFIX.test(message.content || "") || enabledIn(message.guildId)) return false;
      return refuse(message, true);
    }, // The !doll and !pottchistats aliases are refused the same way as their slash commands.
    async registerGuild(guild) {
      try { await guild.commands.create(buildPottchiAdminCommand()); }
      catch { logger.error?.(`[Littlepottchi] Could not register /pottchiadmin in guild ${guild.id}.`); }
    },
    start() { if (!timer) { sync(); timer = setInterval(() => { try { sync(); } catch { logger.error?.("[Littlepottchi] Could not check the pause state; it will retry."); } }, interval); timer.unref?.(); } },
    stop() { clearInterval(timer); timer = null; },
  }; // The periodic sync also picks up changes saved from the admin panel, and a server leaving or joining.
}
