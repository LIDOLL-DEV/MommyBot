import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { ReportClient, ReportConfigurationError, reportConfig } from "../src/reports/client.js";
import { ReportStore } from "../src/reports/store.js";
import { createReportPublisher, reportMessage } from "../src/reports/publisher.js";

const config = { url: "https://tracker.example/tracker/api/ai-reports/v1/reports", token: "secret", channelId: "1549134762172481557", initial: "history", interval: 60000 };
const makeReport = cursor => ({ cursor, id: `report-${cursor}`, day: "2026-09-14", source: "daily", format: "markdown", document: "# Nightly\n@everyone " + "Long report text. ".repeat(1000), incomplete: false });
const page = (reports, after = 0, more = false, latest = reports.at(-1)?.cursor ?? after) => ({ reports, next_cursor: reports.at(-1)?.cursor ?? after, latest_cursor: latest, has_more: more });

function fixture(t, options = {}) {
  const store = options.store || new ReportStore(":memory:");
  const logs = [], sends = [], messages = new Map(), reads = [];
  const reports = options.reports || [makeReport(2), makeReport(7)];
  const channel = { guildId: "guild", isTextBased: () => true, messages: { fetch: async () => messages }, send: async payload => {
    sends.push(payload);
    const id = String(1549134762172481600n + BigInt(sends.length));
    messages.set(id, { id, author: { id: "bot" }, content: payload.content, attachments: new Map([["file", { name: payload.files[0].name }]]), createdTimestamp: Date.now() });
    return { id };
  } };
  const api = options.api || { list: async after => { reads.push(after); return page(reports.filter(r => r.cursor > after), after); }, document: async report => report };
  const publisher = createReportPublisher({ user: { id: "bot" }, channels: { fetch: async () => channel } }, { config: { ...config, ...options.config }, store, api, logger: { log: line => logs.push(line), error: line => logs.push(line) } });
  t.after(() => publisher.stop());
  return { store, publisher, channel, logs, sends, messages, reads };
} // Use only disposable journals and fake Discord/API clients; tests never post live messages.

test("configuration requires explicit activation, destination and initial history policy", () => {
  assert.equal(reportConfig({}), null);
  const env = { MOMMYBOT_REPORTS_ENABLED: "true", MOMMYBOT_REPORTS_URL: config.url, MOMMYBOT_REPORTS_TOKEN: "secret", MOMMYBOT_REPORTS_CHANNEL_ID: config.channelId, MOMMYBOT_REPORTS_INITIAL: "history" };
  assert.equal(reportConfig(env).initial, "history");
  for (const values of [{ MOMMYBOT_REPORTS_INITIAL: "" }, { MOMMYBOT_REPORTS_CHANNEL_ID: "" }, { MOMMYBOT_REPORTS_TOKEN: "" }, { MOMMYBOT_REPORTS_URL: "http://external.example/reports" }, { MOMMYBOT_REPORTS_URL: `${config.url}?token=secret` }, { MOMMYBOT_REPORTS_URL: "https://user:secret@tracker.example/reports" }]) assert.throws(() => reportConfig({ ...env, ...values }), /invalid_configuration/);
});

test("invalid report settings disable only the publisher without accessing Discord or storage", () => {
  const logs = [];
  const env = { MOMMYBOT_REPORTS_ENABLED: "true", MOMMYBOT_REPORTS_URL: "https://private-user:private-password@example.com/reports?secret=private-query", MOMMYBOT_REPORTS_TOKEN: "private token", MOMMYBOT_REPORTS_CHANNEL_ID: "private-channel", MOMMYBOT_REPORTS_INITIAL: "private-policy", MOMMYBOT_REPORTS_POLL_MS: "private-interval" };
  const forbidden = new Proxy({}, { get() { assert.fail("Invalid configuration must not access Discord or journal storage"); } });
  assert.equal(createReportPublisher(forbidden, { env, store: forbidden, logger: { error: line => logs.push(line) } }), null);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /MommyBot will continue starting/);
  for (const field of ["URL", "TOKEN", "CHANNEL_ID", "INITIAL", "POLL_MS"]) assert.ok(logs[0].includes(`MOMMYBOT_REPORTS_${field}`));
  assert.ok(!logs[0].includes("private"));
  assert.equal(createReportPublisher(forbidden, { env: {}, store: forbidden, logger: { error() { assert.fail("Disabled reports should stay silent"); } } }), null);
});

test("configuration identifies the exact invalid field without echoing its value", () => {
  const env = { MOMMYBOT_REPORTS_ENABLED: "true", MOMMYBOT_REPORTS_URL: config.url, MOMMYBOT_REPORTS_TOKEN: "secret", MOMMYBOT_REPORTS_CHANNEL_ID: config.channelId, MOMMYBOT_REPORTS_INITIAL: "history" };
  for (const [field, value] of [["URL", "secret-invalid-url"], ["URL", "http://203.0.113.5/reports"], ["TOKEN", "secret token"], ["CHANNEL_ID", "secret-channel"], ["INITIAL", "secret-policy"], ["POLL_MS", "9999"]]) {
    assert.throws(() => reportConfig({ ...env, [`MOMMYBOT_REPORTS_${field}`]: value }), error => {
      assert.ok(error instanceof ReportConfigurationError);
      assert.equal(error.code, "invalid_configuration");
      assert.match(error.message, new RegExp(`MOMMYBOT_REPORTS_${field}`));
      assert.ok(!error.message.includes(value));
      assert.equal((error.message.match(/MOMMYBOT_REPORTS_/g) || []).length, 1);
      return true;
    });
  }
});

test("production report configuration permits direct LAN HTTP without enabling public HTTP", () => {
  const env = { NODE_ENV: "production", MOMMYBOT_REPORTS_ENABLED: "true", MOMMYBOT_REPORTS_TOKEN: "secret", MOMMYBOT_REPORTS_CHANNEL_ID: config.channelId, MOMMYBOT_REPORTS_INITIAL: "history" };
  for (const host of ["10.1.1.23", "10.255.255.255", "172.16.0.1", "172.31.255.254", "192.168.1.5", "localhost", "127.0.0.1", "127.0.0.2", "[::1]"]) {
    const url = `http://${host}:4173/tracker/api/ai-reports/v1/reports`;
    assert.equal(reportConfig({ ...env, MOMMYBOT_REPORTS_URL: url }).url, url);
  }
  for (const url of ["http://172.15.0.1/reports", "http://172.32.0.1/reports", "http://192.169.0.1/reports", "http://11.0.0.1/reports", "http://example.com/reports", "http://10.1.1.23.example.com/reports", "http://169.254.169.254/reports", "ftp://10.1.1.23/reports", "http://user:secret@10.1.1.23/reports", "http://10.1.1.23/reports?token=secret", "http://10.1.1.23/reports#secret"]) {
    assert.throws(() => reportConfig({ ...env, MOMMYBOT_REPORTS_URL: url }), ReportConfigurationError);
  }
});

test("LAN HTTP configuration reaches both report endpoints and publishes full documents", async t => {
  const configured = reportConfig({ NODE_ENV: "production", MOMMYBOT_REPORTS_ENABLED: "true", MOMMYBOT_REPORTS_URL: "http://10.1.1.23:4173/tracker/api/ai-reports/v1/reports", MOMMYBOT_REPORTS_TOKEN: "secret", MOMMYBOT_REPORTS_CHANNEL_ID: config.channelId, MOMMYBOT_REPORTS_INITIAL: "history" });
  const calls = [], report = makeReport(2);
  const api = new ReportClient(configured, async (url, init) => {
    calls.push({ url, init });
    return { ok: true, json: async () => url.includes("?") ? page([report]) : report };
  });
  const f = fixture(t, { config: configured, api });
  await f.publisher.poll();
  assert.deepEqual(calls.map(call => call.url), [`${configured.url}?after=0&limit=20`, `${configured.url}/report-2`]);
  for (const call of calls) { assert.equal(call.init.redirect, "error"); assert.equal(call.init.headers.Authorization, "Bearer secret"); }
  assert.equal(f.sends.length, 1);
  assert.equal(f.sends[0].files[0].attachment.toString(), report.document);
  assert.equal(f.store.cursor(configured), 2);
});

test("real HTTP reads succeed while redirects never reach their destination", async t => {
  const requests = [], report = makeReport(2);
  const server = createServer((request, response) => {
    requests.push({ url: request.url, auth: request.headers.authorization });
    if (request.url.startsWith("/redirect")) { response.writeHead(302, { Location: "/unexpected-destination" }); response.end(); return; }
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(request.url === "/reports/report-2" ? report : page([report])));
  }); // A local fixture exercises real fetch behavior without contacting a tracker or using real credentials.
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const api = new ReportClient({ ...config, url: `${origin}/reports` });
  assert.equal((await api.list(0)).reports[0].id, report.id);
  assert.equal((await api.document(report)).document, report.document);
  await assert.rejects(new ReportClient({ ...config, url: `${origin}/redirect` }).list(0), /api_unavailable/);
  assert.deepEqual(requests.map(request => request.url), ["/reports?after=0&limit=20", "/reports/report-2", "/redirect?after=0&limit=20"]);
  assert.ok(requests.every(request => request.auth === "Bearer secret"));
});

test("the read-only CLI reports all configuration failures without exposing dotenv secrets", t => {
  const dir = mkdtempSync(path.join(tmpdir(), "mommy-report-config-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const filename = path.join(dir, ".env");
  writeFileSync(filename, 'MOMMYBOT_REPORTS_ENABLED=false\nMOMMYBOT_REPORTS_URL=secret-invalid-url\nMOMMYBOT_REPORTS_TOKEN="secret token"\nMOMMYBOT_REPORTS_CHANNEL_ID=\nMOMMYBOT_REPORTS_INITIAL=\nMOMMYBOT_REPORTS_POLL_MS=oops\n');
  const result = spawnSync(process.execPath, ["scripts/check-reports.mjs", filename], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /FAIL: invalid_configuration/);
  for (const field of ["URL", "TOKEN", "CHANNEL_ID", "INITIAL", "POLL_MS"]) assert.ok(result.stderr.includes(`MOMMYBOT_REPORTS_${field}`));
  assert.ok(!result.stderr.includes("secret"));
  assert.ok(!result.stderr.includes("oops"));
  assert.equal(result.stdout, "");
});

test("API uses bounded authenticated GET without redirects and validates nightly documents", async () => {
  const report = makeReport(3), calls = [];
  const api = new ReportClient(config, async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => url.includes("?") ? page([report]) : report }; });
  assert.equal((await api.list(0)).next_cursor, 3);
  assert.equal((await api.document(report)).document, report.document);
  assert.equal(calls[0].init.redirect, "error");
  assert.equal(calls[0].init.headers.Authorization, "Bearer secret");
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.ok(calls[0].url.endsWith("?after=0&limit=20"));
  for (const bad of [page([{ ...report, source: "manual" }]), page([report, report]), { ...page([report]), next_cursor: 10 }, page([], 0, true), { ...page([report]), latest_cursor: 0 }]) {
    await assert.rejects(new ReportClient(config, async () => ({ ok: true, json: async () => bad })).list(0), /invalid_feed/);
  }
  await assert.rejects(new ReportClient(config, async () => ({ ok: true, json: async () => ({ ...report, id: "different" }) })).document(report), /invalid_document/);
  await assert.rejects(new ReportClient(config, async () => { throw new Error("secret provider body"); }).list(0), /^Error: api_unavailable$/);
});

test("historical reports send full attachments once, with mentions disabled", async t => {
  const f = fixture(t);
  await f.publisher.poll(); await f.publisher.poll();
  assert.equal(f.sends.length, 2);
  assert.equal(f.store.cursor(config), 7);
  assert.equal(f.sends[0].files[0].attachment.toString(), makeReport(2).document);
  assert.deepEqual(f.sends[0].allowedMentions.parse, []);
  assert.ok(!f.sends[0].content.includes("@everyone"));
  assert.equal(f.sends[0].enforceNonce, true);
  assert.match(reportMessage(config, { ...makeReport(3), incomplete: true }).content, /may be incomplete/);
});

test("future-only initialization skips history once then picks up late completions", async t => {
  const reports = [makeReport(5)], f = fixture(t, { reports, config: { initial: "future" } });
  await f.publisher.poll(); assert.equal(f.sends.length, 0);
  reports.push(makeReport(9)); await f.publisher.poll();
  assert.equal(f.sends.length, 1); assert.equal(f.store.cursor(config), 9);
});

test("pagination follows delivered cursors rather than the feed latest cursor", async t => {
  const reads = [];
  const api = { list: async after => { reads.push(after); return after === 0 ? page([makeReport(2)], 0, true, 99) : page([makeReport(99)], after); }, document: async r => r };
  const f = fixture(t, { api }); await f.publisher.poll();
  assert.deepEqual(reads, [0, 2]); assert.equal(f.sends.length, 2);
});

test("401/403 halt publication until restart and sanitize provider errors", async t => {
  for (const status of [401, 403]) {
    let calls = 0;
    const api = new ReportClient(config, async () => { calls++; return { ok: false, status, json: async () => ({ secret: "provider-body" }) }; });
    const f = fixture(t, { api }); await f.publisher.poll(); await f.publisher.poll();
    assert.equal(calls, 1); assert.equal(f.sends.length, 0); assert.equal(f.store.cursor(config), undefined);
    assert.ok(f.logs.some(line => line.includes("access_denied"))); assert.ok(!f.logs.join().includes("provider-body"));
  }
});

test("transient document failures preserve the cursor for the next poll", async t => {
  let failed = false;
  const f = fixture(t, { api: { list: async after => page(after ? [] : [makeReport(2)], after), document: async r => { if (!failed) { failed = true; throw new Error("token-secret"); } return r; } } });
  await f.publisher.poll(); assert.equal(f.store.cursor(config), 0);
  await f.publisher.poll(); assert.equal(f.sends.length, 1); assert.equal(f.store.cursor(config), 2);
  assert.ok(!f.logs.join().includes("token-secret"));
});

test("uncertain sends reconcile the saved Discord message without resending", async t => {
  const f = fixture(t, { reports: [makeReport(2)] }), send = f.channel.send;
  f.channel.send = async payload => { await send(payload); throw new Error("response lost"); };
  await f.publisher.poll(); assert.equal(f.store.cursor(config), 0);
  await f.publisher.poll(); assert.equal(f.sends.length, 1); assert.equal(f.store.cursor(config), 2);
  assert.ok(f.store.get(config, "report-2").message_id);
});

test("missing or forged reconciliation evidence blocks automatic resend", async t => {
  const f = fixture(t, { reports: [makeReport(2)] });
  let attempts = 0;
  f.channel.send = async () => { attempts++; throw new Error("uncertain"); };
  await f.publisher.poll();
  const payload = reportMessage(config, makeReport(2));
  f.messages.set("forged", { author: { id: "other" }, content: payload.content, createdTimestamp: Date.now(), attachments: new Map([["file", { name: payload.files[0].name }]]) });
  await f.publisher.poll(); await f.publisher.poll();
  assert.equal(attempts, 1); assert.equal(f.store.cursor(config), 0);
  assert.ok(f.logs.some(line => line.includes("delivery_uncertain")));
});

test("restart preserves snapshots and receipts; destinations have separate cursors", async t => {
  const dir = mkdtempSync(path.join(tmpdir(), "mommy-reports-")), filename = path.join(dir, "reports.db");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let store = new ReportStore(filename);
  store.initialize(config, 0);
  const record = store.prepare(config, makeReport(2));
  store.attempt(config, record.id, Date.now()); store.close();
  store = new ReportStore(filename);
  assert.ok(store.pending(config).attempted);
  store.complete(config, record, "1549134762172481601"); store.close();
  store = new ReportStore(filename);
  assert.equal(store.cursor(config), 2); assert.equal(store.pending(config), undefined);
  assert.equal(store.cursor({ ...config, channelId: "1549134762172481558" }), undefined);
  store.close();
});

test("overlapping polls coalesce and shutdown drains a pending Discord receipt", async () => {
  let release, sending;
  const started = new Promise(resolve => { sending = resolve; });
  const store = new ReportStore(":memory:"); let closed = false;
  const close = store.close.bind(store); store.close = () => { closed = true; close(); };
  const publisher = createReportPublisher({ user: { id: "bot" }, channels: { fetch: async () => ({ guildId: "guild", isTextBased: () => true, messages: { fetch() {} }, send: async () => { sending(); return new Promise(resolve => { release = resolve; }); } }) } }, { config, store, api: { list: async () => page([makeReport(2)]), document: async r => r } });
  const first = publisher.poll(); assert.equal(publisher.poll(), first);
  await started;
  const stopping = publisher.stop(); assert.equal(closed, false);
  release({ id: "1549134762172481601" }); await stopping; assert.equal(closed, true);
  await publisher.poll();
});

test("a restarted publisher reconciles a saved attempt before advancing the feed", async t => {
  const dir = mkdtempSync(path.join(tmpdir(), "mommy-report-recovery-"));
  const filename = path.join(dir, "reports.db");
  let store = new ReportStore(filename);
  store.initialize(config, 0); store.prepare(config, makeReport(2));
  store.attempt(config, "report-2", Date.now()); store.close();
  store = new ReportStore(filename);
  const f = fixture(t, { store, reports: [makeReport(2)] });
  const payload = reportMessage(config, makeReport(2));
  const id = "1549134762172481601";
  f.messages.set(id, { id, author: { id: "bot" }, content: payload.content, attachments: new Map([["file", { name: payload.files[0].name }]]), createdTimestamp: Date.now() });
  await f.publisher.poll();
  assert.equal(f.sends.length, 0); assert.equal(store.cursor(config), 2);
  assert.equal(store.get(config, "report-2").message_id, id);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
});

test("a changed feed cannot deliver an existing pending document", async t => {
  const f = fixture(t, { config: { url: "https://other.example/reports" } });
  f.store.initialize(config, 0); f.store.prepare(config, makeReport(2));
  await f.publisher.poll();
  assert.equal(f.sends.length, 0);
  assert.ok(f.logs.some(line => line.includes("pending_feed_changed")));
});

test("revoked API access also blocks publishing an already-saved document", async t => {
  const api = new ReportClient(config, async () => ({ ok: false, status: 403 }));
  const f = fixture(t, { api });
  f.store.initialize(config, 0); f.store.prepare(config, makeReport(2));
  await f.publisher.poll();
  assert.equal(f.sends.length, 0); assert.equal(f.store.cursor(config), 0);
});
