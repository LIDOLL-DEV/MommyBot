// Slash commands of features that were removed. Discord keeps guild commands until they are
// deleted, so without this they would stay visible and fail with "interaction failed".
// Diaper Atelier, Clothes Emporium and Littlepottchi were built on TQ/DQ artwork, which was purged.
export const RETIRED_COMMANDS = Object.freeze(["diaper", "diapers", "clothes", "littlepottchi", "doll", "pottchistats", "pottchiadmin"]);

export async function retireCommands(guild, logger = console) {
  try {
    const commands = await guild.commands.fetch();
    for (const command of commands.values()) if (RETIRED_COMMANDS.includes(command.name)) await command.delete();
  } catch {
    logger.error?.(`[Commands] Could not remove retired commands in guild ${guild.id}; they will be retried on the next start.`);
  }
} // Only this bot's own guild commands are listed, so nothing another application registered can be touched.
