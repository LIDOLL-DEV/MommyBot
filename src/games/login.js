import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { renderAuthPage, authStyleSource } from "../auth/page.js";
import { authDiagnostic } from "../auth/diagnostics.js";

const hash = value => createHash("sha256").update(String(value || "")).digest("hex");
const valid = value => /^[\w-]{43}$/.test(value || "");
const escape = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function createGameLogin(config, identities, oidc, games, now = Date.now, wallet = null) {
  const db = identities.db, secure = config.origin.startsWith("https:"), prefix = secure ? "__Host-" : "";
  const loginCookie = `${prefix}lidollbot_game_login`, formCookie = `${prefix}lidollbot_game_form`;
  const cookie = (name, value, age) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? "; Secure" : ""}`;
  const readCookie = (req, name) => (req.headers.cookie || "").split(";").map(value => value.trim()).find(value => value.startsWith(`${name}=`))?.slice(name.length + 1);
  db.exec(`CREATE TABLE IF NOT EXISTS game_logins(browser TEXT PRIMARY KEY,state TEXT NOT NULL UNIQUE,
    verifier TEXT NOT NULL,nonce TEXT NOT NULL,game TEXT NOT NULL,expires INTEGER NOT NULL);`);
  const prune = () => db.prepare("DELETE FROM game_logins WHERE expires<=?").run(now());
  const page = (res, status, body) => { res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" }); res.end(renderAuthPage(body, status)); };
  const route = async (req, res) => {
    const url = new URL(req.url, config.origin), match = /^\/(diapers|clothes|littlepottchi|hangman|touhou|balldrop|gofish)\/login$/.exec(url.pathname);
    const isCallback = url.pathname === "/auth/callback" && (url.searchParams.get("state")?.startsWith("game.") ||
      (readCookie(req, loginCookie) && !readCookie(req, `${prefix}lidollbot_login`) && !url.searchParams.has("state")));
    if (!match && !isCallback) return false;
    res.setHeader("Cache-Control", "no-store"); res.setHeader("Referrer-Policy", "no-referrer"); res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", `default-src 'none'; style-src ${authStyleSource}; frame-ancestors 'none'; base-uri 'none'; form-action 'self' ${new URL(config.issuer).origin}`);
    try {
      prune();
      if (url.origin !== config.origin) { page(res, 400, "<p>Invalid origin.</p>"); return true; }
      if (match) {
        const key = match[1], game = games[key];
        if (!game) { page(res, 503, "<p>This game is not available right now.</p>"); return true; }
        if (req.method === "GET") {
          const nonce = randomBytes(32).toString("base64url");
          res.setHeader("Set-Cookie", cookie(formCookie, nonce, 600)); res.setHeader("Referrer-Policy", "origin");
          page(res, 200, `<h2>${escape(game.title)}</h2><p>Sign in with LiD0llID to play. No Discord account or server membership is needed. You will be asked to approve wallet access for game purchases and rewards.</p><form method="post" action="/${key}/login"><input type="hidden" name="csrf" value="${hash(`${key}:${nonce}`)}"><button type="submit">Sign in with LiD0llID</button></form><p>First visit? Register on the LiD0llID sign-in page. Your progress is saved to your account. Existing Discord-linked players keep their collections.</p>`); return true;
        }
        if (req.method !== "POST") { res.setHeader("Allow", "GET, POST"); page(res, 405, "<p>Use the sign-in button.</p>"); return true; }
        const nonce = readCookie(req, formCookie);
        if (req.headers.origin !== config.origin || !valid(nonce) || req.headers["content-type"]?.split(";")[0].trim() !== "application/x-www-form-urlencoded") {
          page(res, 403, "<p>Reopen the game sign-in page and use its button.</p>"); return true;
        }
        let size = 0; const chunks = [];
        for await (const chunk of req) { size += chunk.length; if (size > 4096) { page(res, 413, "<p>Form is too large.</p>"); return true; } chunks.push(chunk); }
        const supplied = new URLSearchParams(Buffer.concat(chunks).toString("utf8")).get("csrf"), expected = hash(`${key}:${nonce}`);
        if (!/^[a-f0-9]{64}$/.test(supplied || "") || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) { page(res, 403, "<p>Reopen the game sign-in page and use its button.</p>"); return true; }
        const login = await oidc.begin();
        if (!login.values.state.startsWith("game.")) throw new Error("Invalid game login state namespace.");
        const browser = randomBytes(32).toString("base64url");
        db.transaction(() => {
          db.prepare("DELETE FROM game_logins WHERE browser=?").run(hash(readCookie(req, loginCookie)));
          db.prepare("INSERT INTO game_logins VALUES (?,?,?,?,?,?)").run(hash(browser), login.values.state, login.values.verifier, login.values.nonce, key, now() + 600000);
        })();
        res.writeHead(303, { Location: login.url, "Set-Cookie": [cookie(loginCookie, browser, 600), cookie(formCookie, "", 0)] }); res.end(); return true;
      }
      if (req.method !== "GET") { page(res, 405, "<p>Invalid callback method.</p>"); return true; }
      const browser = readCookie(req, loginCookie);
      res.setHeader("Set-Cookie", cookie(loginCookie, "", 0));
      const attempt = db.transaction(() => {
        const row = valid(browser) ? db.prepare("SELECT * FROM game_logins WHERE browser=?").get(hash(browser)) : null;
        if (row) db.prepare("DELETE FROM game_logins WHERE browser=?").run(hash(browser));
        return row;
      })(); // Consume only the game flow's cookie-bound credentials, including failed callbacks.
      if (!attempt) { page(res, 400, '<p>This game sign-in expired or was already used. Open the game from Little Log again.</p>'); return true; }
      const identity = await oidc.finish(url, attempt), game = games[attempt.game];
      if (!game) throw new Error("Game is unavailable.");
      const account = identities.gameAccount(identity);
      if (wallet) {
        const proof = { discord_id: account.player_id, generation: attempt.state, issuer: identity.issuer, subject: identity.subject, expires: attempt.expires };
        const validate = () => {
          const current = identities.gameIdentity(account.player_id);
          if (now() >= proof.expires || !current || current.issuer !== identity.issuer || current.subject !== identity.subject || current.linked_at !== account.linked_at) throw new Error("Game sign-in expired or the account changed.");
        }; // Recheck ownership around network requests, including concurrent Discord unlink.
        await wallet.stageIdentity(proof, identity, validate);
        await wallet.confirmIdentity(account.player_id, proof, activate => { validate(); activate(); }, validate);
      } // Exchange only the explicitly consented OIDC wallet proof; games never accept a client-supplied wallet owner.
      const token = game.sessions.openForIdentity(identity);
      res.writeHead(303, { Location: `/${attempt.game}/`, "Set-Cookie": [cookie(loginCookie, "", 0), cookie(`${prefix}${game.sessions.prefix}_session`, token, 8 * 3600)] }); res.end();
    } catch (error) {
      const diagnostic = authDiagnostic(error, "game-sign-in");
      console.error(`[LiD0llID] Game sign-in failed ${JSON.stringify(diagnostic)}`);
      page(res, 503, `<p>Game sign-in could not be completed. Reopen the game from Little Log and try again.</p><p>Reference: <code>${escape(diagnostic.code)}</code></p>`);
    }
    return true;
  };
  return { route, prune };
} // Reuse the registered PKCE callback to connect a verified game account and its explicitly approved wallet.
