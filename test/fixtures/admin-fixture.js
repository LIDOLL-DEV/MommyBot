import { EventEmitter } from "node:events";
import { Collection, PermissionsBitField, PermissionFlagsBits as P, ChannelType } from "discord.js";
import { AdminStore } from "../../src/admin/store.js";
import { IdentityStore } from "../../src/auth/store.js";
import { createAdminAccess } from "../../src/admin/access.js";
import { createAdminService } from "../../src/admin/service.js";
import { createCommunityFeatures } from "../../src/admin/community.js";

export const ids = { guild: "111111111111111111", source: "222222222222222222", board: "333333333333333333",
  message: "444444444444444444", role: "555555555555555555", admin: "666666666666666666", user: "777777777777777777", bot: "888888888888888888", other: "999999999999999999" };
export function adminFixture(t) {
  const f = { posts: new Map(), sent: [], edited: [], deleted: [], added: [], removed: [], logs: [], voters: new Map(), rolesFailed: false };
  f.store = new AdminStore(":memory:"); f.identities = new IdentityStore(":memory:");
  f.identity = { issuer: "https://auth.example", subject: "owner", username: "Doll" };
  f.identities.db.prepare("INSERT INTO identity_links VALUES (?,?,?,?,?)").run(ids.admin, f.identity.issuer, f.identity.subject, f.identity.username, 1000);
  f.session = { user_id: ids.admin, username: "Doll", csrf: "csrf" };
  f.role = { id: ids.role, name: "Flower club", position: 1, managed: false, permissions: new PermissionsBitField() };
  const makeMember = (id, permissions = [], position = 5) => ({ id, user: { id, bot: id === ids.bot }, permissions: new PermissionsBitField(permissions), roles: {
    highest: { comparePositionTo: role => position - role.position }, cache: new Map(),
    async add(role) { if (f.rolesFailed) throw new Error("PRIVATE"); f.added.push([id, role.id]); this.cache.set(role.id, role); },
    async remove(role) { f.removed.push([id, role.id]); this.cache.delete(role.id); },
  } });
  f.admin = makeMember(ids.admin, [P.Administrator]); f.user = makeMember(ids.user); f.bot = makeMember(ids.bot, [P.ManageRoles]);
  f.members = new Map([[ids.admin, f.admin], [ids.user, f.user], [ids.bot, f.bot]]);
  f.everyone = { id: ids.guild, name: "@everyone", position: 0, permissions: new PermissionsBitField() };
  f.guild = { id: ids.guild, name: "Flower garden", ownerId: ids.admin,
    roles: { everyone: f.everyone, fetch: async id => id ? (id === ids.role ? f.role : null) : new Collection([[ids.role, f.role], [ids.guild, f.everyone]]) },
    members: { fetchMe: async () => f.bot, fetch: async input => {
      const member = f.members.get(typeof input === "string" ? input : input.user);
      if (!member) throw Object.assign(new Error("Unknown member"), { code: 10007 });
      return member;
    } },
  };
  const makeChannel = id => ({ id, guildId: ids.guild, name: id === ids.board ? "starboard" : "general", type: ChannelType.GuildText, nsfw: false,
    permissionsFor: member => new PermissionsBitField(member === f.everyone && f.privateSource && id === ids.source ? [] : [P.ViewChannel, P.ReadMessageHistory, P.SendMessages, P.AddReactions, P.EmbedLinks]),
    messages: {
      async fetch(input) { if (f.messageMissing) throw Object.assign(new Error("Missing"), { code: 10008 }); return f.message; },
      async edit(id, payload) { if (!f.posts.has(id)) throw Object.assign(new Error("Missing"), { code: 10008 }); f.edited.push(payload); f.posts.set(id, payload); },
      async delete(id) { f.deleted.push(id); f.posts.delete(id); },
    },
    async send(payload) { if (f.sendFailed) throw new Error("PRIVATE"); const id = `1000000000000000${String(f.sent.length).padStart(2, "0")}`; f.sent.push(payload); f.posts.set(id, payload); return { id }; },
  });
  f.source = makeChannel(ids.source); f.board = makeChannel(ids.board);
  f.channels = new Collection([[ids.source, f.source], [ids.board, f.board]]);
  f.guild.channels = { fetch: async id => id ? f.channels.get(id) || null : f.channels };
  f.guild.emojis = { fetch: async () => null };
  f.message = { id: ids.message, guildId: ids.guild, channelId: ids.source,
    author: { id: ids.admin, username: "Doll", bot: false }, content: "A lovely moment", attachments: new Map(),
    reactions: { cache: new Collection() }, react: async () => {},
  };
  f.reaction = { emoji: { name: "⭐", id: null }, message: f.message, users: { fetch: async ({ after, limit }) => {
    const entries = [...f.voters.entries()].sort(([a], [b]) => BigInt(a) < BigInt(b) ? -1 : 1).filter(([id]) => !after || BigInt(id) > BigInt(after)).slice(0, limit);
    return new Collection(entries);
  } } };
  f.message.reactions.cache.set("⭐", f.reaction);
  f.client = Object.assign(new EventEmitter(), { user: f.bot.user, guilds: { cache: new Map([[ids.guild, f.guild]]) }, channels: { fetch: async id => f.channels.get(id) }, isReady: () => true, ws: { ping: 12 } });
  f.community = createCommunityFeatures(f.client, f.store, { logger: { error: line => f.logs.push(line) } });
  f.access = createAdminAccess(f.client, f.identities);
  f.service = createAdminService(f.client, f.store, f.access, f.community, { LIDOLLID_ENABLED: "true", LIDOLLCOIN_ENABLED: "true" });
  f.enable = (threshold = 1) => f.store.save(ids.guild, { ...f.store.settings(ids.guild), starboard: { enabled: true, channel: ids.board, sources: [ids.source], emoji: "⭐", threshold } }, ids.admin);
  f.bind = () => f.store.addBinding(ids.guild, { channel: ids.source, message: ids.message, role: ids.role, emoji: "⭐" }, ids.admin);
  t.after(async () => { await f.community.stop(); f.store.close(); f.identities.close(); });
  return f;
} // Deterministic Discord mocks and real SQLite keep permission, role ownership and starboard tests offline.
