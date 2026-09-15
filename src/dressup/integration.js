import { createHash, timingSafeEqual } from "node:crypto";
import { GachaError } from "../gacha/store.js";

export function createPetIntegration(doll, { token = process.env.LITTLEPOTTCHI_BRIDGE_TOKEN || "" } = {}) {
  if (token && (token.length < 32 || token.length > 512 || /\s/.test(token))) throw new Error("LITTLEPOTTCHI_BRIDGE_TOKEN must be a secret of 32–512 non-whitespace characters.");
  const hash = value => createHash("sha256").update(value).digest();
  return async (req, res, url) => {
    if (!url.pathname.startsWith("/littlepottchi/integration/v1/")) return false;
    const send = (status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
    if (!token) { send(503, { error: "Little Log bridge is not configured." }); return true; }
    const auth = req.headers.authorization;
    if (typeof auth !== "string" || !timingSafeEqual(hash(auth), hash(`Bearer ${token}`))) {
      send(401, { error: "A Littlepottchi bridge credential is required." }); return true;
    } // A separate server credential grants this narrow bridge API; browser sessions and report tokens do not.
    try {
      const path = url.pathname.slice("/littlepottchi/integration/v1/".length);
      if (req.method === "GET" && path === "events") {
        const after = Number(url.searchParams.get("after") || 0), limit = Number(url.searchParams.get("limit") || 50);
        if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new GachaError("Invalid reminder page.");
        doll.tick();
        send(200, doll.care.events(user => doll.identity?.(user), user => doll.player(user), after, limit)); return true;
      }
      if (req.method === "POST" && ["analysis", "events/ack"].includes(path)) {
        if (req.headers["content-type"]?.split(";")[0] !== "application/json") throw new GachaError("Use a JSON request.");
        let size = 0; const chunks = [];
        for await (const chunk of req) { size += chunk.length; if (size > 262144) throw new GachaError("Bridge request is too large."); chunks.push(chunk); }
        let body; try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new GachaError("Invalid bridge JSON."); }
        send(200, path === "analysis" ? doll.care.importAnalysis(body) : doll.care.ack(body?.ids)); return true;
      }
      send(404, { error: "Unknown bridge endpoint." });
    } catch (error) { send(error instanceof GachaError ? 400 : 503, { error: error instanceof GachaError ? error.message : "Pet bridge temporarily unavailable." }); }
    return true;
  }; // The feed exposes fixed game messages and verified recipient keys, never inventory, wallets or raw records.
}
