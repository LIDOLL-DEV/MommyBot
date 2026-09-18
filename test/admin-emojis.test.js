import test from "node:test";
import assert from "node:assert/strict";
import { adminFixture, ids } from "./fixtures/admin-fixture.js";
import { guildEmojiResolver } from "../src/admin/emojis.js";

const female = { id: "123456789012345678", name: "female_emoji", animated: false };
const flower = { id: "123456789012345679", name: "flower", animated: true };

test("server emoji names, full codes and IDs resolve to the same key with one name-list fetch", async t => {
  const f = adminFixture(t); f.emojis.set(female.id, female); f.emojis.set(flower.id, flower);
  let lists = 0;
  f.guild.emojis.fetch = async id => { if (!id) lists++; return id ? f.emojis.get(id) || null : f.emojis; };
  const resolve = guildEmojiResolver(f.guild);
  assert.deepEqual(await Promise.all([resolve(" :female_emoji: "), resolve(":flower:")]), [female.id, flower.id]);
  assert.equal(lists, 1);
  assert.equal(await resolve(`<:${female.name}:${female.id}>`), female.id);
  assert.equal(await resolve(`<a:${flower.name}:${flower.id}>`), flower.id);
  assert.equal(await resolve(female.id), female.id);
  assert.equal(await resolve("♀️"), "♀"); assert.equal(await resolve("🌸"), "🌸");
});

test("unknown, ambiguous and unavailable server emoji names fail with actionable errors", async t => {
  const f = adminFixture(t);
  await assert.rejects(guildEmojiResolver(f.guild)(":female_emoji:"), /No custom emoji named :female_emoji:.*actual symbol/);
  f.emojis.set(female.id, female); f.emojis.set(flower.id, { ...flower, name: female.name });
  await assert.rejects(guildEmojiResolver(f.guild)(":female_emoji:"), /More than one.*emoji ID/);
  await assert.rejects(guildEmojiResolver(f.guild)("999999999999999998"), /from this server/);
  f.guild.emojis.fetch = async () => { throw new Error("PRIVATE"); };
  await assert.rejects(guildEmojiResolver(f.guild)(":female_emoji:"), error => /Could not load/.test(error.message) && !error.message.includes("PRIVATE"));
});

test("named reaction roles save and seed IDs and respond to custom-emoji reaction events", async t => {
  const f = adminFixture(t), seeded = [];
  f.emojis.set(female.id, female); f.message.react = async emoji => seeded.push(emoji);
  const reaction = { ...f.reaction, emoji: female };
  f.message.reactions.cache.set(female.id, reaction);
  const input = { action: "reaction-add", guild: ids.guild, channel: ids.source, message: ids.message,
    choices: [{ role: ids.role, emoji: ":female_emoji:" }] };
  await f.service.act(f.session, input);
  assert.equal(f.store.bindings(ids.guild)[0].emoji, female.id); assert.deepEqual(seeded, [female.id]);
  f.voters.set(ids.user, f.user.user); await f.community.handleReaction(reaction, f.user.user);
  assert.equal(f.user.roles.cache.has(ids.role), true);
  f.voters.clear(); await f.community.handleReaction(reaction, f.user.user);
  assert.equal(f.user.roles.cache.has(ids.role), false);
  await assert.rejects(f.service.act(f.session, { ...input, choices: [{ role: ids.role2, emoji: female.id }] }), /already has a mapping/);
}); // Persist IDs so renamed custom emojis still match incoming reaction events.

test("alias duplicates and unknown names reject a whole batch before any mapping or reaction is written", async t => {
  const f = adminFixture(t); f.emojis.set(female.id, female);
  f.message.react = async () => assert.fail("Invalid choices must not seed reactions");
  const input = { action: "reaction-add", guild: ids.guild, channel: ids.source, message: ids.message };
  await assert.rejects(f.service.act(f.session, { ...input, choices: [
    { role: ids.role, emoji: ":female_emoji:" }, { role: ids.role2, emoji: `<:${female.name}:${female.id}>` },
  ] }), /different emoji/);
  await assert.rejects(f.service.act(f.session, { ...input, choices: [
    { role: ids.role, emoji: "⭐" }, { role: ids.role2, emoji: ":missing:" },
  ] }), /No custom emoji/);
  assert.equal(f.store.bindings(ids.guild).length, 0); assert.equal(f.store.history(ids.guild).length, 0);
});

test("starboard resolves server emoji names before saving and counts matching custom reactions", async t => {
  const f = adminFixture(t); f.emojis.set(female.id, female);
  const reaction = { ...f.reaction, emoji: female }; f.message.reactions.cache.set(female.id, reaction);
  await f.service.act(f.session, { action: "settings", guild: ids.guild, chat: true, swearJar: true, welcomes: true,
    starboard: { enabled: true, channel: ids.board, sources: [ids.source], threshold: 1, emoji: ":female_emoji:" } });
  assert.equal(f.store.settings(ids.guild).starboard.emoji, female.id);
  f.voters.set(ids.user, f.user.user); await f.community.handleReaction(reaction, f.user.user);
  assert.equal(f.sent.length, 1);
});
