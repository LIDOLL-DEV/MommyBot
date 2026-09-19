import { isIP } from "node:net";

export class PetEventError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
} // Keep provider bodies and the bridge credential out of diagnostic errors.

export class PetEventConfigurationError extends PetEventError {
  constructor(issues) {
    super("invalid_configuration");
    this.message = `invalid_configuration: ${issues.join("; ")}`;
  }
} // Configuration diagnostics name only authored fields and requirements, never environment values.

const ACCIDENT_KINDS = ["wet", "mess", "leak"];
const EVENT_KINDS = [...ACCIDENT_KINDS, "cleanup", "feed", "water", "play", "rest", "complete"];
export { ACCIDENT_KINDS };

function privatePetHost(host) {
  if (["localhost", "[::1]"].includes(host)) return true;
  if (isIP(host) !== 4) return false;
  const [first, second] = host.split(".").map(Number);
  return first === 127 || first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
} // Match the wallet and report policy: allow explicitly configured loopback or RFC1918 IPv4 HTTP endpoints.

export function petEventConfig(env = process.env) {
  if (env.DIAPER_CHECKS_ENABLED !== "true") return null;
  const issues = [];
  let url;
  try { url = new URL(env.LITTLEPOTTCHI_API_URL); }
  catch { issues.push("LITTLEPOTTCHI_API_URL must be the Littlepottchi integration API URL ending in /littlepottchi/integration/v1/"); }
  if (url) {
    if (url.protocol !== "https:" && !(privatePetHost(url.hostname) && url.protocol === "http:")) issues.push("LITTLEPOTTCHI_API_URL requires HTTPS or HTTP to localhost, a loopback address or a private IPv4 address");
    if (url.username || url.password || url.search || url.hash) issues.push("LITTLEPOTTCHI_API_URL must not contain credentials, a query string or a fragment");
    if (!url.pathname.endsWith("/littlepottchi/integration/v1/")) issues.push("LITTLEPOTTCHI_API_URL must end with /littlepottchi/integration/v1/");
  }
  const token = env.LITTLEPOTTCHI_BRIDGE_TOKEN?.trim();
  if (!token || token.length < 32 || token.length > 512 || /\s/.test(token)) issues.push("LITTLEPOTTCHI_BRIDGE_TOKEN must contain the 32-512 character bridge token without internal whitespace");
  const interval = Number(env.DIAPER_CHECKS_POLL_MS || 60000);
  if (!Number.isSafeInteger(interval) || interval < 10000 || interval > 3600000) issues.push("DIAPER_CHECKS_POLL_MS must be an integer from 10000 to 3600000");
  if (issues.length) throw new PetEventConfigurationError(issues); // Report every invalid field in one pass so operators repair the protected configuration together.
  return { url: url.href, token, interval, filename: env.DIAPER_CHECKS_DB || "data/diaperchecks.db" };
} // Require the same bridge endpoint and credential Little Log already issues for its own notification bridge.

function validEvent(event, now) {
  return Boolean(event) && typeof event.id === "string" && /^[\w-]{36}$/.test(event.id) &&
    Number.isSafeInteger(event.sequence) && event.sequence >= 0 &&
    Number.isSafeInteger(event.created) && Number.isSafeInteger(event.expires) && event.expires > now &&
    EVENT_KINDS.includes(event.kind) &&
    typeof event.recipient?.issuer === "string" && Boolean(event.recipient.issuer) &&
    typeof event.recipient?.subject === "string" && Boolean(event.recipient.subject);
} // Accept only the documented event shape and a live identity binding; an expired or malformed row is never acted on.

export class PetEventClient {
  constructor(config, fetchImpl = fetch) { this.config = config; this.fetch = fetchImpl; }
  async page(after, limit = 50) {
    const url = new URL("events", this.config.url);
    url.searchParams.set("after", String(after));
    url.searchParams.set("limit", String(limit));
    let response;
    try {
      response = await this.fetch(url.href, { headers: { Authorization: `Bearer ${this.config.token}`, Accept: "application/json" },
        redirect: "error", signal: AbortSignal.timeout(15000) });
    } catch { throw new PetEventError("api_unavailable"); }
    if (!response.ok) throw new PetEventError([401, 403].includes(response.status) ? "access_denied" : "api_http_error", response.status);
    let page;
    try { page = await response.json(); } catch { throw new PetEventError("invalid_feed"); }
    if (!page || !Array.isArray(page.events) || page.events.length > limit || typeof page.more !== "boolean" ||
        !Number.isSafeInteger(page.nextAfter) || page.nextAfter < after) throw new PetEventError("invalid_feed");
    return page;
  } // Read the feed with bounded GETs only; the credential never follows a redirect and no acknowledgement is ever sent.

  async accidents(after, now = Date.now(), limit = 50) {
    const page = await this.page(after, limit);
    return { nextAfter: page.nextAfter, more: page.more,
      events: page.events.filter(event => validEvent(event, now) && ACCIDENT_KINDS.includes(event.kind))
        .map(event => ({ id: event.id, sequence: event.sequence, kind: event.kind, created: event.created, expires: event.expires,
          issuer: event.recipient.issuer, subject: event.recipient.subject })) };
  } // Keep only live accident events and the fields a check needs; titles, bodies and care events are discarded unread.
} // MommyBot reads this feed without acknowledging it, so Little Log's own push bridge keeps its full delivery queue.
