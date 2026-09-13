import assert from "node:assert/strict";
import test from "node:test";
import { TouhouStore } from "../src/touhou/store.js";
import { BattleService } from "../src/touhou/battles.js";
import { TouhouMenus } from "../src/touhou/menu.js";
import { loadCatalog } from "../src/touhou/catalog.js";

function setup(context, allCharacters = false) {
  let now = 1000;
  const catalog = allCharacters ? loadCatalog() : ["Reimu Hakurei", "Marisa Kirisame", "Cirno"].map((name) => ({ name, filename: `${name}.png`, baseRarity: 0 }));
  const store = new TouhouStore(":memory:", catalog, { now: () => now });
  context.after(() => store.close());
  for (const user of ["alice", "bob"]) {
    store.award("guild", "admin", user, "stars", 5, `${user}-stars`);
    store.award("guild", "admin", user, "coins", 500, `${user}-coins`);
  }
  const game = new BattleService(store, { rng: () => 0 });
  return { store, game, menus: new TouhouMenus(store, game, { channelId: "channel" }), advance: (ms) => { now += ms; } };
} // Use real menu builders and services, while replacing only Discord's transport.

function validate(body) {
  const components = (body.components || []).map((row) => row.toJSON());
  assert.ok(components.length <= 5);
  for (const row of components) {
    assert.ok(row.components.length <= 5);
    for (const component of row.components) {
      assert.ok(component.custom_id.length <= 100);
      if (component.options) assert.ok(component.options.length <= 25);
    }
  }
  for (const embed of body.embeds || []) assert.ok(embed.toJSON().description.length <= 4096);
} // Serialize the actual Discord payloads to catch row, option, label and custom-ID limits.

function driver(menus, user = "alice") {
  const ui = { body: menus.open("guild", user), followups: [], modal: null };
  ui.find = (action) => ui.body.components.flatMap((row) => row.toJSON().components)
    .find((component) => component.custom_id.endsWith(`:${action}`));
  ui.invoke = async (customId, values, overrides = {}) => {
    const interaction = { customId, user: { id: user }, guildId: "guild", channelId: "channel", values,
      guild: { members: { fetch: async (id) => ({ id, user: { id, bot: false } }) } },
      async deferUpdate() { this.deferred = true; },
      async editReply(body) { validate(body); ui.body = body; },
      async reply(body) { ui.privateReply = body; },
      async followUp(body) { ui.followups.push(body); },
      async showModal(modal) { ui.modal = modal.toJSON(); },
      ...overrides,
    };
    assert.equal(await menus.handle(interaction), true);
    return interaction;
  };
  ui.click = async (action, values) => {
    const control = ui.find(action);
    assert.ok(control, `Missing clickable control ${action}`);
    return ui.invoke(control.custom_id, values);
  };
  validate(ui.body);
  return ui;
} // Walk the same button/select/modal sequence a Discord player follows.

test("clickable adoption, party details, rarity selection, battle actions and resume", async (context) => {
  const { store, game, menus } = setup(context);
  const ui = driver(menus);
  await ui.click("adopt-stars");
  assert.equal(store.wallet("guild", "alice").stars, 4);
  await ui.click("party"); await ui.click("pick", ["0"]);
  assert.match(ui.body.embeds[0].toJSON().description, /EXP:/);
  await ui.click("rarity"); await ui.click("difficulty", ["Common"]);
  assert.ok(ui.find("attack0") && ui.find("defend") && ui.find("potion") && ui.find("run"));
  const oldAttack = ui.find("attack0").custom_id;
  await ui.click("attack0");
  const battle = game.current("guild", "alice");
  assert.equal(battle.turn, 1);
  await ui.invoke(oldAttack);
  assert.match(ui.privateReply.content, /already changed/);
  assert.equal(game.current("guild", "alice").turn, 1);
  await ui.click("home"); await ui.click("battle");
  assert.match(ui.body.embeds[0].toJSON().title, /vs Evil/);
  await ui.click("run");
  assert.equal(game.get("guild", "alice", battle.id).outcome, "ran");
});

test("clickable shop buys potions and completes listing through a price modal", async (context) => {
  const { store, game, menus } = setup(context);
  const ui = driver(menus);
  await ui.click("adopt-stars"); await ui.click("shop"); await ui.click("potions"); await ui.click("potion1");
  assert.equal(game.potions("guild", "alice"), 1);
  assert.equal(store.wallet("guild", "alice").coins, 480);
  await ui.click("shop"); await ui.click("sell"); await ui.click("pick", ["0"]);
  await ui.click("confirm"); await ui.click("price");
  assert.equal(ui.modal.title, "List your Touhou");
  await ui.invoke(ui.modal.custom_id, null, { fields: { getTextInputValue: () => "37" } });
  assert.equal(store.market("guild").find((entry) => entry.price)?.price, 37);
  const buyer = driver(menus, "bob");
  await buyer.click("shop"); await buyer.click("listings"); await buyer.click("listing-pick", ["0"]);
  assert.match(buyer.body.embeds[0].toJSON().description, /37 LiDollcoins/);
  await buyer.click("confirm");
  assert.equal(store.collection("guild", "bob").length, 1);
  assert.equal(store.wallet("guild", "bob").coins, 463);
  assert.equal(store.wallet("guild", "alice").coins, 517);
});

test("clickable gifting and swap offers require selection, confirmation and recipient consent", async (context) => {
  const { store, menus } = setup(context);
  const ui = driver(menus);
  await ui.click("adopt-stars"); await ui.click("shop"); await ui.click("send"); await ui.click("pick", ["0"]);
  await ui.click("recipient", ["bob"]);
  assert.equal(store.collection("guild", "bob").length, 0);
  await ui.click("confirm");
  assert.equal(store.collection("guild", "bob").length, 1);
  await ui.click("home"); await ui.click("adopt-stars"); await ui.click("shop"); await ui.click("trade");
  await ui.click("pick", ["0"]); await ui.click("recipient", ["bob"]); await ui.click("their-pick", ["0"]);
  const before = store.collection("guild", "alice")[0].name;
  await ui.click("confirm");
  assert.equal(ui.followups.length, 1);
  assert.equal(store.collection("guild", "alice")[0].name, before);
  const offerId = ui.followups[0].components[0].toJSON().components[0].custom_id.split(":").at(-1);
  store.resolveOffer("guild", "bob", offerId, true, "accepted");
  assert.equal(store.character("guild", before).owner_id, "bob");
});

test("menu confirms healing and buyback, and refuses a listing whose price changed", async (context) => {
  const { store, game, menus } = setup(context);
  const ui = driver(menus);
  await ui.click("adopt-stars");
  const character = store.collection("guild", "alice")[0];
  game.profile("guild", character.name);
  store.db.prepare("UPDATE battle_profiles SET fainted_until = 100000 WHERE name = ?").run(character.name);
  await ui.click("heal"); await ui.click("pick", ["0"]);
  assert.match(ui.body.embeds[0].toJSON().description, /50 LiDollcoins/);
  await ui.click("confirm");
  assert.equal(store.wallet("guild", "alice").coins, 450);
  store.list("guild", "alice", character.name, 30, "list");
  const buyer = driver(menus, "bob");
  await buyer.click("shop"); await buyer.click("listings"); await buyer.click("listing-pick", ["0"]);
  store.list("guild", "alice", character.name, 40, "reprice");
  await buyer.click("confirm");
  assert.equal(store.wallet("guild", "bob").coins, 500);
  assert.match(buyer.body.embeds[0].toJSON().description, /listing changed/);
  await ui.click("buyback"); await ui.click("pick", ["0"]);
  const quote = Math.floor(game.suggestedPrice("guild", character.name) * 2 / 3);
  await ui.click("confirm");
  assert.equal(store.wallet("guild", "alice").coins, 450 + quote);
  assert.equal(store.character("guild", character.name).owner_id, null);
});

test("catalog menus paginate and reject foreign users, channels and expired sessions", async (context) => {
  const { menus, advance } = setup(context, true);
  const ui = driver(menus);
  await ui.click("shop"); await ui.click("stock");
  assert.equal(ui.find("listing-pick").options.length, 20);
  const first = ui.find("listing-pick").options[0].label;
  await ui.click("next");
  assert.notEqual(ui.find("listing-pick").options[0].label, first);
  const id = ui.find("home").custom_id;
  await ui.invoke(id, null, { user: { id: "mallory" } });
  assert.match(ui.privateReply.content, /your own/);
  await ui.invoke(id, null, { channelId: "elsewhere" });
  assert.match(ui.privateReply.content, /Use the trader/);
  advance(5 * 60_000);
  await ui.invoke(id);
  assert.match(ui.privateReply.content, /expired/);
});
