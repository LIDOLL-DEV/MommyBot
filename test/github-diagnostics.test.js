import test from "node:test";
import assert from "node:assert/strict";
import { inspectGitHubActivity } from "../src/github/diagnostics.js";

const config = { repositories: [{ owner: "Owner", repo: "one" }, { owner: "Owner", repo: "two" }], token: "fake-secret",
  channelId: "test-channel", interval: 300000, stateFile: "unused-test-path", announceExisting: false };

function fixture(saved, failEvents = false) {
  const requests = [];
  return { requests, read: async () => JSON.stringify(saved), fetcher: async (endpoint, options) => {
    requests.push(endpoint);
    assert.equal(options.redirect, "error"); assert.ok(options.signal);
    assert.equal(options.headers.Authorization, "Bearer fake-secret");
    assert.ok(new URL(endpoint).hostname === "api.github.com");
    if (failEvents && endpoint.includes("/events")) return { ok: false, status: 403, json: () => assert.fail("Never read failed response content") };
    const data = endpoint.includes("/events") ? [{ id: "event", privateText: "must-not-print" }] : endpoint.includes("/commits")
      ? [{ sha: "latest", commit: { message: "must-not-print" } }] : { default_branch: "main", privateText: "must-not-print" };
    return { ok: true, status: 200, json: async () => data };
  } };
}

test("read-only diagnostics distinguish caught-up and unsaved repositories without exposing token or commit text", async () => {
  const f = fixture({ version: 2, repositories: {
    "owner/one": { initializedAt: "2026-01-01", lastCheckedAt: "2026-01-02", lastCommitSha: "latest" },
    "owner/two": { initializedAt: "2026-01-01", lastCommitSha: "old" },
  } });
  const result = await inspectGitHubActivity(config, f);
  assert.deepEqual(result.repositories.map(r => r.progress), ["default_branch_at_saved_head", "default_branch_has_unsaved_head"]);
  assert.equal(result.repositories[0].lastCheckedAt, "2026-01-02");
  assert.equal(result.channelId, "test-channel"); assert.equal(f.requests.length, 6);
  assert.ok(!/fake-secret|must-not-print/.test(JSON.stringify(result)));
});

test("diagnostics explain legacy migration and a new repository's silent initial baseline", async () => {
  const f = fixture({ repository: "OWNER/one", initializedAt: "2026-01-01", lastCommitSha: "latest" });
  const result = await inspectGitHubActivity(config, f);
  assert.deepEqual(result.repositories.map(r => r.progress), ["default_branch_at_saved_head", "first_poll_will_set_baseline"]);
});

test("failed events access is reported independently of successful commit access", async () => {
  const f = fixture({}, true), result = await inspectGitHubActivity(config, f);
  for (const repo of result.repositories) {
    assert.deepEqual(repo.events, { ok: false, status: 403 });
    assert.equal(repo.commits.ok, true); assert.equal(repo.metadata.ok, true);
  }
});

test("missing or corrupt state and network failures produce controlled diagnostics", async () => {
  const f = fixture({});
  const missing = await inspectGitHubActivity(config, { ...f, read: async () => { throw Object.assign(new Error("private path"), { code: "ENOENT" }); } });
  assert.equal(missing.stateStatus, "missing");
  const failed = await inspectGitHubActivity(config, { read: async () => "invalid secret", fetcher: async () => { throw new Error("fake-secret"); } });
  assert.equal(failed.stateStatus, "unreadable_or_invalid");
  assert.ok(failed.repositories.every(r => !r.metadata.ok && !r.events.ok && !r.commits.ok && r.progress === "state_unavailable"));
  assert.ok(!JSON.stringify(failed).includes("fake-secret"));
});
