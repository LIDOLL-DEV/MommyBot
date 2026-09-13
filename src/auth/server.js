import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { authDiagnostic } from "./diagnostics.js";

const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function createAuthServer(config, store, oidc) {
  const secure = config.origin.startsWith("https:");
  const cookieName = secure ? "__Host-lidollbot_login" : "lidollbot_login";
  const formCookieName = secure ? "__Host-lidollbot_form" : "lidollbot_form";
  const cookie = (value, age, name = cookieName) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? "; Secure" : ""}`;
  const readCookie = (request, name) => (request.headers.cookie || "").split(";").map(part => part.trim())
    .find(part => part.startsWith(`${name}=`))?.slice(name.length + 1);
  const validTicket = ticket => /^[\w-]{43}$/.test(ticket || "") && store.hasTicket(ticket);
  const page = (response, status, body) => {
    response.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>LiDollBot account</title><body><main><h1>LiDollBot · LiD0llID</h1>${body}</main></body></html>`);
  }; // Render escaped server-side text with no scripts, third-party assets or browser token storage.
  return createServer({ requestTimeout: 15000, headersTimeout: 10000, maxHeaderSize: 8192 }, async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Content-Type-Options", "nosniff");
    const issuerOrigin = config.issuer ? new URL(config.issuer).origin : "";
    response.setHeader("Content-Security-Policy", `default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self' ${issuerOrigin}`.trim());
    let stage = "login";
    try {
      const url = new URL(request.url, config.origin);
      if (url.origin !== config.origin) return page(response, 400, "<p>Invalid request.</p>");
      const allowedMethods = url.pathname === "/auth/login" ? ["GET", "POST"] : ["GET"];
      if (!allowedMethods.includes(request.method)) { response.setHeader("Allow", allowedMethods.join(", ")); return page(response, 405, "<p>Method not allowed.</p>"); }
      if (url.pathname === "/") return page(response, 200, "<p>Use <strong>/lidollid login</strong> in Discord to connect your account.</p>");
      if (url.pathname === "/auth/login") {
        if (request.method === "GET") {
          const ticket = url.searchParams.get("ticket");
          if (!validTicket(ticket)) return page(response, 400, "<p>Login link invalid, expired or already used. Start with /lidollid login in Discord.</p>");
          const csrf = randomBytes(32).toString("base64url");
          response.setHeader("Set-Cookie", cookie(csrf, 600, formCookieName));
          return page(response, 200, `<p>Connect your LiD0llID account to Discord in this browser.</p><form method="post" action="/auth/login"><input type="hidden" name="ticket" value="${escapeHtml(ticket)}"><input type="hidden" name="csrf" value="${csrf}"><button type="submit">Continue with LiD0llID</button></form><p>Keep this browser open until sign-in finishes, then return to Discord with the confirmation code.</p>`);
        } // Link previews and repeated page visits cannot consume tickets or start provider interactions.
        if (request.headers.origin !== config.origin) return page(response, 403, "<p>Open your Discord sign-in link and use its Continue button.</p>");
        if (request.headers["content-type"]?.split(";")[0].trim() !== "application/x-www-form-urlencoded") {
          return page(response, 415, "<p>Use the sign-in form.</p>");
        }
        let size = 0;
        const chunks = [];
        for await (const chunk of request) {
          size += chunk.length;
          if (size > 4096) return page(response, 413, "<p>Sign-in form is too large.</p>");
          chunks.push(chunk);
        } // Bound the form body before reading browser credentials.
        const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
        const supplied = form.get("csrf") || "", expected = readCookie(request, formCookieName) || "";
        if (!/^[\w-]{43}$/.test(supplied) || !/^[\w-]{43}$/.test(expected) ||
            !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
          return page(response, 400, "<p>This browser did not return the sign-in cookie, or the page was replaced. Allow cookies for this site, then reopen your Discord sign-in link in this browser and continue.</p>");
        }
        const ticket = form.get("ticket");
        if (!validTicket(ticket)) return page(response, 400, "<p>Login link invalid, expired or already used. Start with /lidollid login in Discord.</p>");
        const login = await oidc.begin();
        stage = "storage";
        const browser = store.start(ticket, login.values);
        response.writeHead(303, { Location: login.url, "Set-Cookie": [cookie(browser, 600), cookie("", 0, formCookieName)] });
        return response.end();
      }
      if (url.pathname === "/auth/callback") {
        stage = "storage";
        const browser = readCookie(request, cookieName);
        response.setHeader("Set-Cookie", cookie("", 0));
        const attempt = store.take(browser);
        if (!attempt) return page(response, 400, "<p>Login expired or already used. Run /lidollid login again.</p>");
        stage = "callback";
        const identity = await oidc.finish(url, attempt);
        stage = "storage";
        const code = store.verified(attempt, identity);
        return page(response, 200, `<p>Signed in as <strong>${escapeHtml(identity.username)}</strong>.</p><p>To link this account, return to the Discord account that started sign-in and run:</p><pre>/lidollid confirm code:${code}</pre><p>Only confirm a sign-in you started yourself. The code expires ten minutes after you started. You can close this page afterward.</p>`);
      }
      return page(response, 404, "<p>Page not found.</p>");
    } catch (error) {
      const diagnostic = authDiagnostic(error, stage);
      console.error(`[LiD0llID] Sign-in failed ${JSON.stringify(diagnostic)}`);
      const reference = `${diagnostic.stage}: ${diagnostic.code}${diagnostic.status ? ` (HTTP ${diagnostic.status})` : ""}`;
      return page(response, 503, `<p>Sign-in could not be completed. Run /lidollid login again in Discord. If this continues, share the following reference with the bot operator:</p><p><code>${escapeHtml(reference)}</code></p>`);
    } // Make the failed step identifiable while keeping original exception details private.
  });
} // Expose only the browser handoff; account reads and changes require authenticated Discord interactions.
