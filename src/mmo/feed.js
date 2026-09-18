import { modelFailure } from "../graph/connection.js";

export class OnlineError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export function onlineFailure(error, stage = "feed") {
  if (error instanceof OnlineError) return `${error.code}: ${error.message}`;
  if (Number.isInteger(error?.code)) return `${stage}: Discord error ${error.code}; check channel access and permissions.`;
  if (error?.code?.startsWith?.("SQLITE")) return `${stage}: saved progress is unavailable; check data directory permissions.`;
  return `${stage}: ${modelFailure(error)}; check the configured server address, port, firewall and service logs.`;
} // Emit controlled diagnostic codes, never remote response bodies, secrets or arbitrary exception messages.

export async function onlinePage(config, after, fetcher = fetch) {
  const url = new URL(config.url); url.searchParams.set("after", after); url.searchParams.set("limit", "20");
  const response = await fetcher(url, { headers: { Authorization: `Bearer ${config.token}`, Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(10000) });
  if (!response.ok) {
    const hints = { 401: "Shared secret rejected. Set the same MOMMYBOT_ONLINE_TOKEN on both services and restart both.",
      403: "Feed access denied. Check reverse-proxy restrictions and use the direct game-server address.",
      404: "Join endpoint missing. Deploy the updated LiDollQuest server and use port 4191, not MommyBot or the tracker.",
      503: "Feed disabled or service unavailable. Set MOMMYBOT_ONLINE_TOKEN on LiDollQuest server and check its logs." };
    throw new OnlineError(`feed_http_${response.status}`, hints[response.status] || "Game feed returned an HTTP error; check the game server and proxy logs.");
  }
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > 65536) throw new OnlineError("feed_too_large", "Expected the bounded join feed, not a web page."); chunks.push(Buffer.from(chunk)); }
  let result;
  try { result = JSON.parse(Buffer.concat(chunks)); }
  catch { throw new OnlineError("feed_invalid_json", "Expected JSON from /integrations/mommybot/joins; check the URL and proxy."); }
  const invalid = () => new OnlineError("feed_invalid_data", "Join feed has an unexpected format. Check the URL and deployed game-server version.");
  if (!result || !/^[a-f0-9-]{36}$/.test(result.stream) || !Array.isArray(result.events) || result.events.length > 20 || typeof result.has_more !== "boolean" || !Number.isSafeInteger(result.latest_cursor) || result.latest_cursor < 0 || !Number.isSafeInteger(result.next_cursor)) throw invalid();
  let previous = after;
  for (const event of result.events) {
    if (!Number.isSafeInteger(event.id) || event.id <= previous || event.id > result.latest_cursor || typeof event.name !== "string" || !event.name.trim() || event.name.length > 80 || !Number.isSafeInteger(event.joined_at) || event.joined_at < 0 || ![0, 1].includes(event.online)) throw invalid();
    previous = event.id;
  }
  if (result.events.length && result.next_cursor !== previous || result.has_more && !result.events.length) throw invalid();
  return result;
} // Share identical read-only transport and validation between the live publisher and the operator's check script.
