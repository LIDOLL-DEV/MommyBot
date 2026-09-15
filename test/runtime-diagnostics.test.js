import assert from "node:assert/strict";
import test from "node:test";
import { HumanMessage } from "@langchain/core/messages";
import { checkModelEndpoints, modelEndpoint, modelFailure, reportModelEndpoints } from "../src/graph/connection.js";
import { routerNode, sakuraLLMNode } from "../src/graph/nodes.js";
import { swearJarStatus } from "../src/swearJar.js";

test("model URLs normalize trailing slashes and reject malformed or credential-bearing configuration", () => {
  assert.equal(modelEndpoint("chat", { LLAMA_BASE_URL: " http://models.example:9090/v1/ " }), "http://models.example:9090/v1");
  assert.equal(modelEndpoint("router", { ROUTER_LAMA_URL: "http://router.example/v1" }), "http://router.example/v1");
  assert.equal(modelEndpoint("chat", {}), "http://192.168.1.250:9090/v1");
  for (const value of ["invalid", "file:///private", "http://user:PRIVATE@models.example/v1", "https://models.example/v1?token=PRIVATE"]) {
    assert.throws(() => modelEndpoint("chat", { LLAMA_BASE_URL: value }), error => /LLAMA_BASE_URL/.test(error.message) && !error.message.includes("PRIVATE"));
  }
});

test("nested transport errors show actionable codes without leaking raw error messages", () => {
  const cause = new AggregateError([Object.assign(new Error("PRIVATE"), { code: "ENETUNREACH" }), Object.assign(new Error("PRIVATE"), { code: "ETIMEDOUT" })]);
  assert.equal(modelFailure(new TypeError("fetch failed", { cause })), "ENETUNREACH, ETIMEDOUT");
  assert.equal(modelFailure(new Error("PRIVATE", { cause: Object.assign(new Error(), { code: "UND_ERR_CONNECT_TIMEOUT" }) })), "UND_ERR_CONNECT_TIMEOUT");
  assert.equal(modelFailure(new DOMException("PRIVATE", "TimeoutError")), "REQUEST_TIMEOUT");
  assert.equal(modelFailure(Object.assign(new Error("PRIVATE"), { status: 503 })), "HTTP 503");
  assert.equal(modelFailure(new Error("PRIVATE")), "REQUEST_FAILED");
});

test("runtime probes use bounded read-only requests and report independent model-server failures", async () => {
  const calls = [];
  const results = await checkModelEndpoints({}, async (url, options) => {
    calls.push({ url, options });
    if (url.includes(":9091")) throw new Error("PRIVATE", { cause: Object.assign(new Error(), { code: "ECONNREFUSED" }) });
    return { ok: true, json: async () => ({ data: [{ id: "test-model" }] }) };
  });
  assert.equal(results[0].ok, true); assert.equal(results[1].ok, false);
  assert.equal(results[1].detail, "ECONNREFUSED");
  assert.equal(calls.length, 2);
  for (const { url, options } of calls) {
    assert.match(url, /\/v1\/models$/); assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.body, undefined); assert.equal(options.headers, undefined); assert.equal(options.redirect, "error");
  }
});

test("model diagnostics reject empty model lists, HTTP errors and invalid JSON", async () => {
  for (const response of [{ ok: true, json: async () => ({ data: [] }) }, { ok: false, status: 404 }, { ok: true, json: async () => { throw new SyntaxError("PRIVATE"); } }]) {
    const results = await checkModelEndpoints({}, async () => response);
    assert.ok(results.every(result => !result.ok && !result.detail.includes("PRIVATE")));
  }
  const lines = [], logger = { log: line => lines.push(line), error: line => lines.push(line) };
  assert.equal(await reportModelEndpoints({}, logger, async () => ({ ok: false, status: 503 })), false);
  assert.ok(lines.every(line => line.includes("FAIL: HTTP 503")));
});

test("swear jar startup explains inactive dependencies, a deliberate pause and an empty replacement list", () => {
  assert.match(swearJarStatus({}), /OFF: requires/);
  const enabled = { LIDOLLID_ENABLED: "true", LIDOLLCOIN_ENABLED: "true" };
  assert.match(swearJarStatus(enabled), /ON: 1 coin/);
  assert.match(swearJarStatus({ ...enabled, SWEAR_JAR_ENABLED: "false" }), /PAUSED/);
  assert.match(swearJarStatus({ ...enabled, SWEAR_JAR_WORDS: " , " }), /NO MATCHES/);
  assert.match(swearJarStatus({ ...enabled, SWEAR_JAR_WORDS: "heck,darn" }), /2 configured words/);
  assert.match(swearJarStatus({}, { wallet: true, identities: true }), /ON/);
});

test("chat failures retain retry text while router failures stay silent and log nested network codes", async t => {
  const errors = [];
  t.mock.method(console, "error", (...args) => errors.push(args.join(" ")));
  t.mock.method(console, "log", () => {});
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.ok(options.signal instanceof AbortSignal);
    throw new Error("PRIVATE", { cause: Object.assign(new Error(), { code: "ENETUNREACH" }) });
  });
  const state = { messages: [new HumanMessage("Are you there?")], force_respond: false };
  assert.equal((await routerNode(state)).next, "__end__");
  assert.equal((await routerNode({ ...state, force_respond: true })).next, "sakura_llm"); // A router outage must not disable direct invitations.
  assert.match((await sakuraLLMNode(state)).messages[0].content, /couldn't reach her brain/);
  assert.equal(errors.length, 2); assert.ok(errors.every(line => line.includes("ENETUNREACH") && !line.includes("PRIVATE")));
});

test("invalid chat configuration returns a fallback without sending a request or exposing the configured value", async t => {
  const original = process.env.LLAMA_BASE_URL, errors = [];
  t.after(() => { if (original === undefined) delete process.env.LLAMA_BASE_URL; else process.env.LLAMA_BASE_URL = original; });
  process.env.LLAMA_BASE_URL = "http://user:PRIVATE@models.example/v1";
  t.mock.method(console, "error", (...args) => errors.push(args.join(" ")));
  t.mock.method(console, "log", () => {});
  const request = t.mock.method(globalThis, "fetch", async () => { throw new Error("Should not be called"); });
  const result = await sakuraLLMNode({ messages: [new HumanMessage("Hello")], force_respond: true });
  assert.match(result.messages[0].content, /couldn't reach her brain/);
  assert.equal(request.mock.callCount(), 0);
  assert.ok(errors.every(line => !line.includes("PRIVATE")));
});
