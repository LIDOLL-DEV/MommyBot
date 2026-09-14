export const DEFAULT_LINKED_ROLE_ID = "1548848979754614857";

export async function awardLinkedRole(interaction, isLinked, roleId = DEFAULT_LINKED_ROLE_ID) {
  if (!isLinked()) return "";
  const cached = [...(interaction.client?.guilds?.cache?.values() || [])];
  const guilds = [...new Map([interaction.guild, ...cached].filter(Boolean).map(guild => [guild.id, guild])).values()];
  guilds.sort((a, b) => Number(Boolean(b.roles?.cache?.has(roleId))) - Number(Boolean(a.roles?.cache?.has(roleId))));
  let lookupFailed = false;
  for (const guild of guilds) {
    let role;
    try { role = await guild.roles.fetch(roleId); }
    catch { lookupFailed = true; continue; }
    if (!role) continue;
    try {
      if (role.managed || role.id === guild.id) return "The linked role cannot be assigned manually. Ask Doll to check LIDOLLID_LINKED_ROLE_ID, then retry /lidollid status.";
      const member = await guild.members.fetch({ user: interaction.user.id, force: true });
      if (!isLinked()) return ""; // Recheck the saved identity after Discord lookups before granting anything.
      if (member.roles.cache.has(roleId)) return "Your linked-account role is active.";
      await member.roles.add(roleId, "Successful LiD0llID account link");
      return `Your linked-account role <@&${roleId}> has been added.`;
    } catch (error) {
      if (error.code === 10007) return "Join the server containing the linked role, then run /lidollid status to receive it.";
      const permission = [50001, 50013].includes(error.code);
      console.warn(`[LiD0llID] Linked-role assignment failed: ${permission ? "ROLE_PERMISSION_DENIED" : "ROLE_ASSIGNMENT_FAILED"}`);
      return permission
        ? "Your account is linked, but the bot could not add the role. Ask Doll to give the bot Manage Roles and place its role above the linked role, then retry /lidollid status."
        : "Your account is linked, but Discord could not finish adding the role. Retry with /lidollid status.";
    }
  }
  return lookupFailed
    ? "Your account is linked, but Discord could not locate the linked role. Retry /lidollid status in its server."
    : "Run /lidollid status in the server containing the linked role to receive it. Ask Doll to check the configured role if it is missing.";
} // Award only the operator-selected role to the authenticated Discord user; failed delivery never rolls back a successful link.
