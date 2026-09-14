import { PermissionFlagsBits } from "discord.js";

export function canAward(interaction, adminRoleId = "") {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  const roles = interaction.member?.roles;
  return Boolean(adminRoleId && (roles?.cache?.has(adminRoleId) || (Array.isArray(roles) && roles.includes(adminRoleId))));
} // Check Discord's current permissions and roles before issuing administrator rewards.
