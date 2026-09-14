import { readFileSync } from "node:fs";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { GachaError } from "./store.js";
import { WalletError } from "../wallet/client.js";
import { assetRoot } from "./catalog.js";

const hash = value => createHash("sha256").update(value).digest("hex");
const equal = (a, b) => typeof a === "string" && typeof b === "string" && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const escape = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function createGachaWeb(config, game, sessions) {
  const secure = config.origin.startsWith("https:"), prefix = secure ? "__Host-" : "";
  const sessionName = `${prefix}diaper_session`, formName = `${prefix}diaper_form`;
  const cookie = (name, value, age) => `${name}=${value}; Path=/; Max-Age=${age}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
  const readCookie = (request, name) => (request.headers.cookie || "").split(";").map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1);
  const staticFiles = new Map(["app.js", "style.css"].map(name => [`/diapers/${name}`, { type: name.endsWith("css") ? "text/css" : "text/javascript", body: readFileSync(new URL(`./web/${name}`, import.meta.url)) }]));
  for (const item of game.catalog) staticFiles.set(`/diapers/art/${item.image}`, { type: "image/png", body: readFileSync(new URL(item.image, assetRoot)) });
  const app = readFileSync(new URL("./web/index.html", import.meta.url));
  const send = (response, status, body, type = "text/html") => { response.writeHead(status, { "Content-Type": type === "image/png" ? type : `${type}; charset=utf-8` }); response.end(body); };
  const json = (response, status, data) => send(response, status, JSON.stringify(data), "application/json");
  const page = body => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#fff5fa"><title>Diaper Atelier · LiDollBot</title><link rel="stylesheet" href="/diapers/style.css"></head><body class="handoff"><main class="handoff-card"><p class="eyebrow">✦ LiDollBot presents</p><h1>Diaper Atelier</h1>${body}</main></body></html>`;
  const body = async request => {
    let size = 0; const parts = [];
    for await (const part of request) { size += part.length; if (size > 8192) throw new GachaError("This request is too large."); parts.push(part); }
    return Buffer.concat(parts).toString("utf8");
  }; // Bound request bodies before parsing any form fields or payment actions.

  return async (request, response) => {
    const url = new URL(request.url, config.origin);
    if (!url.pathname.startsWith("/diapers/") && url.pathname !== "/diapers") return false;
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      if (url.origin !== config.origin) { send(response, 400, page("<p>Invalid origin.</p>")); return true; }
      const asset = staticFiles.get(url.pathname);
      if (asset && ["GET", "HEAD"].includes(request.method)) {
        response.setHeader("Cache-Control", asset.type === "image/png" ? "public, max-age=3600" : "no-cache"); // Revalidate game code/styles on updates while caching public artwork.
        send(response, 200, asset.body, asset.type); return true;
      }
      if (url.pathname === "/diapers/open") {
        if (request.method === "GET") {
          const ticket = url.searchParams.get("ticket");
          if (!sessions.ticket(ticket)) throw new GachaError("This game link expired or was used. Run /diapers in Discord for a fresh link.");
          const nonce = randomBytes(32).toString("base64url");
          response.setHeader("Set-Cookie", cookie(formName, nonce, 600));
          response.setHeader("Referrer-Policy", "origin");
          send(response, 200, page(`<p>Your little collection is waiting. Open the atelier to roll, browse your diapers, and visit the shared bank.</p><form method="post" action="/diapers/open"><input type="hidden" name="ticket" value="${ticket}"><input type="hidden" name="csrf" value="${hash(`${ticket}:${nonce}`)}"><button class="primary" type="submit">Open my atelier <span aria-hidden="true">→</span></button></form><p class="muted">This signs this browser into your game for eight hours. Keep your private Discord link to yourself.</p>`)); return true;
        }
        if (request.method === "POST") {
          const nonce = readCookie(request, formName);
          if (request.headers.origin !== config.origin || request.headers["content-type"]?.split(";")[0] !== "application/x-www-form-urlencoded" || !/^[\w-]{43}$/.test(nonce || "")) throw new GachaError("Reopen your Discord game link and use its Open my atelier button.");
          const form = new URLSearchParams(await body(request)), ticket = form.get("ticket");
          if (!equal(form.get("csrf"), hash(`${ticket}:${nonce}`))) throw new GachaError("The browser could not verify this form. Reopen your Discord game link.");
          const token = sessions.open(ticket);
          response.writeHead(303, { Location: "/diapers/", "Set-Cookie": [cookie(sessionName, token, 8 * 3600), cookie(formName, "", 0)] }); response.end(); return true;
        }
      }
      if (["/diapers", "/diapers/"].includes(url.pathname) && request.method === "GET") { send(response, 200, app); return true; }
      if (url.pathname.startsWith("/diapers/api/")) {
        const session = sessions.get(readCookie(request, sessionName));
        if (!session) { json(response, 401, { error: "Run /diapers in Discord and open its private link to sign in." }); return true; }
        if (url.pathname === "/diapers/api/state" && request.method === "GET") {
          let coins = null, walletError = null;
          try { coins = (await game.wallet.balance(session.user_id)).coins; }
          catch (error) { walletError = error instanceof WalletError ? error.message : "The wallet is temporarily unavailable."; }
          json(response, 200, { ...game.snapshot(session.user_id), username: session.username, csrf: session.csrf, coins, walletError }); return true;
        }
        if (request.method === "POST") {
          if (request.headers.origin !== config.origin || !equal(request.headers["x-csrf-token"], session.csrf) || request.headers["content-type"]?.split(";")[0] !== "application/json") {
            json(response, 403, { error: "This browser could not verify the action. Refresh your atelier." }); return true;
          }
          if (url.pathname === "/diapers/api/logout") {
            sessions.revoke(session.user_id); response.setHeader("Set-Cookie", cookie(sessionName, "", 0)); json(response, 200, { ok: true }); return true;
          }
          if (url.pathname === "/diapers/api/action") {
            let input; try { input = JSON.parse(await body(request)); } catch { throw new GachaError("Invalid game request."); }
            if (!input || typeof input !== "object" || Array.isArray(input)) throw new GachaError("Invalid game request.");
            if (input.action !== "retry" && (!Number.isSafeInteger(input.amount) || input.amount < 1)) throw new GachaError("Refresh the page to review the current price.");
            const result = input.action === "retry" ? await game.retry(session.user_id)
              : await game.act(session.user_id, input.action, input.design, input.request, input.amount);
            json(response, 200, result); return true;
          }
        }
      }
      send(response, 404, page("<p>That page is not here. <a href=\"/diapers/\">Return to the atelier</a>.</p>"));
    } catch (error) {
      const message = error instanceof GachaError || error instanceof WalletError ? error.message : "The atelier is temporarily unavailable. Refresh and retry any pending payment; do not start a replacement purchase.";
      if (url.pathname.startsWith("/diapers/api/")) json(response, 400, { error: message });
      else send(response, 400, page(`<p>${escape(message)}</p><a href="/diapers/">Return to the atelier</a>`));
    }
    return true;
  }; // No browser receives wallet credentials; authenticated same-origin actions use the confirmed Discord account only.
}
