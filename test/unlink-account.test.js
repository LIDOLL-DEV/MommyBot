import assert from "node:assert/strict";
import test from "node:test";
import { IdentityStore } from "../src/auth/store.js";
import { WalletService } from "../src/wallet/service.js";
import { WalletError } from "../src/wallet/client.js";
import { buildIdentityCommand, createIdentityHandler } from "../src/auth/index.js";

function fixture(t, online = true) {
  const identities = new IdentityStore(":memory:"), revoked = [];
  const client = { config: { baseUrl: "https://wallet.example/api/", clientId: "lidollbot" },
    revoke: async token => revoked.push(token) };
  const wallet = online ? new WalletService(":memory:", client) : null;
  t.after(async () => { await wallet?.close(); identities.close(); });
  const handler = createIdentityHandler(identities, { origin: "https://bot.example" }, wallet);
  function stage(user) {
    const ticket = identities.begin(user, true);
    const browser = identities.start(ticket, { verifier: "v", state: "s", nonce: "n" });
    return identities.verified(identities.take(browser), { issuer: "https://auth.example", subject: user, username: user });
  }
  function link(user) {
    identities.confirm(user, stage(user));
    wallet?.db.prepare("INSERT INTO online_wallets VALUES (?,?,?,?,?,?)").run(user, `grant-${user}`,
      Date.now() + 3600000, `wallet-${user}`, client.config.baseUrl, client.config.clientId);
  }
  async function invoke(action, user = "alice", customId = null) {
    const interaction = { user: { id: user }, commandName: "lidollid", customId,
      isButton: () => Boolean(customId), isChatInputCommand: () => !customId,
      options: { getSubcommand: () => action },
      deferReply: async options => assert.equal(options.flags, 64),
      editReply: async body => { interaction.output = body; } };
    assert.equal(await handler(interaction), true);
    assert.deepEqual(interaction.output.allowedMentions, { parse: [] });
    return interaction.output;
  }
  return { identities, wallet, client, revoked, stage, link, invoke };
} // Exercise the real identity and wallet stores with private Discord interactions and a fake revocation endpoint.

test("status exposes a private owner-bound unlink button, including for unfinished sign-ins", async t => {
  const f = fixture(t);
  const button = response => response.components[0].toJSON().components[0];
  assert.equal(button(await f.invoke("status")).custom_id, "lidollid:unlink:alice");
  f.link("alice");
  assert.equal(button(await f.invoke("status")).label, "Unlink account");
  assert.ok(buildIdentityCommand().toJSON().options.some(option => option.name === "unlink"));
});

test("unlink button revokes the wallet and invalidates old confirmations, allowing a fresh link", async t => {
  const f = fixture(t); f.link("alice"); f.link("bob");
  const oldCode = f.stage("alice");
  const response = await f.invoke(null, "alice", "lidollid:unlink:alice");
  assert.deepEqual(f.revoked, ["grant-alice"]);
  assert.equal(f.identities.get("alice"), undefined);
  assert.equal(f.wallet.connection("alice"), undefined);
  assert.throws(() => f.identities.confirm("alice", oldCode), /Invalid or expired/);
  assert.ok(f.identities.get("bob")); assert.ok(f.wallet.connection("bob"));
  assert.match(response.content, /awarded Discord role stay/);
  assert.match(response.content, /\/lidollid login/);
  f.identities.confirm("alice", f.stage("alice"));
  assert.equal(f.identities.get("alice").subject, "alice");
});

test("another user cannot use an account's unlink button", async t => {
  const f = fixture(t); f.link("alice"); f.link("bob");
  const response = await f.invoke(null, "bob", "lidollid:unlink:alice");
  assert.match(response.content, /your own account/);
  assert.ok(f.identities.get("alice")); assert.ok(f.identities.get("bob"));
  assert.deepEqual(f.revoked, []);
});

test("pending trader payments block both command and button unlink without losing recovery access", async t => {
  const f = fixture(t); f.link("alice"); f.wallet.hasPending = () => true;
  for (const customId of [null, "lidollid:unlink:alice"]) {
    const response = await f.invoke("unlink", "alice", customId);
    assert.match(response.content, /\/lidollid wallet retry/);
    assert.ok(f.identities.get("alice")); assert.ok(f.wallet.connection("alice"));
  }
  assert.deepEqual(f.revoked, []);
});

test("failed revocation preserves the link and wallet until unlink can be retried", async t => {
  const f = fixture(t); f.link("alice");
  f.client.revoke = async () => { throw new WalletError("NETWORK_ERROR", "Wallet unavailable; try again."); };
  assert.match((await f.invoke("unlink")).content, /Wallet unavailable/);
  assert.ok(f.identities.get("alice")); assert.ok(f.wallet.connection("alice"));
  f.client.revoke = async token => f.revoked.push(token);
  await f.invoke("unlink");
  assert.equal(f.identities.get("alice"), undefined); assert.deepEqual(f.revoked, ["grant-alice"]);
});

test("identity-only unlink cancels pending tickets and is safe to repeat before a new login", async t => {
  const f = fixture(t, false), ticket = f.identities.begin("alice");
  await f.invoke(null, "alice", "lidollid:unlink:alice");
  assert.equal(f.identities.hasTicket(ticket), false);
  await f.invoke("unlink");
  assert.match((await f.invoke("login")).content, /auth\/login\?ticket=/);
});
