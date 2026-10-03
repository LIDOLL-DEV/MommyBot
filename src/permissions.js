import { PermissionFlagsBits } from "discord.js";

let serverAdminRoles = () => [];
export function setAdminRoleSource(source) { serverAdminRoles = source; } // Each server's admin panel names extra bot-admin roles.

export function canAward(interaction, adminRoleId = "") {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  const roles = interaction.member?.roles;
  const has = id => Boolean(id && (roles?.cache?.has(id) || (Array.isArray(roles) && roles.includes(id))));
  const configured = interaction.guildId ? serverAdminRoles(interaction.guildId) : [];
  return has(adminRoleId) || (Array.isArray(configured) && configured.some(has));
} // Check Discord's current permissions and roles before issuing administrator rewards.
