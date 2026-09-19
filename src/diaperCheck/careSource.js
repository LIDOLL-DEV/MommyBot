export const ACCIDENT_KINDS = ["leak", "mess", "wet"];

export function createCareSource(doll, identities) {
  if (!doll?.db || !identities) return null;
  return {
    accidents() {
      const found = [];
      for (const row of doll.db.prepare("SELECT user_id FROM littlepottchi_players").all()) {
        const identity = doll.identity?.(row.user_id);
        if (!identity?.issuer || !identity?.subject) continue; // An unverified game account has no Discord member to ask.
        const link = identities.find(identity.issuer, identity.subject);
        if (!link) continue;
        const care = doll.player(row.user_id)?.care;
        if (!care) continue;
        const kind = care.leaking ? "leak" : care.mess ? "mess" : care.wetness ? "wet" : null;
        if (!kind) continue; // Needing a wipe alone is cleanup, not a fresh accident to ask about.
        found.push({ id: `${row.user_id}:${kind}:${care.revision}`, kind, discordId: link.discord_id });
      } // Only saved players are considered, so a member who has never opened Littlepottchi is never scanned.
      return found;
    },
  };
} // Read the same live care state the pet bridge publishes, in process: no HTTP call to ourselves, no bridge credential, and no dependency on the player's separate Little Log push opt-in.
