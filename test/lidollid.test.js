import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IdentityStore } from "../src/auth/store.js";
import { authConfig } from "../src/auth/config.js";
import { createOidc } from "../src/auth/oidc.js";
import { createAuthServer } from "../src/auth/server.js";
import { authDiagnostic, authStep } from "../src/auth/diagnostics.js";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildIdentityCommand, createIdentityHandler } from "../src/auth/index.js";

const identity = { issuer: "https://auth.example", subject: "stable-account", username: "Doll" };
const values = { verifier: "verifier", state: "state", nonce: "nonce" };
function stage(store, user, account = identity) {
  const ticket = store.begin(user);
  const browser = store.start(ticket, values);
  return store.verified(store.take(browser), account);
} // Exercise the actual staged link lifecycle instead of inserting links directly in tests.

test("identity links persist, require the initiating Discord user, and enforce uniqueness", () => {
  const directory = mkdtempSync(join(tmpdir(), "lidollid-"));
  let store;
  try {
    store = new IdentityStore(join(directory, "identity.db"));
    const code = stage(store, "alice");
    assert.equal(store.get("alice"), undefined);
    assert.throws(() => store.confirm("bob", code), /Invalid/);
    assert.equal(store.confirm("alice", code).subject, identity.subject);
    assert.throws(() => store.confirm("alice", code), /Invalid/);
    assert.throws(() => store.begin("alice"), /Already linked/);
    assert.throws(() => store.confirm("bob", stage(store, "bob")), /another Discord/);
    store.close();
    store = new IdentityStore(join(directory, "identity.db"));
    assert.equal(store.get("alice").issuer, identity.issuer);
    store.unlink("alice");
    assert.equal(store.get("alice"), undefined);
    assert.equal(store.confirm("bob", stage(store, "bob")).username, "Doll");
    const otherIssuer = { ...identity, issuer: "https://other.example" };
    assert.equal(store.confirm("alice", stage(store, "alice", otherIssuer)).issuer, otherIssuer.issuer);
  } finally { store?.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("tickets, browser callbacks, replacement, unlink and expiry cannot revive stale links", () => {
  let now = 1000;
  const store = new IdentityStore(":memory:", () => now);
  try {
    const ticket = store.begin("alice");
    const browser = store.start(ticket, values);
    assert.throws(() => store.start(ticket, values), /already used/);
    assert.equal(store.take("foreign-cookie"), undefined);
    const attempt = store.take(browser);
    assert.equal(store.take(browser), undefined);
    // Two attempts at the same timestamp must still have distinct generations.
    const newer = store.start(store.begin("alice"), values);
    store.take(newer);
    assert.throws(() => store.verified(attempt, identity), /replaced/);
    const pending = store.take(store.start(store.begin("alice"), values));
    store.unlink("alice");
    assert.throws(() => store.verified(pending, identity), /replaced/);
    const code = stage(store, "alice");
    now += 600001;
    assert.throws(() => store.confirm("alice", code), /Invalid/);
    const expiredTicket = store.begin("alice");
    now += 600001;
    assert.equal(store.hasTicket(expiredTicket), false);
    assert.throws(() => store.start(expiredTicket, values), /expired/);
  } finally { store.close(); }
});

test("SSO configuration is opt-in with exact origins and production HTTPS", () => {
  assert.equal(authConfig({}), null);
  const env = { LIDOLLID_ENABLED: "true", LIDOLLID_PUBLIC_ORIGIN: "https://bot.example" };
  assert.equal(authConfig(env).callback, "https://bot.example/auth/callback");
  assert.equal(authConfig(env).clientId, "lidollbot");
  for (const origin of ["http://bot.example", "https://bot.example/path", "https://user:secret@bot.example", "https://bot.example?x=1"]) {
    assert.throws(() => authConfig({ ...env, LIDOLLID_PUBLIC_ORIGIN: origin }));
  }
  assert.throws(() => authConfig({ ...env, LIDOLLID_PORT: "bad" }));
  for (const hostname of ["auth.lidoll.dev", "auth.sadgirlsclub.wtf"]) {
    assert.throws(() => authConfig({ ...env,
      LIDOLLID_PUBLIC_ORIGIN: `https://${hostname}:443/`,
      LIDOLLID_ISSUER: `https://${hostname}`,
    }), /LiDollBot's own web origin/);
  } // Normalize default ports and slashes when rejecting the routing mistake reported from Discord.
  const local = { ...env, LIDOLLID_PUBLIC_ORIGIN: "http://127.0.0.1:4190", LIDOLLID_ISSUER: "http://127.0.0.1:4180" };
  assert.equal(authConfig(local).port, 4190);
  assert.throws(() => authConfig({ ...local, NODE_ENV: "production" }));
});

async function listen(server) {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
} // Bind disposable loopback ports; tests never contact live LiD0llID or Discord.
async function close(server) {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}

async function loginForm(address, ticket) {
  const response = await fetch(`${address}/auth/login?ticket=${ticket}`, { redirect: "manual" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("referrer-policy"), "origin", "Browser form POST must retain Origin without exposing ticket in Referer");
  const html = await response.text();
  assert.match(html, /Continue with LiD0llID/);
  return { cookie: response.headers.getSetCookie()[0].split(";")[0],
    body: new URLSearchParams({ ticket, csrf: html.match(/name="csrf" value="([\w-]+)"/)[1] }) };
} // Open the actual browser landing page without starting authorization.

async function submitLogin(address, form, origin = address) {
  return fetch(`${address}/auth/login`, { method: "POST", redirect: "manual",
    headers: { origin, cookie: form.cookie }, body: form.body });
} // Simulate the explicit browser form submission, including its cookie and Origin.

async function startLogin(address, ticket, origin = address) {
  return submitLogin(address, await loginForm(address, ticket), origin);
}

async function providerFixture() {
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const foreignKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...keys.publicKey.export({ format: "jwk" }), kid: "test", use: "sig", alg: "RS256" };
  let origin, authorization, mode = "valid", discoveries = 0;
  const server = createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");
    const send = body => response.end(JSON.stringify(body));
    if (request.url === "/.well-known/openid-configuration") {
      discoveries++;
      if (mode === "offline") { response.statusCode = 503; return send({ error: "unavailable" }); }
      return send({ issuer: mode === "discovery-issuer" ? "https://wrong-issuer.example" : origin, authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token`,
        userinfo_endpoint: `${origin}/userinfo`, jwks_uri: `${origin}/jwks`, response_types_supported: ["code"],
        subject_types_supported: ["public"], id_token_signing_alg_values_supported: ["RS256"],
        token_endpoint_auth_methods_supported: ["none"], code_challenge_methods_supported: ["S256"] });
    }
    if (request.url === "/jwks") return send({ keys: [jwk] });
    if (request.url === "/userinfo") return send({ sub: mode === "userinfo" ? "wrong-user" : "stable-account", preferred_username: "<Doll>" });
    if (request.url === "/token") {
      let body = "";
      for await (const chunk of request) body += chunk;
      const data = new URLSearchParams(body);
      const challenge = createHash("sha256").update(data.get("code_verifier") || "").digest("base64url");
      if (challenge !== authorization.get("code_challenge") || data.get("redirect_uri") !== authorization.get("redirect_uri") || data.get("client_id") !== "lidollbot") {
        response.statusCode = 400; return send({ error: "invalid_grant" });
      }
      const claims = { iss: mode === "issuer" ? "https://foreign.example" : origin,
        sub: "stable-account", aud: mode === "audience" ? "wrong-client" : "lidollbot",
        nonce: mode === "nonce" ? "wrong-nonce" : authorization.get("nonce"),
        iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + (mode === "expired" ? -3600 : 300) };
      const encoded = object => Buffer.from(JSON.stringify(object)).toString("base64url");
      const input = `${encoded({ alg: "RS256", kid: "test" })}.${encoded(claims)}`;
      const signature = sign("RSA-SHA256", Buffer.from(input), mode === "signature" ? foreignKeys.privateKey : keys.privateKey).toString("base64url");
      return send({ access_token: "test-token", token_type: "Bearer", expires_in: 300,
        ...(mode === "missing-token" ? {} : { id_token: `${input}.${signature}` }) });
    }
    response.statusCode = 404; send({});
  });
  origin = await listen(server);
  return { origin, server, setMode: value => { mode = value; }, setAuthorization: url => { authorization = new URL(url).searchParams; }, discoveries: () => discoveries };
} // A real HTTP OIDC fixture signs ID tokens so the production library's validation runs in tests.

test("OIDC validates real signed responses and rejects state, nonce, signature, issuer, audience, expiry, PKCE and UserInfo mismatch", async () => {
  const fixture = await providerFixture();
  const oidc = createOidc({ issuer: fixture.origin, clientId: "lidollbot", callback: "http://127.0.0.1:4190/auth/callback" });
  try {
    fixture.setMode("offline");
    await assert.rejects(oidc.begin(), error => authDiagnostic(error).stage === "discovery");
    for (const mode of ["valid", "state", "nonce", "signature", "issuer", "audience", "expired", "pkce", "userinfo", "missing-token", "denied"]) {
      fixture.setMode(mode);
      const start = await oidc.begin();
      fixture.setAuthorization(start.url);
      const authorization = new URL(start.url);
      assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
      assert.equal(authorization.searchParams.get("scope"), "openid profile");
      const callback = new URL("http://127.0.0.1:4190/auth/callback");
      callback.searchParams.set(mode === "denied" ? "error" : "code", mode === "denied" ? "access_denied" : "test-code");
      callback.searchParams.set("state", mode === "state" ? "foreign" : start.values.state);
      if (mode === "pkce") start.values.verifier = "invalid-verifier";
      if (mode === "valid") assert.equal((await oidc.finish(callback, start.values)).subject, "stable-account");
      else await assert.rejects(oidc.finish(callback, start.values), error => authDiagnostic(error).stage === (mode === "userinfo" ? "userinfo" : "token"), `Must reject ${mode}`);
    }
    assert.equal(fixture.discoveries(), 2, "Failed discovery retries; successful discovery is cached");
  } finally { await close(fixture.server); }
});

test("browser handoff binds cookies, escapes profiles, consumes callbacks and waits for Discord confirmation", async () => {
  const fixture = await providerFixture();
  const store = new IdentityStore(":memory:");
  const config = { issuer: fixture.origin, clientId: "lidollbot" };
  // Both objects retain this config reference until their ephemeral callback origin is known.
  config.origin = "http://127.0.0.1";
  const server = createAuthServer(config, store, createOidc(config));
  config.origin = await listen(server);
  config.callback = `${config.origin}/auth/callback`;
  try {
    const ticket = store.begin("alice");
    const start = await startLogin(config.origin, ticket);
    assert.equal(start.status, 303);
    const cookie = start.headers.getSetCookie()[0];
    assert.match(cookie, /HttpOnly; SameSite=Lax/);
    assert.equal(start.headers.get("referrer-policy"), "no-referrer");
    fixture.setAuthorization(start.headers.get("location"));
    const state = new URL(start.headers.get("location")).searchParams.get("state");
    const url = `${config.callback}?code=test-code&state=${state}`;
    assert.equal((await fetch(url)).status, 400);
    const callback = await fetch(url, { headers: { cookie: cookie.split(";")[0] } });
    assert.equal(callback.status, 200);
    const html = await callback.text();
    assert.match(html, /&lt;Doll&gt;/);
    assert.equal(store.get("alice"), undefined);
    assert.equal(callback.headers.get("cache-control"), "no-store");
    assert.match(callback.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    const code = html.match(/confirm code:([a-f0-9]{32})/)[1];
    assert.throws(() => store.confirm("mallory", code), /Invalid/);
    store.confirm("alice", code);
    assert.equal((await fetch(url, { headers: { cookie: cookie.split(";")[0] } })).status, 400);
    assert.equal((await fetch(`${config.origin}/auth/login?ticket=${ticket}`)).status, 400);
    assert.equal((await fetch(`${config.origin}/auth/callback`, { method: "POST" })).status, 405);
  } finally { await close(server); store.close(); await close(fixture.server); }
});

test("Discord account commands are private, use authenticated user ID, and do not consume trader interactions", async () => {
  const store = new IdentityStore(":memory:");
  const handler = createIdentityHandler(store, { origin: "https://bot.example" });
  const replies = [];
  const interaction = { user: { id: "alice" }, commandName: "lidollid", isChatInputCommand: () => true,
    options: { getSubcommand: () => "login" }, deferReply: async options => { assert.equal(options.flags, 64); },
    editReply: async options => { replies.push(options); } };
  try {
    assert.equal(buildIdentityCommand().toJSON().options.length, 5);
    assert.equal(await handler({ ...interaction, commandName: "touhou" }), false);
    assert.equal(await handler(interaction), true);
    assert.match(replies.at(-1).content, /https:\/\/bot.example\/auth\/login\?ticket=/);
    const code = stage(store, "alice");
    interaction.options = { getSubcommand: () => "confirm", getString: () => code };
    await handler(interaction);
    assert.equal(store.get("alice").subject, identity.subject);
    interaction.options = { getSubcommand: () => "status" };
    await handler(interaction);
    assert.match(replies.at(-1).content, /Doll/);
    assert.deepEqual(replies.at(-1).allowedMentions, { parse: [] });
    interaction.options = { getSubcommand: () => "unlink" };
    await handler(interaction);
    assert.equal(store.get("alice"), undefined);
  } finally { store.close(); }
});

test("HTTPS cookies are host-only and failed callbacks consume credentials without exposing errors", async () => {
  const store = new IdentityStore(":memory:");
  const config = { origin: "https://bot.example" };
  let callbacks = 0;
  const server = createAuthServer(config, store, {
    begin: async () => ({ url: "https://auth.example/authorize", values }),
    finish: async () => { callbacks++; throw new Error("private-provider-response"); },
  });
  const address = await listen(server);
  try {
    const response = await startLogin(address, store.begin("alice"), config.origin);
    const cookie = response.headers.getSetCookie()[0];
    assert.match(cookie, /^__Host-lidollbot_login=/);
    assert.match(cookie, /Path=\/; HttpOnly; SameSite=Lax; Max-Age=600; Secure$/);
    assert.doesNotMatch(cookie, /Domain=/i);
    const options = { headers: { cookie: cookie.split(";")[0] } };
    const failed = await fetch(`${address}/auth/callback?code=secret`, options);
    assert.equal(failed.status, 503);
    const html = await failed.text();
    assert.doesNotMatch(html, /private-provider-response|secret/);
    assert.match(html, /callback: SIGN_IN_FAILED/);
    assert.match(failed.headers.get("set-cookie"), /Max-Age=0; Secure$/);
    assert.equal((await fetch(`${address}/auth/callback?code=secret`, options)).status, 400);
    assert.equal(callbacks, 1);
    assert.equal(store.get("alice"), undefined);
  } finally { await close(server); store.close(); }
});

test("auth diagnostics identify nested transport failures while excluding arbitrary error data", async () => {
  const error = new Error("https://private.example/?code=secret", { cause: new Error("private-response") });
  error.cause.code = "ENOTFOUND";
  error.cause.response = { status: 503, body: "private-body" };
  await assert.rejects(authStep("authorization", () => authStep("discovery", () => { throw error; })), failure => {
    assert.deepEqual(authDiagnostic(failure), { stage: "discovery", code: "ENOTFOUND", status: 503 });
    return true;
  });
  const unknown = { code: "PRIVATE_TOKEN", error: "PRIVATE_RESPONSE", stage: "PRIVATE_STAGE", message: "PRIVATE_MESSAGE" };
  unknown.cause = unknown;
  assert.deepEqual(authDiagnostic(unknown, "PRIVATE_FALLBACK"), { stage: "login", code: "SIGN_IN_FAILED" });
});

test("discovery issuer mismatch produces a useful browser reference without consuming the ticket", async () => {
  const fixture = await providerFixture();
  const store = new IdentityStore(":memory:");
  const config = { origin: "http://127.0.0.1", issuer: fixture.origin, clientId: "lidollbot" };
  const server = createAuthServer(config, store, createOidc(config));
  config.origin = await listen(server);
  config.callback = `${config.origin}/auth/callback`;
  try {
    fixture.setMode("discovery-issuer");
    const ticket = store.begin("alice");
    const failed = await startLogin(config.origin, ticket);
    assert.equal(failed.status, 503);
    const html = await failed.text();
    assert.match(html, /discovery: ISSUER_MISMATCH/);
    assert.ok(!html.includes(ticket));
    assert.ok(!html.includes("wrong-issuer.example"));
    assert.equal(store.hasTicket(ticket), true);
    fixture.setMode("valid");
    assert.equal((await startLogin(config.origin, ticket)).status, 303);
  } finally { await close(server); store.close(); await close(fixture.server); }
});

test("read-only SSO checker tests discovery without printing credentials or starting authentication", async () => {
  const fixture = await providerFixture();
  const directory = mkdtempSync(join(tmpdir(), "lidollid-check-"));
  const file = join(directory, "settings.env");
  const run = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL("../scripts/check-lidollid.mjs", import.meta.url)), file], { env: { ...process.env, NODE_ENV: "test" }, windowsHide: true });
    let output = "";
    child.stdout.on("data", data => { output += data; });
    child.stderr.on("data", data => { output += data; });
    child.on("error", reject);
    child.on("close", code => resolve({ code, output }));
  });
  try {
    writeFileSync(file, `LIDOLLID_ENABLED=true\nLIDOLLID_ISSUER=${fixture.origin}\nLIDOLLID_PUBLIC_ORIGIN=http://127.0.0.1:4190\nDISCORD_TOKEN=never-print-this\n`);
    const success = await run();
    assert.equal(success.code, 0, success.output);
    assert.match(success.output, /PASS:/);
    assert.doesNotMatch(success.output, /never-print-this|code_challenge|nonce|state=/);
    fixture.setMode("discovery-issuer");
    const failure = await run();
    assert.equal(failure.code, 1);
    assert.match(failure.output, /ISSUER_MISMATCH/);
    assert.doesNotMatch(failure.output, /never-print-this/);
    assert.equal(fixture.discoveries(), 2);
  } finally { await close(fixture.server); rmSync(directory, { recursive: true, force: true }); }
});

test("preview visits preserve tickets; only a same-origin form with its browser cookie can start login", async () => {
  const store = new IdentityStore(":memory:");
  const config = { origin: "http://127.0.0.1", issuer: "https://auth.example" };
  let starts = 0;
  const server = createAuthServer(config, store, {
    begin: async () => { starts++; return { values, url: "https://auth.example/authorize" }; },
  });
  config.origin = await listen(server);
  try {
    const ticket = store.begin("alice");
    const preview = await loginForm(config.origin, ticket);
    const browser = await loginForm(config.origin, ticket);
    assert.equal(store.hasTicket(ticket), true);
    assert.equal(starts, 0);
    assert.equal((await fetch(`${config.origin}/auth/login?ticket=${ticket}`, { method: "HEAD" })).status, 405);
    assert.equal((await submitLogin(config.origin, browser, "https://foreign.example")).status, 403);
    const opaqueOrigin = await submitLogin(config.origin, browser, "null");
    assert.equal(opaqueOrigin.status, 403);
    assert.match(await opaqueOrigin.text(), /ORIGIN_NULL/);
    const noOrigin = await fetch(`${config.origin}/auth/login`, { method: "POST", headers: { cookie: browser.cookie }, body: browser.body });
    assert.equal(noOrigin.status, 403);
    assert.match(await noOrigin.text(), /ORIGIN_MISSING/);
    const missingCookie = await submitLogin(config.origin, { ...browser, cookie: "" });
    assert.equal(missingCookie.status, 400);
    assert.match(await missingCookie.text(), /did not return the sign-in cookie/);
    assert.equal((await submitLogin(config.origin, { ...browser, cookie: preview.cookie })).status, 400);
    assert.equal((await fetch(`${config.origin}/auth/login`, { method: "POST", headers: { origin: config.origin, "Content-Type": "application/json" }, body: "{}" })).status, 415);
    const oversized = { ...browser, body: new URLSearchParams({ ...Object.fromEntries(browser.body), padding: "x".repeat(5000) }) };
    assert.equal((await submitLogin(config.origin, oversized)).status, 413);
    assert.equal(store.hasTicket(ticket), true);
    assert.equal(starts, 0);
    const started = await submitLogin(config.origin, browser);
    assert.equal(started.status, 303);
    assert.match(started.headers.get("content-security-policy"), /form-action 'self' https:\/\/auth.example/);
    assert.equal(starts, 1);
    assert.equal(store.hasTicket(ticket), false);
    assert.equal((await submitLogin(config.origin, browser)).status, 400);
    assert.equal(starts, 1);
    assert.equal((await fetch(`${config.origin}/auth/login?ticket=${ticket}`)).status, 400);
  } finally { await close(server); store.close(); }
});
