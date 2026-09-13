import assert from "node:assert/strict";
import test from "node:test";
import { PermissionFlagsBits, PermissionsBitField } from "discord.js";
import { buildTouhouCommand, canAward, createTouhouHandlers } from "../src/touhou/commands.js";
import { TouhouStore } from "../src/touhou/store.js";

function setup(context) {
  const store = new TouhouStore(":memory:", [
    { name: "Reimu Hakurei", filename: "Reimu Hakurei.png", baseRarity: 9 },
    { name: "Marisa Kirisame", filename: "Marisa Kirisame.png", baseRarity: 9 },
  ]);
  context.after(() => store.close());
  return { store, handlers: createTouhouHandlers(store, { channelId: "channel" }) };
} // Exercise real handlers and SQLite transactions without sending Discord messages.

function interaction(action, values = {}, overrides = {}) {
  return {
    id: `interaction-${action}`, guildId: "guild", channelId: "channel", user: { id: "alice", bot: false },
    guild: { members: { fetch: async (id) => ({ id }) } }, commandName: "touhou",
    memberPermissions: new PermissionsBitField(), member: { roles: [] },
    isChatInputCommand: () => true, isButton: () => false,
    options: {
      getSubcommand: () => action, getUser: (key) => values[key] ?? null,
      getString: (key) => values[key] ?? null, getInteger: (key) => values[key] ?? null,
      getBoolean: (key) => values[key] ?? null,
    },
    async deferReply() { this.deferred = true; },
    async deferUpdate() { this.deferred = true; },
    async editReply(body) { this.output = body; },
    async reply(body) { this.output = body; this.replied = true; },
    ...overrides,
  };
} // Model acknowledgment and response state so tests catch unauthorized component updates.

test("slash registration exposes exactly the two fixed adoption choices", () => {
  const definition = buildTouhouCommand();
  const adoption = definition.options.find((option) => option.name === "adopt");
  assert.equal(adoption.options[0].required, true);
  assert.deepEqual(adoption.options[0].choices.map(({ name, value }) => ({ name, value })), [
    { name: "1 star", value: "stars" }, { name: "25 LiDollcoins", value: "coins" },
  ]);
  assert.ok(definition.options.some((option) => option.name === "trade"));
});

test("ordinary users cannot award themselves currency; Manage Server and a configured role can", async (context) => {
  const { store, handlers } = setup(context);
  const options = { user: { id: "alice", bot: false }, currency: "coins", amount: 25 };
  const denied = interaction("award", options);
  await handlers.handleInteraction(denied);
  assert.match(denied.output.content, /need Manage Server/);
  assert.deepEqual(store.wallet("guild", "alice"), { stars: 0, coins: 0 });
  const allowed = interaction("award", options, { memberPermissions: new PermissionsBitField(PermissionFlagsBits.ManageGuild) });
  await handlers.handleInteraction(allowed);
  assert.equal(store.wallet("guild", "alice").coins, 25);
  assert.equal(canAward({ member: { roles: ["admin-role"] } }, "admin-role"), true);
  assert.equal(canAward({ member: { roles: ["different-role"] } }, "admin-role"), false);
});

test("menu payment buttons share one purchase and reject other players", async (context) => {
  const { store, handlers } = setup(context);
  store.award("guild", "admin", "alice", "stars", 2, "star-funds");
  store.award("guild", "admin", "alice", "coins", 50, "coin-funds");
  const menu = interaction("menu");
  await handlers.handleInteraction(menu);
  const [star, coin] = menu.output.components[0].toJSON().components;
  const intruder = interaction("", {}, {
    isChatInputCommand: () => false, isButton: () => true, customId: star.custom_id, user: { id: "mallory" },
  });
  await handlers.handleInteraction(intruder);
  assert.match(intruder.output.content, /your own trader menu/);
  assert.equal(intruder.deferred, undefined);
  const click = (customId, id) => interaction("", {}, {
    id, isChatInputCommand: () => false, isButton: () => true, customId,
  });
  await handlers.handleInteraction(click(star.custom_id, "star-click"));
  await handlers.handleInteraction(click(coin.custom_id, "coin-click"));
  assert.deepEqual(store.wallet("guild", "alice"), { stars: 1, coins: 50 });
  assert.equal(store.collection("guild", "alice").length, 1);
});

test("slash and component actions obey the configured channel gate", async (context) => {
  const { store, handlers } = setup(context);
  const wrongChannel = interaction("adopt", { payment: "coins" }, { channelId: "elsewhere" });
  await handlers.handleInteraction(wrongChannel);
  assert.match(wrongChannel.output.content, /Use the trader in/);
  assert.equal(store.collection("guild", "alice").length, 0);
  assert.equal(wrongChannel.deferred, undefined);
});

test("prefix adoption requires an explicit currency and consumes the command before AI chat", async (context) => {
  const { store, handlers } = setup(context);
  store.award("guild", "admin", "alice", "coins", 25, "fund");
  const message = { id: "message-1", guildId: "guild", channelId: "channel", author: { id: "alice", bot: false },
    content: "!touhou adopt", async reply(body) { this.output = body; } };
  assert.equal(await handlers.handleMessage(message), true);
  assert.match(message.output.content, /adopt star or/);
  assert.equal(store.wallet("guild", "alice").coins, 25);
  message.content = "!2hu adopt coins";
  assert.equal(await handlers.handleMessage(message), true);
  assert.equal(store.wallet("guild", "alice").coins, 0);
  assert.equal(store.collection("guild", "alice").length, 1);
  message.content = "Hello Sakura";
  assert.equal(await handlers.handleMessage(message), false);
});

test("a bystander cannot accept or erase another player's swap request", async (context) => {
  const { store, handlers } = setup(context);
  store.award("guild", "admin", "alice", "stars", 1, "a-funds");
  store.award("guild", "admin", "bob", "stars", 1, "b-funds");
  const a = store.adopt("guild", "alice", "stars", "a").character;
  const b = store.adopt("guild", "bob", "stars", "b").character;
  const trade = interaction("trade", { yours: a.name, theirs: b.name, user: { id: "bob", bot: false } });
  await handlers.handleInteraction(trade);
  const customId = trade.output.components[0].toJSON().components[0].custom_id;
  const intruder = interaction("", {}, {
    isChatInputCommand: () => false, isButton: () => true, customId, user: { id: "mallory" },
  });
  await handlers.handleInteraction(intruder);
  assert.match(intruder.output.content, /Only the invited/);
  assert.equal(intruder.deferred, undefined);
  const accepted = interaction("", {}, {
    isChatInputCommand: () => false, isButton: () => true, customId, user: { id: "bob" },
  });
  await handlers.handleInteraction(accepted);
  assert.match(accepted.output.content, /Trade complete/);
  assert.equal(store.character("guild", a.name).owner_id, "bob");
});
