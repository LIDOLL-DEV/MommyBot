import assert from "node:assert/strict";
import test from "node:test";
import { IdentityMenus } from "../src/auth/menu.js";
import { createIdentityHandler, buildIdentityCommand } from "../src/auth/index.js";
import { IdentityStore } from "../src/auth/store.js";
import { WalletService } from "../src/wallet/service.js";
import { createTouhouHandlers } from "../src/touhou/commands.js";
import { TouhouStore } from "../src/touhou/store.js";

function validate(body) {
  const rows = (body.components || []).map(row => row.toJSON());
  assert.ok(rows.length <= 5);
  for (const row of rows) {
    assert.ok(row.components.length <= 5);
    for (const component of row.components) {
      if (component.style === 5) assert.ok(component.url.startsWith("https://"));
      else assert.ok(component.custom_id.length <= 100);
    }
  }
  for (const embed of body.embeds || []) assert.ok(embed.toJSON().description.length <= 4096);
  assert.deepEqual(body.allowedMentions, { parse: [] });
} // Serialize real Discord builders so component limits and private-response formatting are checked.

function driver(handler, { admin = true, command = "menu", group = null } = {}) {
  const ui = { admin, seq: 100, followups: [] };
  ui.invoke = async (customId = null, { type = "button", value, text, ...overrides } = {}) => {
    const event = { id: String(ui.seq++), guildId: "guild", channelId: "channel", user: { id: "alice" },
      memberPermissions: { has: () => ui.admin }, commandName: command,
      options: { getSubcommand: () => "menu", getSubcommandGroup: () => group }, customId,
      isChatInputCommand: () => !customId, isButton: () => Boolean(customId && type === "button"),
      isModalSubmit: () => Boolean(customId && type === "modal"), isUserSelectMenu: () => Boolean(customId && type === "select"),
      values: value ? [value] : [], users: new Map([["bob", { id: "bob", bot: false }], ["bot", { id: "bot", bot: true }]]),
      fields: { getTextInputValue: () => text },
      async reply(body) { validate(body); ui.reply = body; if (body.embeds) ui.body = body; },
      async deferUpdate() { this.deferred = true; },
      async editReply(body) { validate(body); ui.body = body; },
      async followUp(body) { ui.followups.push(body); },
      async showModal(modal) { ui.modal = modal.toJSON(); }, ...overrides };
    assert.equal(await handler(event), true);
    return event;
  };
  ui.controls = () => ui.body.components.flatMap(row => row.toJSON().components);
  ui.find = action => ui.controls().find(component => component.custom_id?.endsWith(`:${action}`));
  ui.click = async (action, options) => {
    const control = ui.find(action); assert.ok(control, `Missing ${action}`);
    return ui.invoke(control.custom_id, options);
  };
  ui.submit = text => ui.invoke(ui.modal.custom_id, { type: "modal", text });
  ui.description = () => ui.body.embeds[0].toJSON().description;
  return ui;
} // Replace only Discord transport; buttons, selections and modals pass through the production handler.

function fixture(options = {}) {
  let now = 1000;
  const calls = [];
  const menus = new IdentityMenus({ now: () => now,
    accountAction: async (interaction, action, inputs) => { calls.push({ action, user: interaction.user.id, code: action === "confirm" ? inputs.getString("code") : null }); return { content: `Account ${action} completed` }; },
    walletAction: async (interaction, action, inputs) => { calls.push({ action, user: interaction.user.id,
      target: inputs?.getUser?.(), asset: inputs?.getString?.(), amount: inputs?.getInteger?.() }); return { content: `Wallet ${action} completed` }; },
    atelier: user => `Private atelier for ${user}`,
    trader: async () => ({ content: "Trader menu" }), ...options });
  const ui = driver(interaction => menus.handleInteraction(interaction));
  return { menus, calls, ui, advance: amount => { now += amount; } };
}

test("account menu aliases show private pastel controls and hide administrator gifts from ordinary users", async () => {
  const { menus, ui } = fixture();
  await ui.invoke();
  assert.equal(ui.reply.flags, 64); assert.equal(ui.body.embeds[0].toJSON().color, 0xd58cdb);
  for (const action of ["login", "code", "status", "balance", "retry", "disconnect", "unlink", "trader", "atelier", "gift-coins", "gift-stars", "gift-retry"]) assert.ok(ui.find(action));
  for (const group of [null, "wallet"]) {
    const ordinary = driver(event => menus.handleInteraction(event), { admin: false, command: "lidollid", group });
    await ordinary.invoke();
    assert.ok(ordinary.find("balance")); assert.equal(ordinary.find("gift-coins"), undefined);
  }
  const command = buildIdentityCommand().toJSON();
  assert.ok(command.options.some(option => option.name === "menu"));
  assert.ok(command.options.find(option => option.name === "wallet").options.some(option => option.name === "menu"));
});

test("coin leaderboard opens directly from every account menu alias within Discord component limits", async () => {
  const { menus } = fixture({ leaderboardUrl: "https://bot.example/leaderboard/", hangman: () => "Hangman" });
  for (const admin of [false, true]) for (const command of ["menu", "lidollid"]) for (const group of [null, "wallet"]) {
    const ui = driver(event => menus.handleInteraction(event), { admin, command, group });
    await ui.invoke();
    const link = ui.controls().find(component => component.label === "Coin leaderboard");
    assert.equal(link.style, 5); assert.equal(link.url, "https://bot.example/leaderboard/");
    assert.equal(link.custom_id, undefined); assert.equal(ui.reply.flags, 64);
    assert.ok(ui.find("hangman")); assert.ok(ui.find("balance"));
  }
});

test("both gift currencies require a recipient, amount modal and final review before payment", async () => {
  const { ui, calls } = fixture();
  await ui.invoke();
  for (const asset of ["coins", "stars"]) {
    await ui.click(`gift-${asset}`);
    await ui.click("recipient", { type: "select", value: "bob" });
    await ui.click("amount"); await ui.submit("25");
    assert.match(ui.description(), /Review your gift/); assert.match(ui.description(), /<@bob>/);
    assert.equal(calls.filter(call => call.action === "gift").length, asset === "coins" ? 0 : 1);
    const send = ui.find("send-gift").custom_id;
    await ui.click("send-gift");
    await ui.invoke(send); // A duplicate event must not issue another gift.
    assert.match(ui.reply.content, /already changed/);
  }
  assert.deepEqual(calls.map(call => [call.action, call.target.id, call.asset, call.amount]), [["gift", "bob", "coins", 25], ["gift", "bob", "stars", 25]]);
});

test("ordinary players review sender-funded coins or diamonds, cancel safely and cannot send stars or admin gifts", async () => {
  const { ui, calls } = fixture(); ui.admin = false;
  await ui.invoke();
  assert.equal(ui.find("send-stars"), undefined);
  assert.equal(ui.find("gift-coins"), undefined);
  for (const asset of ["coins", "diamonds"]) {
    await ui.click(`send-${asset}`);
    assert.match(ui.description(), /your own balance/);
    await ui.click("recipient", { type: "select", value: "bot" });
    assert.match(ui.description(), /Choose a person/);
    await ui.click("recipient", { type: "select", value: "bob" });
    await ui.click("amount"); await ui.submit("15");
    assert.match(ui.description(), /deducted from your wallet/);
    const send = ui.find("send-transfer").custom_id;
    await ui.invoke(send.replace(/send-transfer$/, "send-gift"));
    assert.match(ui.reply.content, /Manage Server/);
    await ui.click("send-transfer"); await ui.invoke(send);
    assert.match(ui.reply.content, /already changed/);
  }
  assert.deepEqual(calls.map(call => [call.action, call.user, call.target.id, call.asset, call.amount]), [
    ["send", "alice", "bob", "coins", 15], ["send", "alice", "bob", "diamonds", 15],
  ]);
  await ui.click("send-coins"); await ui.click("recipient", { type: "select", value: "bob" });
  await ui.click("amount"); await ui.submit("5"); await ui.click("home");
  assert.equal(calls.length, 2);
});

test("forged, foreign, expired and role-revoked controls cannot gift currency", async () => {
  const { ui, calls, advance } = fixture();
  await ui.invoke();
  const gift = ui.find("gift-coins").custom_id;
  await ui.invoke(gift, { user: { id: "mallory" } }); assert.match(ui.reply.content, /own/);
  await ui.invoke(gift, { guildId: "other" }); assert.match(ui.reply.content, /own/);
  ui.admin = false; await ui.invoke(gift); assert.match(ui.reply.content, /Manage Server/);
  ui.admin = true;
  await ui.click("gift-coins"); await ui.click("recipient", { type: "select", value: "bob" });
  await ui.click("amount"); await ui.submit("12");
  ui.admin = false; await ui.click("send-gift"); assert.match(ui.reply.content, /Manage Server/);
  await ui.click("home"); // A review exposes Cancel under the home action, even after administrator access is removed.
  ui.admin = true; advance(300001);
  await ui.invoke(gift); assert.match(ui.reply.content, /expired/);
  assert.equal(calls.length, 0);
});

test("gift forms reject bots and invalid amounts, and cancel never creates a reward", async () => {
  const { ui, calls } = fixture(); await ui.invoke(); await ui.click("gift-stars");
  await ui.click("recipient", { type: "select", value: "bot" });
  assert.match(ui.description(), /Choose a person/);
  await ui.click("recipient", { type: "select", value: "bob" });
  for (const amount of ["0", "-2", "1.5", "1e3", "1000001"]) {
    await ui.click("amount"); await ui.submit(amount);
    assert.match(ui.description(), /whole-number/);
  }
  await ui.click("amount"); await ui.submit("1"); await ui.click("home");
  assert.equal(calls.length, 0); assert.ok(ui.find("gift-stars"));
});

test("account buttons, code confirmation and removal confirmations use shared actions", async () => {
  const { ui, calls } = fixture(); await ui.invoke();
  for (const action of ["login", "status", "balance", "retry"]) await ui.click(action);
  await ui.click("code"); const form = ui.modal.custom_id;
  await ui.submit("c".repeat(32)); await ui.invoke(form, { type: "modal", text: "c".repeat(32) });
  assert.match(ui.reply.content, /already changed/);
  for (const action of ["disconnect", "unlink"]) {
    await ui.click(action); assert.equal(calls.some(call => call.action === action), false);
    await ui.click("home"); await ui.click(action); await ui.click(`confirm-${action}`);
  }
  assert.deepEqual(calls.map(call => call.action), ["login", "status", "balance", "retry", "confirm", "disconnect", "unlink"]);
  assert.equal(calls.find(call => call.action === "confirm").code, "c".repeat(32));
});

test("gift recovery, atelier links and trader handoff stay private and preserve the main menu", async () => {
  const { ui, calls } = fixture(); await ui.invoke();
  await ui.click("gift-retry"); await ui.click("recipient", { type: "select", value: "bob" });
  assert.deepEqual([calls[0].action, calls[0].target.id], ["gift-retry", "bob"]);
  await ui.click("atelier"); assert.match(ui.description(), /Private atelier for alice/);
  await ui.click("trader"); assert.equal(ui.followups[0].flags, 64); assert.ok(ui.find("balance"));
});

test("concurrent menu clicks cannot repeat an in-flight wallet action or leak raw failures", async () => {
  let release, started; const ready = new Promise(resolve => { started = resolve; }); let calls = 0;
  const { ui } = fixture({ walletAction: async () => { calls++; started(); await new Promise(resolve => { release = resolve; }); throw new Error("PRIVATE TOKEN"); } });
  await ui.invoke(); const id = ui.find("balance").custom_id;
  const pending = ui.invoke(id); await ready;
  await ui.invoke(id); assert.match(ui.reply.content, /already changed/);
  release(); await pending;
  assert.equal(calls, 1); assert.doesNotMatch(ui.description(), /PRIVATE TOKEN/);
  assert.ok(ui.find("balance"));
});

test("the menu integrates real identity unlink and durable wallet gifts through the production dispatcher", async t => {
  const store = new IdentityStore(":memory:"); const payments = [];
  const wallet = new WalletService(":memory:", { config: { baseUrl: "https://wallet.example/", clientId: "lidollbot" },
    operation: async (token, body) => { assert.equal(token, "bob-token"); payments.push(body); return { ...body, currency: "Stars", balance: 7 }; }, revoke: async () => {} });
  t.after(async () => { await wallet.close(); store.close(); });
  for (const user of ["alice", "bob"]) store.db.prepare("INSERT INTO identity_links VALUES (?,?,?,?,?)").run(user, "issuer", user, user, Date.now());
  wallet.db.prepare("INSERT INTO online_wallets VALUES (?,?,?,?,?,?)").run("bob", "bob-token", Date.now() + 60000, "bob-account", "https://wallet.example/", "lidollbot");
  const handler = createIdentityHandler(store, { origin: "https://bot.example" }, wallet);
  const ui = driver(handler); await ui.invoke();
  await ui.click("gift-stars"); await ui.click("recipient", { type: "select", value: "bob" });
  await ui.click("amount"); await ui.submit("7"); await ui.click("send-gift");
  assert.equal(payments.length, 1); assert.equal(payments[0].asset, "stars");
  assert.equal(wallet.db.prepare("SELECT state FROM wallet_gifts").get().state, "done");
  await ui.click("unlink"); await ui.click("confirm-unlink"); assert.equal(store.get("alice"), undefined);
  assert.ok(store.get("bob"));
});

test("the trader hub entry respects the dedicated channel and opens the existing trader controls", t => {
  const store = new TouhouStore(":memory:", [{ name: "Reimu", filename: "Reimu.png", baseRarity: 0 }]);
  t.after(() => store.close());
  const trader = createTouhouHandlers(store, { channelId: "trader-channel" });
  assert.throws(() => trader.openMenu({ guildId: "guild", channelId: "other", user: { id: "alice" } }), /trader-channel/);
  const body = trader.openMenu({ guildId: "guild", channelId: "trader-channel", user: { id: "alice" } });
  assert.equal(body.embeds[0].toJSON().title, "Touhou Trader");
});
