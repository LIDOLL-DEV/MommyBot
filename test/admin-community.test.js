import test from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits as P, GatewayIntentBits, Partials, PermissionsBitField } from "discord.js";
import { adminFixture, ids } from "./fixtures/admin-fixture.js";
import { emojiKey, AdminStore } from "../src/admin/store.js";
import { reactionUsers, createCommunityFeatures } from "../src/admin/community.js";
import { createClient } from "../src/bot/client.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

test("emoji keys support Unicode variants and custom emoji IDs while rejecting multi-emoji input", () => {
  assert.equal(emojiKey("⭐️"), "⭐"); assert.equal(emojiKey("<a:flower:123456789012345678>"), "123456789012345678");
  assert.equal(emojiKey("🌸"), "🌸");
  for (const value of ["", "abc", "⭐🌸", "<script>", "⭐ hello"]) assert.throws(() => emojiKey(value));
});

test("community configuration and ownership journals persist across a database close and reopen", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "mommybot-admin-"));
  let store;
  try {
    const filename = path.join(directory, "admin.db"); store = new AdminStore(filename);
    const settings = store.settings(ids.guild); settings.chat = false; store.save(ids.guild, settings, ids.admin);
    const binding = store.addBinding(ids.guild, { channel: ids.source, message: ids.message, role: ids.role, emoji: "⭐" }, ids.admin);
    store.db.prepare("INSERT INTO reaction_role_grants VALUES (?,?,?)").run(binding.id, ids.user, 1);
    store.db.prepare("INSERT INTO starboard_pending VALUES (?,?,?)").run(ids.guild, ids.message, ids.source);
    store.close(); store = new AdminStore(filename);
    assert.equal(store.settings(ids.guild).chat, false); assert.equal(store.settings(ids.other).chat, true);
    assert.equal(store.bindings(ids.guild)[0].id, binding.id);
    assert.equal(store.db.prepare("SELECT owned FROM reaction_role_grants").get().owned, 1);
    assert.equal(store.db.prepare("SELECT source_id FROM starboard_pending").get().source_id, ids.message);
    assert.equal(store.history(ids.guild).length, 2);
  } finally { store?.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("Administrator access is live, server-scoped and revoked on unlink", async t => {
  const f = adminFixture(t);
  assert.deepEqual(await f.access.list(f.session), [{ id: ids.guild, name: "Flower garden" }]);
  await assert.rejects(f.access.require(f.session, ids.other), /cannot administer/);
  f.admin.permissions = new PermissionsBitField([P.ManageGuild]);
  await assert.rejects(f.access.require(f.session, ids.guild), /Administrator/);
  assert.deepEqual(await f.access.list(f.session), []);
  f.identities.unlink(ids.admin);
  await assert.rejects(f.access.require(f.session, ids.guild), /Link this LiD0llID/);
});

test("server settings validate channels, privacy, thresholds and fresh admin permissions", async t => {
  const f = adminFixture(t);
  const input = { action: "settings", guild: ids.guild, chat: false, swearJar: false, welcomes: false, starboard: { enabled: true, channel: ids.board, sources: [ids.source], emoji: "⭐", threshold: 3 } };
  await f.service.act(f.session, input);
  assert.equal(f.community.enabled(ids.guild, "chat"), false); assert.equal(f.community.enabled(ids.other, "chat"), true);
  assert.equal(f.store.settings(ids.guild).starboard.threshold, 3); assert.equal(f.store.history(ids.guild).length, 1);
  await assert.rejects(f.service.act(f.session, { ...input, starboard: { ...input.starboard, threshold: 0 } }), /threshold/);
  await assert.rejects(f.service.act(f.session, { ...input, starboard: { ...input.starboard, sources: [ids.board] } }), /source channel/);
  f.privateSource = true; await assert.rejects(f.service.act(f.session, input), /visible to @everyone/);
  f.privateSource = false; f.source.nsfw = true; await assert.rejects(f.service.act(f.session, input), /Age-restricted/);
  f.source.nsfw = false; f.admin.permissions = new PermissionsBitField();
  await assert.rejects(f.service.act(f.session, input), /Administrator/);
});

test("reaction-role configuration rejects privileged, managed, duplicate and hierarchy-blocked roles", async t => {
  const f = adminFixture(t);
  const input = { action: "reaction-add", guild: ids.guild, channel: ids.source, message: ids.message, emoji: "⭐", role: ids.role };
  for (const permission of [P.Administrator, P.ManageRoles, P.ManageGuild]) {
    f.role.permissions = new PermissionsBitField([permission]); await assert.rejects(f.service.act(f.session, input), /non-privileged/);
  }
  f.role.permissions = new PermissionsBitField(); f.role.managed = true; await assert.rejects(f.service.act(f.session, input), /non-privileged/);
  f.role.managed = false; f.role.position = 10; await assert.rejects(f.service.act(f.session, input), /non-privileged/);
  f.role.position = 1; await f.service.act(f.session, input);
  assert.equal(f.store.bindings(ids.guild).length, 1);
  await assert.rejects(f.service.act(f.session, input), /already has a mapping/);
  const binding = f.store.bindings(ids.guild)[0];
  await assert.rejects(f.service.act(f.session, { action: "reaction-delete", guild: ids.other, id: binding.id }), /cannot administer/);
});

test("reaction add/remove grants and removes only roles owned by that mapping", async t => {
  const f = adminFixture(t), binding = f.bind();
  f.voters.set(ids.user, f.user.user);
  await f.community.handleReaction(f.reaction, f.user.user); await f.community.handleReaction(f.reaction, f.user.user);
  assert.equal(f.added.length, 1); assert.equal(f.user.roles.cache.has(ids.role), true);
  f.voters.clear(); await f.community.handleReaction(f.reaction, f.user.user);
  assert.equal(f.removed.length, 1); assert.equal(f.user.roles.cache.has(ids.role), false);
  f.user.roles.cache.set(ids.role, f.role); f.voters.set(ids.user, f.user.user);
  await f.community.syncBinding(binding); f.voters.clear(); await f.community.syncBinding(binding);
  assert.equal(f.user.roles.cache.has(ids.role), true); assert.equal(f.removed.length, 1);
});

test("several emoji/role choices on one message grant and remove independently", async t => {
  const f = adminFixture(t), seeded = [], moonVoters = new Map([[ids.user, f.user.user]]);
  const moon = { ...f.reaction, emoji: { name: "🌙", id: null }, users: { fetch: async () => moonVoters } };
  f.message.reactions.cache.set("🌙", moon); f.message.react = async emoji => seeded.push(emoji);
  f.voters.set(ids.user, f.user.user);
  await f.service.act(f.session, { action: "reaction-add", guild: ids.guild, channel: ids.source, message: ids.message,
    choices: [{ emoji: "⭐", role: ids.role }, { emoji: "🌙", role: ids.role2 }] });
  assert.deepEqual(seeded, ["⭐", "🌙"]); assert.equal(f.store.bindings(ids.guild).length, 2);
  assert.equal(f.user.roles.cache.has(ids.role), true); assert.equal(f.user.roles.cache.has(ids.role2), true);
  f.voters.clear(); await f.community.handleReaction(f.reaction, f.user.user);
  assert.equal(f.user.roles.cache.has(ids.role), false); assert.equal(f.user.roles.cache.has(ids.role2), true);
  await f.community.stop(); f.community = createCommunityFeatures(f.client, f.store, { logger: { error: () => {} } });
  moonVoters.clear(); await f.community.tick();
  assert.equal(f.user.roles.cache.has(ids.role2), false);
}); // Existing reactions synchronize on save, and each emoji retains its own ownership journal across restart.

test("invalid or conflicting batches save no partial mappings and seed no emojis", async t => {
  const f = adminFixture(t), seeded = [];
  f.message.react = async emoji => seeded.push(emoji);
  const choices = [{ emoji: "⭐", role: ids.role }, { emoji: "🌙", role: ids.role2 }];
  const input = { action: "reaction-add", guild: ids.guild, channel: ids.source, message: ids.message, choices };
  for (const invalid of [[], Array(21).fill(choices[0]), [null], [choices[0], choices[0]],
    [choices[0], { ...choices[1], emoji: "⭐️" }], [{ role: "bad", emoji: "⭐" }]]) {
    await assert.rejects(f.service.act(f.session, { ...input, choices: invalid }));
  }
  f.role2.permissions = new PermissionsBitField([P.Administrator]);
  await assert.rejects(f.service.act(f.session, input), /non-privileged/);
  assert.equal(f.store.bindings(ids.guild).length, 0); assert.equal(f.store.history(ids.guild).length, 0);
  f.role2.permissions = new PermissionsBitField();
  const existing = f.store.addBinding(ids.guild, { channel: ids.source, message: ids.message, ...choices[1] }, ids.admin);
  await assert.rejects(f.service.act(f.session, input), /already has a mapping/);
  assert.deepEqual(f.store.bindings(ids.guild).map(row => row.id), [existing.id]);
  assert.equal(f.store.history(ids.guild).length, 1); assert.deepEqual(seeded, []);
  await f.service.act(f.session, { ...input, choices: [choices[0]] });
  assert.equal(f.store.bindings(ids.guild).length, 2); // Adding more choices preserves those already saved on the message.
});

test("an emoji seed failure retains the batch and continues adding the remaining choices", async t => {
  const f = adminFixture(t), seeded = [];
  f.message.react = async emoji => { if (emoji === "⭐") throw new Error("PRIVATE"); seeded.push(emoji); };
  await f.service.act(f.session, { action: "reaction-add", guild: ids.guild, channel: ids.source, message: ids.message,
    choices: [{ emoji: "⭐", role: ids.role }, { emoji: "🌙", role: ids.role2 }] });
  assert.equal(f.store.bindings(ids.guild).length, 2); assert.deepEqual(seeded, ["🌙"]);
  assert.ok(f.store.history(ids.guild).some(row => row.action === "reaction.seed-failed"));
  assert.doesNotMatch(JSON.stringify(f.store.history(ids.guild)), /PRIVATE/);
});

test("role ownership survives runtime restart and offline reaction changes recover", async t => {
  const f = adminFixture(t), binding = f.bind(); f.voters.set(ids.user, f.user.user);
  f.rolesFailed = true; await f.community.syncBinding(binding);
  assert.equal(f.user.roles.cache.has(ids.role), false); assert.equal(f.store.db.prepare("SELECT owned FROM reaction_role_grants").get().owned, 1);
  f.rolesFailed = false; await f.community.stop();
  f.community = createCommunityFeatures(f.client, f.store, { logger: { error: () => {} } });
  await f.community.tick(); assert.equal(f.user.roles.cache.has(ids.role), true);
  f.voters.clear(); await f.community.tick(); assert.equal(f.user.roles.cache.has(ids.role), false);
  assert.equal(f.logs.length, 1); assert.doesNotMatch(f.store.history(ids.guild).map(row => row.detail).join(""), /PRIVATE/);
});

test("deleted source messages remove bot-owned reaction roles; deleted mappings retain existing roles", async t => {
  const f = adminFixture(t), binding = f.bind(); f.voters.set(ids.user, f.user.user);
  await f.community.syncBinding(binding); f.messageMissing = true; await f.community.handleMessageChange(f.message);
  assert.equal(f.user.roles.cache.has(ids.role), false);
  f.messageMissing = false; await f.community.syncBinding(binding); f.store.deleteBinding(binding.id, ids.admin);
  f.voters.clear(); await f.community.handleReaction(f.reaction, f.user.user);
  assert.equal(f.user.roles.cache.has(ids.role), true);
});

test("starboard excludes self-stars and bots, updates one post and removes it below threshold", async t => {
  const f = adminFixture(t); f.enable(1);
  f.voters.set(ids.admin, f.admin.user); f.voters.set(ids.bot, f.bot.user);
  await f.community.handleReaction(f.reaction, f.admin.user); assert.equal(f.sent.length, 0);
  f.voters.set(ids.user, f.user.user);
  await Promise.all([f.community.handleReaction(f.reaction, f.user.user), f.community.handleReaction(f.reaction, f.user.user)]);
  assert.equal(f.sent.length, 1); assert.equal(f.edited.length, 1);
  assert.match(f.sent[0].content, /\*\*1\*\*/); assert.deepEqual(f.sent[0].allowedMentions.parse, []);
  assert.match(f.sent[0].embeds[0].fields[0].value, /discord.com\/channels/);
  f.message.content = "Edited content"; await f.community.handleMessageChange(f.message);
  assert.equal(f.edited.at(-1).embeds[0].description, "Edited content");
  f.voters.delete(ids.user); await f.community.handleReaction(f.reaction, f.user.user);
  assert.equal(f.deleted.length, 1); assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM starboard_posts").get().n, 0);
});

test("starboard enforces source isolation, private channels, NSFW boundaries and message deletion", async t => {
  const f = adminFixture(t); f.enable(); f.voters.set(ids.user, f.user.user);
  f.privateSource = true; await f.community.handleReaction(f.reaction, f.user.user); assert.equal(f.sent.length, 0);
  f.privateSource = false; f.source.nsfw = true; await f.community.handleReaction(f.reaction, f.user.user); assert.equal(f.sent.length, 0);
  f.source.nsfw = false; await f.community.handleReaction(f.reaction, f.user.user); assert.equal(f.sent.length, 1);
  f.messageMissing = true; await f.community.handleMessageChange(f.message); assert.equal(f.deleted.length, 1);
  assert.equal(f.store.settings(ids.other).starboard.enabled, false);
});

test("failed starboard sends can retry, saved posts update after restart, and disabled boards remove highlights", async t => {
  const f = adminFixture(t); f.enable(); f.voters.set(ids.user, f.user.user); f.sendFailed = true;
  await f.community.handleReaction(f.reaction, f.user.user); assert.equal(f.sent.length, 0);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM starboard_pending").get().n, 1);
  f.sendFailed = false; await f.community.tick();
  await f.community.stop(); f.community = createCommunityFeatures(f.client, f.store, { logger: { error: () => {} } });
  await f.community.tick(); assert.equal(f.sent.length, 1); assert.equal(f.edited.length, 1);
  const settings = f.store.settings(ids.guild); settings.starboard.enabled = false; f.store.save(ids.guild, settings, ids.admin);
  await f.community.tick(); assert.equal(f.deleted.length, 1);
});

test("reaction pagination counts all users beyond the first page", async t => {
  const f = adminFixture(t);
  for (let index = 0; index < 205; index++) { const id = String(100000000000000000n + BigInt(index)); f.voters.set(id, { id, bot: false }); }
  assert.equal((await reactionUsers(f.reaction)).size, 205);
});

test("reaction processing supports partial messages and stops without starting more operations", async t => {
  const f = adminFixture(t); f.enable(); f.voters.set(ids.user, f.user.user);
  const reaction = { ...f.reaction, message: { id: ids.message, channelId: ids.source, guildId: ids.guild, partial: true } };
  await f.community.handleReaction(reaction, { id: ids.user, partial: true }); assert.equal(f.sent.length, 1);
  await f.community.stop(); await f.community.handleReaction(reaction, f.user.user); assert.equal(f.edited.length, 0);
  const client = createClient({ WELCOME_ENABLED: "false" });
  assert.equal(client.options.intents.has(GatewayIntentBits.GuildMessageReactions), true);
  for (const partial of [Partials.Message, Partials.Reaction, Partials.User]) assert.ok(client.options.partials.includes(partial));
  await client.destroy();
});
