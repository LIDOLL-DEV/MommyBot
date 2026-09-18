import { readFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { AdminError } from "./store.js";
import { GameSessions } from "../games/sessions.js";

export class AdminSessions extends GameSessions {
  constructor(db, identities, now = Date.now) { super(db, identities, { prefix: "admin", command: "/lidollid login", now }); }
  openForIdentity(identity) {
    const linked = this.identities.find(identity.issuer, identity.subject);
    if (!linked) throw new AdminError("Link this LiD0llID to Discord first.", 403);
    return this.open(this.begin(linked.discord_id));
  } // Bind admin sessions to the confirmed Discord link, including when the same identity also has a standalone game account.
}

export function createAdminWeb(config, sessions, service) {
  const secure = config.origin.startsWith("https:"), name = `${secure ? "__Host-" : ""}admin_session`;
  const assets = new Map(["index.html", "style.css", "app.js"].map(file => [`/admin/${file}`, {
    body: readFileSync(new URL(`./web/${file}`, import.meta.url)), type: file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html",
  }]));
  const json = (res, status, body) => { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(body)); };
  return async (req, res) => {
    const url = new URL(req.url, config.origin);
    if (url.pathname !== "/admin" && !url.pathname.startsWith("/admin/")) return false;
    res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      if (url.origin !== config.origin) throw new AdminError("Invalid origin.", 403);
      const asset = assets.get(["/admin", "/admin/"].includes(url.pathname) ? "/admin/index.html" : url.pathname);
      if (asset && ["GET", "HEAD"].includes(req.method)) { res.writeHead(200, { "Content-Type": `${asset.type}; charset=utf-8` }); res.end(req.method === "HEAD" ? "" : asset.body); return true; }
      const token = (req.headers.cookie || "").split(";").map(value => value.trim()).find(value => value.startsWith(`${name}=`))?.slice(name.length + 1);
      const session = sessions.get(token);
      if (!session) throw new AdminError("Sign in with your Discord-linked LiD0llID account.", 401);
      if (req.method === "GET" && url.pathname === "/admin/api/state") { json(res, 200, await service.state(session, url.searchParams.get("guild"))); return true; }
      if (req.method !== "POST") throw new AdminError("Route not found.", 404);
      const csrf = req.headers["x-csrf-token"];
      if (req.headers.origin !== config.origin || typeof csrf !== "string" || Buffer.byteLength(csrf) !== Buffer.byteLength(session.csrf) ||
        !timingSafeEqual(Buffer.from(csrf), Buffer.from(session.csrf)) || req.headers["content-type"]?.split(";")[0].trim() !== "application/json") throw new AdminError("Refresh the admin panel to verify this action.", 403);
      if (url.pathname === "/admin/api/logout") {
        sessions.revoke(session.user_id);
        res.setHeader("Set-Cookie", `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`);
        json(res, 200, { ok: true }); return true;
      }
      if (url.pathname !== "/admin/api/action") throw new AdminError("Route not found.", 404);
      let length = 0; const parts = [];
      for await (const part of req) { length += part.length; if (length > 16384) throw new AdminError("Request too large.", 413); parts.push(part); }
      let input; try { input = JSON.parse(Buffer.concat(parts).toString("utf8")); } catch { throw new AdminError("Invalid JSON request."); }
      json(res, 200, await service.act(session, input));
    } catch (error) { json(res, error instanceof AdminError ? error.status : 503, { error: error instanceof AdminError ? error.message : "Admin action could not finish. Check bot permissions and try again." }); }
    return true;
  };
} // Reuse secure server-side sessions with strict same-origin CSRF checks, bounded JSON and an explicit static-file allowlist.
