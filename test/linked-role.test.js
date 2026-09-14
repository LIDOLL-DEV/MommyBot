import assert from "node:assert/strict";
import test from "node:test";
import { IdentityStore } from "../src/auth/store.js";
import { createIdentityHandler } from "../src/auth/index.js";
import { authConfig } from "../src/auth/config.js";
import { DEFAULT_LINKED_ROLE_ID } from "../src/auth/linkedRole.js";

function setup(t) {
  const store = new IdentityStore(":memory:");
  t.after(() => store.close());
  const calls = [], held = new Map([["other-role", {}]]);
  const fixture = { store, calls, held, failure: null };
  const role = { id: DEFAULT_LINKED_ROLE_ID, managed: false };
  fixture.guild = { id: "guild", roles: { cache: new Map([[role.id, role]]), fetch: async id => id === role.id ? role : null },
    members: { fetch: async options => {
      assert.deepEqual(options, { user: "alice", force: true });
      if (fixture.memberFailure) throw fixture.memberFailure;
      return { roles: { cache: held, add: async (id, reason) => {
        assert.ok(store.get("alice"), "Role must be granted only after the identity is committed");
        if (fixture.failure) throw fixture.failure;
        calls.push({ id, reason }); held.set(id, role);
      } } };
    } } };
  fixture.handler = createIdentityHandler(store, { origin: "https://bot.example" });
  fixture.stage = () => {
    const ticket = store.begin("alice"), browser = store.start(ticket, { verifier: "v", state: "s", nonce: "n" });
    return store.verified(store.take(browser), { issuer: "https://auth.example", subject: "subject-alice", username: "Alice" });
  };
  fixture.invoke = async (action, code, overrides = {}) => {
    const interaction = { user: { id: "alice" }, guild: fixture.guild, commandName: "lidollid", isChatInputCommand: () => true,
      options: { getSubcommand: () => action, getString: () => code },
      async deferReply(options) { assert.equal(options.flags, 64); }, async editReply(body) { this.output = body; }, ...overrides };
    await fixture.handler(interaction);
    return interaction.output;
  };
  return fixture;
} // Exercise the actual confirmation handler and identity database with a disposable Discord role transport.

test("successful confirmation awards the exact linked role and preserves existing roles", async t => {
  const f = setup(t), response = await f.invoke("confirm", f.stage());
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].id, "1548848979754614857");
  assert.ok(f.held.has("other-role")); assert.match(response.content, /has been added/);
  assert.deepEqual(response.allowedMentions, { parse: [] });
  await f.invoke("status"); assert.equal(f.calls.length, 1);
});

test("starting login, unlinked status and failed confirmations never grant the role", async t => {
  const f = setup(t);
  await f.invoke("status"); await f.invoke("login"); await f.invoke("confirm", "invalid-code");
  const code = f.stage();
  await f.invoke("confirm", code, { user: { id: "mallory" } });
  assert.equal(f.calls.length, 0); assert.equal(f.store.get("alice"), undefined);
});

test("a permission failure preserves the link and status can retry role delivery", async t => {
  const f = setup(t), logs = [];
  t.mock.method(console, "warn", value => logs.push(value));
  f.failure = Object.assign(new Error("PRIVATE DISCORD RESPONSE"), { code: 50013 });
  const response = await f.invoke("confirm", f.stage());
  assert.ok(f.store.get("alice")); assert.match(response.content, /Manage Roles/);
  assert.doesNotMatch(response.content + logs.join(" "), /PRIVATE/);
  f.failure = null;
  const retry = await f.invoke("status"); assert.match(retry.content, /has been added/);
  assert.equal(f.calls.length, 1);
});

test("already-linked members receive the role through status, including a DM confirmation", async t => {
  const f = setup(t);
  const result = await f.invoke("confirm", f.stage(), { guild: null, client: { guilds: { cache: new Map([[f.guild.id, f.guild]]) } } });
  assert.match(result.content, /has been added/);
  f.held.delete(DEFAULT_LINKED_ROLE_ID);
  await f.invoke("status"); assert.equal(f.calls.length, 2);
});

test("missing roles and nonmembers get a recovery instruction without breaking the identity link", async t => {
  const f = setup(t); f.guild.roles.fetch = async () => null;
  const result = await f.invoke("confirm", f.stage());
  assert.ok(f.store.get("alice")); assert.match(result.content, /configured role/);
  assert.equal(f.calls.length, 0);
  f.guild.roles.fetch = async () => ({ id: DEFAULT_LINKED_ROLE_ID });
  f.memberFailure = Object.assign(new Error("Unknown member"), { code: 10007 });
  const status = await f.invoke("status"); assert.match(status.content, /Join the server/);
  assert.equal(f.calls.length, 0);
});

test("role configuration defaults to Doll's selected role and rejects invalid IDs", () => {
  const env = { LIDOLLID_ENABLED: "true", LIDOLLID_PUBLIC_ORIGIN: "https://bot.example", LIDOLLID_ISSUER: "https://auth.example" };
  assert.equal(authConfig(env).linkedRoleId, DEFAULT_LINKED_ROLE_ID);
  assert.equal(authConfig({ ...env, LIDOLLID_LINKED_ROLE_ID: "1548848979754614858" }).linkedRoleId, "1548848979754614858");
  assert.throws(() => authConfig({ ...env, LIDOLLID_LINKED_ROLE_ID: "@everyone" }), /Discord role ID/);
});
