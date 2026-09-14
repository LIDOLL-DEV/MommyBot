export class ReportError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
} // Keep provider bodies and credentials out of diagnostic errors.

export class ReportConfigurationError extends ReportError {
  constructor(issues) {
    super("invalid_configuration");
    this.message = `invalid_configuration: ${issues.join("; ")}`;
  }
} // Configuration diagnostics contain only authored field names and requirements, never environment values.

export function reportConfig(env = process.env) {
  if (env.MOMMYBOT_REPORTS_ENABLED !== "true") return null;
  const issues = [];
  let url;
  try { url = new URL(env.MOMMYBOT_REPORTS_URL); }
  catch { issues.push("MOMMYBOT_REPORTS_URL must be the full report feed URL from the tracker admin console"); }
  if (url) {
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) issues.push("MOMMYBOT_REPORTS_URL requires HTTPS (HTTP is allowed only for localhost development)");
    if (url.username || url.password || url.search || url.hash) issues.push("MOMMYBOT_REPORTS_URL must not contain credentials, a query string or a fragment");
  }
  const token = env.MOMMYBOT_REPORTS_TOKEN?.trim();
  const channelId = env.MOMMYBOT_REPORTS_CHANNEL_ID;
  const initial = env.MOMMYBOT_REPORTS_INITIAL;
  const interval = Number(env.MOMMYBOT_REPORTS_POLL_MS || 60000);
  if (!token || /\s/.test(token)) issues.push("MOMMYBOT_REPORTS_TOKEN must contain a report-read token without internal whitespace");
  if (!/^\d{17,20}$/.test(channelId || "")) issues.push("MOMMYBOT_REPORTS_CHANNEL_ID must contain a 17-20 digit Discord channel ID");
  if (!["future", "history"].includes(initial)) issues.push("MOMMYBOT_REPORTS_INITIAL must explicitly be history or future");
  if (!Number.isSafeInteger(interval) || interval < 10000 || interval > 3600000) issues.push("MOMMYBOT_REPORTS_POLL_MS must be an integer from 10000 to 3600000");
  if (issues.length) throw new ReportConfigurationError(issues); // Report all invalid fields in one pass so operators can repair the protected configuration together.
  return { url: url.href.replace(/\/$/, ""), token, channelId, initial, interval, filename: env.MOMMYBOT_REPORTS_DB || "data/reports.db" };
} // Require an explicit destination and first-run policy before enabling publication.

function metadata(report) {
  return report && Number.isSafeInteger(report.cursor) && report.cursor > 0 &&
    typeof report.id === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(report.id) &&
    /^\d{4}-\d{2}-\d{2}$/.test(report.day) && report.source === "daily";
} // Reject malformed or non-nightly records before they can reach Discord.

export class ReportClient {
  constructor(config, fetchImpl = fetch) { this.config = config; this.fetch = fetchImpl; }
  async request(url) {
    try {
      const response = await this.fetch(url, { headers: { Authorization: `Bearer ${this.config.token}`, Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new ReportError([401, 403].includes(response.status) ? "access_denied" : "api_http_error", response.status);
      return await response.json();
    } catch (error) {
      if (error instanceof ReportError) throw error;
      throw new ReportError("api_unavailable");
    }
  } // Only use bounded GET requests, never follow a redirect with the report token.
  async list(after, limit = 20) {
    const url = new URL(this.config.url);
    url.searchParams.set("after", after); url.searchParams.set("limit", limit);
    const page = await this.request(url.href);
    let previous = after;
    if (!page || !Array.isArray(page.reports) || page.reports.length > limit || typeof page.has_more !== "boolean" || !Number.isSafeInteger(page.latest_cursor) || page.latest_cursor < after) throw new ReportError("invalid_feed");
    for (const report of page.reports) {
      if (!metadata(report) || report.cursor <= previous) throw new ReportError("invalid_feed");
      previous = report.cursor;
    }
    if (page.next_cursor !== previous || page.latest_cursor < previous || (page.has_more && !page.reports.length)) throw new ReportError("invalid_feed");
    return page;
  } // Validate ascending completion cursors while allowing legitimate gaps.
  async document(report) {
    const result = await this.request(`${this.config.url}/${encodeURIComponent(report.id)}`);
    if (!metadata(result) || result.id !== report.id || result.cursor !== report.cursor || result.day !== report.day || result.format !== "markdown" || typeof result.document !== "string" || !result.document.trim() || typeof result.incomplete !== "boolean") throw new ReportError("invalid_document");
    return result;
  } // Bind the full Markdown response to the exact listed report before journaling it.
}
