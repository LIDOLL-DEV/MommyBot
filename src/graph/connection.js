const NETWORK_CODES = new Set(["ECONNREFUSED", "ETIMEDOUT", "ENETUNREACH", "EHOSTUNREACH", "ENOTFOUND", "EAI_AGAIN", "ECONNRESET", "UND_ERR_CONNECT_TIMEOUT", "CERT_HAS_EXPIRED", "ERR_TLS_CERT_ALTNAME_INVALID"]);

export function modelEndpoint(role, env = process.env) {
  const key = role === "router" ? "ROUTER_LAMA_URL" : "LLAMA_BASE_URL";
  const fallback = role === "router" ? "http://192.168.1.250:9091/v1" : "http://192.168.1.250:9090/v1";
  try {
    const url = new URL(env[key]?.trim() || fallback);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("Invalid URL");
    return url.href.replace(/\/+$/, "");
  } catch { throw new Error(`Set ${key} to the model server's HTTP(S) base URL, including /v1, without embedded credentials or query parameters.`); }
} // Resolve the same endpoint for chat, startup diagnostics and deployment probes, tolerating a trailing slash.

export function modelFailure(error) {
  if (error.code === "EMPTY_MODEL_RESPONSE") return error.message;
  if (Number.isInteger(error.status)) return `HTTP ${error.status}`;
  const queue = [error], seen = new Set(), codes = new Set();
  for (let count = 0; queue.length && count < 32; count++) {
    const item = queue.shift();
    if (!item || seen.has(item)) continue;
    seen.add(item);
    if (NETWORK_CODES.has(item.code)) codes.add(item.code);
    if (["AbortError", "TimeoutError"].includes(item.name)) codes.add("REQUEST_TIMEOUT");
    if (item.cause) queue.push(item.cause);
    if (Array.isArray(item.errors)) queue.push(...item.errors.slice(0, 8));
  }
  return [...codes].join(", ") || (error instanceof SyntaxError ? "INVALID_JSON_RESPONSE" : "REQUEST_FAILED");
} // Surface Node's nested connection errors without logging provider bodies, credentials or arbitrary exception text.

export async function checkModelEndpoints(env = process.env, fetcher = fetch) {
  return Promise.all(["chat", "router"].map(async role => {
    let endpoint;
    try {
      endpoint = modelEndpoint(role, env);
      const response = await fetcher(`${endpoint}/models`, { signal: AbortSignal.timeout(5000), redirect: "error" });
      if (!response.ok) return { role, endpoint, ok: false, detail: `HTTP ${response.status}` };
      const data = await response.json();
      if (!Array.isArray(data.data) || !data.data.length || !data.data.every(model => typeof model.id === "string")) {
        return { role, endpoint, ok: false, detail: "No valid model list; check the /v1 API path and loaded model." };
      }
      return { role, endpoint, ok: true, detail: "Model list reachable; inference was not tested." };
    } catch (error) {
      return { role, endpoint: endpoint || "invalid configuration", ok: false, detail: endpoint ? modelFailure(error) : "Check the configured HTTP(S) model base URL." };
    }
  }));
} // Probe both servers concurrently with bounded, read-only requests; do not send conversation history or generate replies.

export async function reportModelEndpoints(env = process.env, logger = console, fetcher = fetch) {
  const results = await checkModelEndpoints(env, fetcher);
  for (const result of results) {
    logger[result.ok ? "log" : "error"](`[Brain] ${result.role}: ${result.endpoint} — ${result.ok ? "PASS" : "FAIL"}: ${result.detail}`);
  }
  return results.every(result => result.ok);
} // Make a successful Discord login visibly distinct from a reachable model server.
