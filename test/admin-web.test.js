import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { PermissionsBitField } from "discord.js";
import { adminFixture, ids } from "./fixtures/admin-fixture.js";
import { AdminSessions, createAdminWeb } from "../src/admin/web.js";
import { createGameLogin } from "../src/games/login.js";

async function fixture(t) {
  const f = adminFixture(t);
  f.sessions = new AdminSessions(f.store.db, f.identities);
  f.config = { origin: "http://127.0.0.1", issuer: "https://auth.example" };
  const web = createAdminWeb(f.config, f.sessions, f.service);
  f.oidcCalls = [];
  const oidc = { begin: async () => { f.oidcCalls.push("begin"); return { values: { state: "game.admin-test", nonce: "nonce", verifier: "verifier" }, url: "https://auth.example/authorize" }; },
    finish: async (_url, attempt) => { assert.equal(attempt.state, "game.admin-test"); f.oidcCalls.push("finish"); return f.identity; } };
  const login = createGameLogin(f.config, f.identities, { begin: () => assert.fail("Must use admin's profile-only flow"), finish: () => assert.fail("Wrong OIDC flow") }, {
    admin: { sessions: f.sessions, title: "Sakura admin panel", oidc, walletAccess: false,
      authorize: async identity => { const link = f.identities.find(identity.issuer, identity.subject); return Boolean(link && (await f.access.list({ user_id: link.discord_id })).length); } },
  }, Date.now, { stageIdentity: () => assert.fail("Admin must not access wallets"), confirmIdentity: () => assert.fail("Admin must not access wallets") });
  f.server = createServer(async (req, res) => {
    try { if (await login.route(req, res) || await web(req, res)) return; res.writeHead(404).end(); }
    catch { res.writeHead(500).end(); }
  });
  await new Promise(resolve => f.server.listen(0, "127.0.0.1", resolve));
  f.config.origin = `http://127.0.0.1:${f.server.address().port}`;
  t.after(() => new Promise(resolve => { f.server.close(resolve); f.server.closeAllConnections(); }));
  f.token = f.sessions.openForIdentity(f.identity); f.session = f.sessions.get(f.token);
  f.request = (path, options = {}) => fetch(`${f.config.origin}${path}`, { redirect: "manual", ...options });
  f.headers = { Cookie: `admin_session=${f.token}`, Origin: f.config.origin, "Content-Type": "application/json", "X-CSRF-Token": f.session.csrf };
  f.post = input => f.request("/admin/api/action", { method: "POST", headers: f.headers, body: JSON.stringify(input) });
  return f;
}

test("admin serves its login shell with restrictive headers and protects state behind a session", async t => {
  const f = await fixture(t);
  const page = await f.request("/admin/"); assert.equal(page.status, 200);
  assert.match(await page.text(), /Sign in with LiD0llID/); assert.match(page.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal(page.headers.get("cache-control"), "no-store");
  assert.equal((await f.request("/admin/api/state")).status, 401);
  const state = await (await f.request("/admin/api/state", { headers: f.headers })).json();
  assert.equal(state.guilds[0].id, ids.guild); assert.equal(state.csrf, f.session.csrf);
  const selected = await (await f.request(`/admin/api/state?guild=${ids.guild}`, { headers: f.headers })).json();
  assert.equal(selected.status.connected, true); assert.equal(selected.roles[0].id, ids.role);
  assert.doesNotMatch(JSON.stringify(selected), /DISCORD_TOKEN|walletAccessToken|verifier/);
});

test("admin writes require exact origin and session CSRF; guild permission changes immediately deny reads and writes", async t => {
  const f = await fixture(t);
  const input = { action: "settings", guild: ids.guild, ...f.store.settings(ids.guild) };
  for (const headers of [{ ...f.headers, Origin: "https://attacker.example" }, { ...f.headers, "X-CSRF-Token": "wrong" }, { Cookie: f.headers.Cookie, "Content-Type": "application/json" }]) {
    assert.equal((await f.request("/admin/api/action", { method: "POST", headers, body: JSON.stringify(input) })).status, 403);
  }
  assert.equal((await f.post(input)).status, 200);
  f.admin.permissions = new PermissionsBitField();
  assert.equal((await f.post(input)).status, 403);
  assert.equal((await f.request(`/admin/api/state?guild=${ids.guild}`, { headers: f.headers })).status, 403);
  assert.equal((await f.request(`/admin/api/state?guild=${ids.other}`, { headers: f.headers })).status, 403);
  assert.equal(f.store.history(ids.guild).length, 1);
});

test("logout and unlink invalidate sessions; unknown files and large request bodies cannot bypass the allowlist", async t => {
  const f = await fixture(t);
  assert.equal((await f.request("/admin/secret.env", { headers: f.headers })).status, 404);
  assert.equal((await f.request("/admin/api/action", { method: "POST", headers: f.headers, body: "x".repeat(17000) })).status, 413);
  assert.equal((await f.request("/admin/api/action", { method: "POST", headers: f.headers, body: "not-json" })).status, 400);
  const logout = await f.request("/admin/api/logout", { method: "POST", headers: f.headers, body: "{}" });
  assert.equal(logout.status, 200); assert.match(logout.headers.get("set-cookie"), /HttpOnly; SameSite=Lax; Max-Age=0/);
  assert.equal(f.sessions.get(f.token), null);
  const another = f.sessions.openForIdentity(f.identity); f.identities.unlink(ids.admin);
  assert.equal(f.sessions.get(another), null);
});

test("admin sessions remain bound to the Discord link even for existing standalone game accounts", async t => {
  const f = await fixture(t);
  f.identities.db.prepare("INSERT INTO web_game_accounts VALUES (?,?,?,?,?)").run("web_earlier", f.identity.issuer, f.identity.subject, "Doll", 10);
  assert.equal(f.identities.gameAccount(f.identity).player_id, "web_earlier");
  const token = f.sessions.openForIdentity(f.identity);
  assert.equal(f.sessions.get(token).user_id, ids.admin);
  f.identities.unlink(ids.admin); assert.equal(f.sessions.get(token), null);
  assert.throws(() => f.sessions.openForIdentity(f.identity), /Link this LiD0llID/);
});

async function signIn(f) {
  const page = await f.request("/admin/login"); const html = await page.text();
  assert.match(html, /No wallet access is requested/);
  const formCookie = page.headers.get("set-cookie").split(";")[0], csrf = /name="csrf" value="([a-f0-9]+)"/.exec(html)[1];
  const start = await f.request("/admin/login", { method: "POST", headers: { Origin: f.config.origin, Cookie: formCookie, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ csrf }).toString() });
  assert.equal(start.status, 303);
  const cookie = start.headers.getSetCookie().find(value => value.startsWith("lidollbot_game_login=")).split(";")[0];
  return f.request("/auth/callback?state=game.admin-test&code=code", { headers: { Cookie: cookie } });
} // Exercise the shared form-CSRF and cookie-bound callback flow with a profile-only fake provider.

test("admin SSO uses its own OIDC flow and session, skips wallet operations and redirects to the panel", async t => {
  const f = await fixture(t); const result = await signIn(f);
  assert.equal(result.status, 303); assert.equal(result.headers.get("location"), "/admin/");
  assert.ok(result.headers.getSetCookie().some(cookie => cookie.startsWith("admin_session=") && cookie.includes("HttpOnly")));
  assert.deepEqual(f.oidcCalls, ["begin", "finish"]);
});

test("SSO denies linked non-administrators and unlinked identities before creating admin sessions", async t => {
  const f = await fixture(t); f.admin.permissions = new PermissionsBitField();
  assert.equal((await signIn(f)).status, 403);
  f.identities.unlink(ids.admin);
  assert.equal((await signIn(f)).status, 403);
});
