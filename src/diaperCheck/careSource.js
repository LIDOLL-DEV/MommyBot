export const ACCIDENT_KINDS = ["leak", "mess", "wet"];

export function createCareSource(doll, identities) {
  if (!doll?.db || !identities) return null;
  return {
    observe() {
      const seen = [];
      for (const row of doll.db.prepare("SELECT user_id FROM littlepottchi_players").all()) {
        const identity = doll.identity?.(row.user_id);
        if (!identity?.issuer || !identity?.subject) continue; // An unverified game account has no Discord member to reach.
        const link = identities.find(identity.issuer, identity.subject);
        if (!link) continue;
        const care = doll.player(row.user_id)?.care;
        if (!care?.revision) continue;
        const kind = care.leaking ? "leak" : care.mess ? "mess" : care.wetness ? "wet" : null;
        seen.push({ discordId: link.discord_id, revision: String(care.revision), kind });
      } // Only saved players are considered, so a member who has never opened Littlepottchi is never scanned.
      return seen;
    },
  };
} // Report each linked player's current diaper revision and accident state; the journal turns that into accidents and changes.
