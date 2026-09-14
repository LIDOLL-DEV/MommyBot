import { readFileSync } from "node:fs";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import { GameSessions } from "../games/sessions.js";
import { TraderError } from "./store.js";
import { WalletError } from "../wallet/client.js";
import { TouhouWebGame, discordGuildAccess } from "./web-game.js";

export function initializeTouhouWeb(config, identities, trader, client) {
  if (!trader?.webState.wallet || !client) return null;
  const game = new TouhouWebGame(trader.webState, discordGuildAccess(client));
  const sessions = new GameSessions(game.store.db, identities, { prefix: "touhou", command: "/lidollid login", ErrorClass: TraderError });
  return { sessions, web: createTouhouWeb(config, game, sessions), revoke: user => sessions.revoke(user), prune: () => { sessions.prune(); game.prune(); } };
} // Reuse the trader's existing database; its existing shutdown closes this store after wallet actions drain.

export function createTouhouWeb(config, game, sessions) {
  const secure = config.origin.startsWith("https:"), name = `${secure ? "__Host-" : ""}touhou_session`;
  const assets = new Map(["app.js", "style.css", "index.html"].map(file => [`/touhou/${file}`, { type: file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html", body: readFileSync(new URL(`./web/${file}`, import.meta.url)) }]));
  assets.set("/touhou/atelier.css", { type: "text/css", body: readFileSync(new URL("../gacha/web/style.css", import.meta.url)) });
  for (const item of game.store.catalog) assets.set(`/touhou/art/${encodeURIComponent(item.filename)}`, {
    type: `image/${{ ".jpg": "jpeg", ".jpeg": "jpeg", ".png": "png", ".gif": "gif", ".webp": "webp" }[path.extname(item.filename).toLowerCase()]}`,
    body: readFileSync(path.join(game.imageDirectory, item.filename)),
  });
  const send = (res, status, body, type = "application/json") => { res.writeHead(status, { "Content-Type": type }); res.end(type === "application/json" ? JSON.stringify(body) : body); };
  return async (req, res) => {
    const url = new URL(req.url, config.origin);
    if (url.pathname !== "/touhou" && !url.pathname.startsWith("/touhou/")) return false;
    res.setHeader("Cache-Control", "no-store"); res.setHeader("Referrer-Policy", "no-referrer"); res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      if (url.origin !== config.origin) throw new TraderError("Invalid origin.");
      const asset = assets.get(["/touhou", "/touhou/"].includes(url.pathname) ? "/touhou/index.html" : url.pathname);
      if (asset && ["GET", "HEAD"].includes(req.method)) {
        res.setHeader("Cache-Control", asset.type.startsWith("image/") ? "public, max-age=3600" : "no-cache"); send(res, 200, req.method === "HEAD" ? "" : asset.body, asset.type); return true;
      }
      const cookie = (req.headers.cookie || "").split(";").map(value => value.trim()).find(value => value.startsWith(`${name}=`))?.slice(name.length + 1);
      const session = sessions.get(cookie);
      if (!session) { send(res, 401, { error: "Sign in with LiD0llID to open your linked Discord collection." }); return true; }
      if (req.method === "GET" && url.pathname === "/touhou/api/state") {
        const state = await game.state(session, url.searchParams.get("guild"));
        let balance = null, walletError = null;
        try { balance = await game.wallet.balance(session.user_id); } catch (error) { walletError = error instanceof WalletError ? error.message : "Your wallet is unavailable. Refresh to retry."; }
        send(res, 200, { ...state, username: session.username, csrf: session.csrf, balance: balance ? { coins: balance.coins, stars: balance.stars } : null, walletError }); return true;
      }
      if (req.method === "POST") {
        const csrf = req.headers["x-csrf-token"];
        if (req.headers.origin !== config.origin || typeof csrf !== "string" || Buffer.byteLength(csrf) !== Buffer.byteLength(session.csrf) || !timingSafeEqual(Buffer.from(csrf), Buffer.from(session.csrf)) || req.headers["content-type"]?.split(";")[0] !== "application/json") { send(res, 403, { error: "Refresh the trader to verify this action." }); return true; }
        if (url.pathname === "/touhou/api/logout") {
          sessions.revoke(session.user_id); res.setHeader("Set-Cookie", `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`); send(res, 200, { ok: true }); return true;
        }
        if (url.pathname === "/touhou/api/action") {
          let size = 0; const chunks = [];
          for await (const chunk of req) { size += chunk.length; if (size > 8192) throw new TraderError("This request is too large."); chunks.push(chunk); }
          let input; try { input = JSON.parse(Buffer.concat(chunks)); } catch { throw new TraderError("Invalid game request."); }
          if (!input || typeof input !== "object" || Array.isArray(input)) throw new TraderError("Invalid game request.");
          send(res, 200, await game.act(session, input)); return true;
        }
      }
      send(res, 404, { error: "Page not found." });
    } catch (error) { send(res, 400, { error: error instanceof TraderError || error instanceof WalletError ? error.message : "The trader could not finish. Refresh and retry any pending payment." }); }
    return true;
  }; // Only authenticated, same-origin requests can operate the existing server-scoped trader rules.
}
