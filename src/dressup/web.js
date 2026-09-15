import { readFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { dressupRoot } from "./catalog.js";
import { GachaError } from "../gacha/store.js";
import { WalletError } from "../wallet/client.js";
import { createPetIntegration } from "./integration.js";
import { selectButtcam } from "./camera.js";

export function createDressupWeb(config, clothes, doll, sessions, catalog) {
  doll.identity = user => sessions.identities.gameIdentity(user);
  const integration = createPetIntegration(doll, config.petBridge);
  const assets = new Map();
  for (const name of Object.keys(catalog.provenance)) if (!/_ButtCam_/.test(name)) assets.set(`/clothes/art/${name}`, new URL(name, dressupRoot));
  const page = readFileSync(new URL("./web/index.html", import.meta.url));
  const code = new Map(["app.js", "style.css", "care.css", "pastel.css", "doll.js", "layers.js", "fit.js", "menu.js"].map(name => [name, readFileSync(new URL(`./web/${name}`, import.meta.url))]));
  const send = (res, status, body, type = "application/json") => { res.writeHead(status, { "Content-Type": type }); res.end(type === "application/json" ? JSON.stringify(body) : body); };
  return async (req, res) => {
    const url = new URL(req.url, config.origin), match = /^\/(clothes|littlepottchi)(?:\/(.*))?$/.exec(url.pathname);
    if (!match) return false;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    let actionRequest = null, actionUser = null;
    try {
      if (url.origin !== config.origin) throw new GachaError("Invalid origin.");
      if (await integration(req, res, url)) return true;
      const path = match[2] || "";
      if (req.method === "GET" && assets.has(url.pathname)) {
        res.setHeader("Cache-Control", "public, max-age=3600");
        send(res, 200, readFileSync(assets.get(url.pathname)), "image/png"); return true;
      }
      if (req.method === "GET" && code.has(path)) { send(res, 200, code.get(path), path.endsWith("css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8"); return true; }
      if (req.method === "GET" && path === "") { send(res, 200, page, "text/html; charset=utf-8"); return true; }
      if (!path.startsWith("api/")) { send(res, 404, { error: "Page not found." }); return true; }
      const cookieName = `${config.origin.startsWith("https:") ? "__Host-" : ""}diaper_session`;
      const token = (req.headers.cookie || "").split(";").map(s => s.trim()).find(s => s.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
      const session = sessions.get(token);
      if (!session) { send(res, 401, { error: "Sign in with LiD0llID to open your wardrobe." }); return true; }
      if (req.method === "GET" && path === "api/buttcam") {
        const player = doll.player(session.user_id), resolved = doll.resolve(session.user_id, player);
        const camera = selectButtcam(catalog, player, resolved.diaper);
        send(res, 200, readFileSync(new URL(camera.image, dressupRoot)), "image/png"); return true;
      } // The server selects the authorized frame; query parameters cannot request messy art while the mode is off.
      if (req.method === "GET" && path === "api/pet") { send(res, 200, doll.snapshot(session.user_id)); return true; }
      if (req.method === "GET" && path === "api/state") {
        let coins = null, walletError = null;
        try { coins = (await clothes.wallet.balance(session.user_id)).coins; }
        catch (error) { walletError = error instanceof WalletError ? error.message : "Wallet unavailable. Refresh to try again."; }
        const { provenance, ...publicCatalog } = catalog;
        send(res, 200, { csrf: session.csrf, username: session.username, coins, walletError, catalog: publicCatalog,
          shop: clothes.snapshot(session.user_id), doll: doll.snapshot(session.user_id), diapers: doll.diapers.catalog }); return true;
      }
      if (req.method === "POST") {
        const csrf = req.headers["x-csrf-token"];
        if (req.headers.origin !== config.origin || typeof csrf !== "string" || Buffer.byteLength(csrf) !== Buffer.byteLength(session.csrf) ||
            !timingSafeEqual(Buffer.from(csrf), Buffer.from(session.csrf)) || req.headers["content-type"]?.split(";")[0] !== "application/json") {
          send(res, 403, { error: "Refresh the page to verify this action." }); return true;
        }
        const parts = []; let size = 0;
        for await (const part of req) { size += part.length; if (size > 8192) throw new GachaError("Request is too large."); parts.push(part); }
        let input; try { input = JSON.parse(Buffer.concat(parts).toString("utf8")); } catch { throw new GachaError("Invalid game request."); }
        if (!input || typeof input !== "object" || Array.isArray(input)) throw new GachaError("Invalid game request.");
        if (path === "api/action" && match[1] === "clothes") {
          actionRequest = input.request; actionUser = session.user_id;
          if (input.action !== "retry" && (!Number.isSafeInteger(input.amount) || input.amount < 1)) throw new GachaError("Review the current price before purchasing.");
          const result = input.action === "retry" ? await clothes.retry(session.user_id) : await clothes.act(session.user_id, input.action, input.design, input.request, input.amount);
          send(res, 200, result); return true;
        }
        if (path === "api/doll") { send(res, 200, doll.act(session.user_id, input)); return true; }
        if (path === "api/logout") { sessions.revoke(session.user_id); send(res, 200, { ok: true }); return true; }
      }
      send(res, 404, { error: "Page not found." });
    } catch (error) {
      let retryable;
      if (typeof actionRequest === "string" && (error instanceof GachaError || error instanceof WalletError)) {
        const job = clothes.db.prepare("SELECT state FROM diaper_jobs WHERE user_id=? AND request_id=?").get(actionUser, actionRequest);
        retryable = Boolean(job && job.state !== "failed");
      } // A definitive pre-payment rejection can clear the browser request; uncertain or paid jobs must retain it.
      send(res, 400, { error: error instanceof GachaError || error instanceof WalletError ? error.message : "The wardrobe is unavailable. Refresh and retry any saved payment.", retryable });
    }
    return true;
  }; // Both games reuse the Atelier session, CSRF binding and verified account; public artwork is allowlisted.
}
