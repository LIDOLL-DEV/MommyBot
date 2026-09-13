import assert from "node:assert/strict";
import test from "node:test";
import { fetchDefaultBranchPush } from "../src/github/activityWatcher.js";

const config = {
  owner: "LIDOLL-DEV",
  repo: "lidollquest",
  token: "test-token",
  maxAnnouncements: 10,
  announceExisting: false,
};

function githubCommit(sha, date, message) {
  return {
    sha,
    author: { login: "doll", avatar_url: "https://example.test/avatar.png" },
    committer: { login: "doll", avatar_url: "https://example.test/avatar.png" },
    commit: { author: { name: "Doll", date }, committer: { date }, message },
  };
}

function mockResponses(...payloads) {
  let index = 0;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => payloads[index++],
  });
}

test("recovers commits missed while the Events API is stale", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const oldCommit = githubCommit("old", "2026-08-13T22:41:27Z", "Old change");
  const firstNewCommit = githubCommit("new-1", "2026-08-19T18:02:25Z", "First new change");
  const newestCommit = githubCommit("new-2", "2026-08-19T19:44:01Z", "Newest change");
  mockResponses({ default_branch: "Alpha-Branch" }, [newestCommit, firstNewCommit, oldCommit]);

  const result = await fetchDefaultBranchPush(config, {
    initializedAt: "2026-08-12T16:23:51Z",
    lastCheckedAt: "2026-08-13T22:42:36Z",
  });

  assert.equal(result.lastCommitSha, "new-2");
  assert.equal(result.event.payload.ref, "refs/heads/Alpha-Branch");
  assert.deepEqual(result.event.payload.commits.map((commit) => commit.sha), ["new-1", "new-2"]);
});

test("does not announce a commit that is already saved", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const newestCommit = githubCommit("saved-head", "2026-08-19T19:44:01Z", "Already announced");
  mockResponses({ default_branch: "Alpha-Branch" }, [newestCommit]);

  const result = await fetchDefaultBranchPush(config, { lastCommitSha: "saved-head" });

  assert.equal(result.event, null);
  assert.equal(result.lastCommitSha, "saved-head");
});
