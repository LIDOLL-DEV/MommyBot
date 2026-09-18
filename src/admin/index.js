import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AdminStore } from "./store.js";
import { createCommunityFeatures } from "./community.js";
import { createAdminAccess } from "./access.js";
import { createAdminService } from "./service.js";
import { AdminSessions, createAdminWeb } from "./web.js";
import { createOidc } from "../auth/oidc.js";

export function initializeCommunity(client) {
  mkdirSync(fileURLToPath(new URL("../../data/", import.meta.url)), { recursive: true });
  return createCommunityFeatures(client, new AdminStore(fileURLToPath(new URL("../../data/admin.db", import.meta.url))));
} // Saved reaction features continue independently of wallets and browser sign-in availability.

export function initializeAdmin(config, identities, client, community) {
  if (!client || !community) return null;
  const sessions = new AdminSessions(community.store.db, identities);
  const access = createAdminAccess(client, identities);
  const service = createAdminService(client, community.store, access, community);
  return {
    sessions, web: createAdminWeb(config, sessions, service), title: "Sakura admin panel", walletAccess: false,
    oidc: createOidc(config, false, { statePrefix: "game." }),
    async authorize(identity) {
      const link = identities.find(identity.issuer, identity.subject);
      return Boolean(link && (await access.list({ user_id: link.discord_id })).length);
    },
  };
} // Use the existing registered SSO callback with profile-only consent and a separate Discord-link-bound admin session.
