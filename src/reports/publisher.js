import { createHash } from "node:crypto";
import { ReportClient, ReportConfigurationError, ReportError, reportConfig } from "./client.js";
import { ReportStore } from "./store.js";

export function reportMessage(config, report) {
  const marker = createHash("sha256").update(JSON.stringify([config.url, config.channelId, report.id])).digest("hex");
  return {
    content: `Little Log ${report.source === "manual" ? "requested" : "nightly"} report — ${report.day}\nReport ID: ${report.id}\nModel-authored report${report.incomplete ? " — may be incomplete (output limit reached)" : ""}.\nDelivery: ${marker}`,
    files: [{ attachment: Buffer.from(report.document, "utf8"), name: `little-log-${report.day}-${report.id}.md` }],
    allowedMentions: { parse: [], users: [], roles: [], repliedUser: false },
    nonce: marker.slice(0, 24), enforceNonce: true,
  };
} // Attach the complete document without truncation and keep generated text out of the message/mention surface.

export function createReportPublisher(client, { env = process.env, config, store, api, now = Date.now, logger = console } = {}) {
  try { if (config === undefined) config = reportConfig(env); }
  catch (error) {
    if (!(error instanceof ReportConfigurationError)) throw error;
    logger.error(`[Reports] Publication disabled: ${error.message}. Fix the protected report settings and restart; MommyBot will continue starting.`);
    return null;
  } // A misconfigured optional publisher must not stop Discord login or touch its saved delivery journal.
  if (!config) return null;
  store ??= new ReportStore(config.filename);
  api ??= new ReportClient(config);
  let stopped = false, halted = false, active = null, timer = null;

  async function reconcile(channel, record, payload) {
    let before;
    for (let page = 0; page < 10 && !stopped; page++) {
      const messages = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}), cache: false });
      const rows = [...messages.values()];
      const match = rows.find(message => message.author?.id === client.user.id && message.content === payload.content && [...(message.attachments?.values() || [])].some(file => file.name === payload.files[0].name));
      if (match) return match.id;
      if (!rows.length || rows.length < 100 || rows.some(message => message.createdTimestamp < record.attempted - 60000)) return null;
      const oldest = rows.reduce((left, right) => BigInt(left.id) < BigInt(right.id) ? left : right);
      if (oldest.id === before) return null;
      before = oldest.id;
    }
    return null;
  } // Recover lost Discord receipts by exact bot-authored marker and attachment; absence never proves a send failed.

  async function deliver(record) {
    if (record.url !== config.url) throw new ReportError("pending_feed_changed");
    const channel = await client.channels.fetch(config.channelId);
    if (!channel?.guildId || !channel.isTextBased?.() || typeof channel.send !== "function" || !channel.messages?.fetch) throw new ReportError("invalid_channel");
    if (stopped) return false;
    const payload = reportMessage(config, JSON.parse(record.payload));
    if (record.attempted !== null) {
      const messageId = await reconcile(channel, record, payload);
      if (!messageId) throw new ReportError("delivery_uncertain");
      store.complete(config, record, messageId);
      return true;
    }
    if (stopped) return false;
    store.attempt(config, record.id, now()); // A crash from this point forward must reconcile before another send.
    const message = await channel.send(payload);
    if (!/^\d{17,20}$/.test(message?.id || "")) throw new ReportError("delivery_uncertain");
    store.complete(config, record, message.id);
    return true;
  } // Pin delivery to the configured guild channel and journal every send before crossing the network.

  async function run() {
    let cursor = store.cursor(config);
    const pending = store.pending(config);
    if (pending && pending.url !== config.url) throw new ReportError("pending_feed_changed");
    const page = await api.list(cursor ?? 0); // Recheck token access even when recovering a saved document.
    if (stopped) return;
    if (cursor === undefined) {
      cursor = config.initial === "future" ? page.latest_cursor : 0;
      store.initialize(config, cursor);
      if (config.initial === "future") return;
    }
    if (pending && !await deliver(pending)) return;
    let current = pending ? await api.list(store.cursor(config)) : page;
    for (let pages = 0; pages < 10 && !stopped; pages++) {
      for (const report of current.reports) {
        if (stopped) return;
        let record = store.get(config, report.id);
        if (record?.url && record.url !== config.url) throw new ReportError("report_feed_changed");
        if (record?.message_id) { store.advance(config, report.cursor); continue; }
        if (!record) {
          const document = await api.document(report);
          if (stopped) return;
          record = store.prepare(config, document);
        }
        if (!await deliver(record)) return;
      }
      if (!current.has_more || stopped || pages === 9) return;
      current = await api.list(store.cursor(config)); // Never jump to latest_cursor during normal pagination.
    }
  } // Bound each poll's work while preserving unread pages and late-completing jobs for subsequent polls.

  function poll() {
    if (stopped || halted) return Promise.resolve();
    if (active) return active;
    active = run().catch(error => {
      if (error instanceof ReportError && error.code === "access_denied") halted = true;
      const code = error instanceof ReportError ? error.code : "publication_failed";
      logger.error(`[Reports] ${code}${error instanceof ReportError && error.status ? ` (HTTP ${error.status})` : ""}. See NIGHTLY_REPORTS_GUIDE.md; cursor retained.`);
    }).finally(() => { active = null; });
    return active;
  } // Coalesce overlapping polls and log only controlled diagnostic codes, never report prose or secrets.

  return {
    poll,
    start() {
      if (timer || stopped || halted) return;
      logger.log("[Reports] Nightly and explicitly shared report publisher enabled.");
      void poll(); timer = setInterval(() => { void poll(); }, config.interval); timer.unref?.();
    },
    async stop() { stopped = true; clearInterval(timer); await active; store.close(); },
  }; // Drain in-flight work before closing the journal or destroying Discord.
}
