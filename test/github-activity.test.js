import assert from "node:assert/strict";
import test from "node:test";
import { fetchDefaultBranchPush, readGitHubConfig, pollGitHubActivity } from "../src/github/activityWatcher.js";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

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

test("multiple-repository configuration overrides the legacy setting and deduplicates case-insensitively", () => {
  const env = { GITHUB_REPOSITORY: "Owner/legacy", GITHUB_TOKEN: "fake", CHANNEL_ID: "channel" };
  assert.equal(readGitHubConfig({}), null);
  assert.deepEqual(readGitHubConfig(env).repositories, [{ owner: "Owner", repo: "legacy" }]);
  const multiple = readGitHubConfig({ ...env, GITHUB_REPOSITORIES: " Owner/alpha,Other/beta,owner/ALPHA " });
  assert.deepEqual(multiple.repositories, [{ owner: "Owner", repo: "alpha" }, { owner: "Other", repo: "beta" }]);
  assert.equal(multiple.token, "fake"); assert.equal(multiple.channelId, "channel");
  for (const invalid of ["repo", "https://github.com/owner/repo", "owner/alpha,", "owner/alpha,,other/beta", "owner/../repo", "owner/.."]) {
    assert.throws(() => readGitHubConfig({ ...env, GITHUB_REPOSITORIES: invalid }), /owner\/repository format/);
  }
  assert.throws(() => readGitHubConfig({ ...env, GITHUB_TOKEN: "" }), /requires/);
  assert.throws(() => readGitHubConfig({ ...env, GITHUB_POLL_INTERVAL_MS: "59999" }), /at least/);
});

async function watcherFixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "mommybot-github-"));
  t.after(async () => {
    assert.equal(path.dirname(directory), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith("mommybot-github-"));
    await rm(directory, { recursive: true, force: true });
  });
  const settings = readGitHubConfig({ GITHUB_REPOSITORIES: "Owner/alpha,Other/beta", GITHUB_TOKEN: "fake", GITHUB_ACTIVITY_CHANNEL_ID: "channel",
    GITHUB_STATE_FILE: path.join(directory, "state.json") });
  const old = githubCommit("head-1", "2026-01-01T00:00:00Z", "Initial change");
  const feeds = { "owner/alpha": { commits: [old], events: [] }, "other/beta": { commits: [old], events: [] } };
  const sent = [], errors = [];
  t.mock.method(globalThis, "fetch", async (endpoint, options) => {
    const url = new URL(endpoint);
    assert.equal(url.hostname, "api.github.com");
    assert.equal(options.headers.Authorization, "Bearer fake");
    const [, , owner, repo, resource] = url.pathname.split("/");
    const feed = feeds[`${owner}/${repo}`.toLowerCase()];
    assert.ok(feed, "Only configured repositories may be polled");
    if (feed.fail) return { ok: false, status: 403, statusText: "Forbidden", headers: new Headers() };
    const payload = resource === "events" ? feed.events : resource === "commits" ? feed.commits : { default_branch: "main" };
    return { ok: true, status: 200, headers: new Headers(), json: async () => payload };
  });
  let sendFailure = false;
  const client = { channels: { fetch: async id => {
    assert.equal(id, "channel");
    return { send: async message => {
      if (sendFailure && message.embeds?.[0].data.footer.text.toLowerCase() === "owner/alpha") throw new Error("Synthetic Discord failure");
      sent.push(message);
    } };
  } } };
  const options = { summarize: async () => null, logger: { log() {}, error: (...args) => errors.push(args.join(" ")) } };
  return { settings, feeds, sent, errors, options, client,
    failSend: () => { sendFailure = true; },
    poll: (config = settings) => pollGitHubActivity(client, config, options),
    state: async () => JSON.parse(await readFile(settings.stateFile, "utf8")),
    advance: name => feeds[name].commits.unshift(githubCommit("head-2", "2026-01-02T00:00:00Z", `Update ${name}`)),
  };
} // Mock both transports and AI; exercise real atomic cursor files without sending any announcements.

test("repository cursors remain independent across polls, restarts, reordering and temporary removal", async t => {
  const f = await watcherFixture(t);
  await f.poll(); assert.equal(f.sent.length, 0);
  assert.deepEqual(Object.keys((await f.state()).repositories).sort(), ["other/beta", "owner/alpha"]);
  f.advance("owner/alpha"); f.advance("other/beta");
  await f.poll();
  assert.deepEqual(f.sent.map(message => message.embeds[0].data.footer.text), ["Owner/alpha", "Other/beta"]);
  await f.poll({ ...f.settings, repositories: [{ owner: "OTHER", repo: "BETA" }, { owner: "OWNER", repo: "ALPHA" }] });
  assert.equal(f.sent.length, 2, "Restarting or changing case/order does not replay commits");
  f.feeds["owner/alpha"].commits.unshift(githubCommit("head-3", "2026-01-03T00:00:00Z", "While removed"));
  await f.poll({ ...f.settings, repositories: [f.settings.repositories[1]] });
  assert.equal((await f.state()).repositories["owner/alpha"].lastCommitSha, "head-2");
  await f.poll(); assert.equal(f.sent.length, 3);
  assert.equal(f.sent[2].embeds[0].data.footer.text, "Owner/alpha");
  assert.deepEqual(f.errors, []);
});

test("legacy state migrates without replaying the existing repository while new repositories baseline separately", async t => {
  const f = await watcherFixture(t);
  const legacy = { repository: "OWNER/alpha", lastCommitSha: "head-1", lastEventId: "same-event", initializedAt: "2026-01-01T00:00:00Z" };
  await writeFile(f.settings.stateFile, JSON.stringify(legacy));
  for (const feed of Object.values(f.feeds)) feed.events = [{ id: "same-event", type: "WatchEvent", actor: { login: "doll" },
    repo: { name: "Other/beta" }, payload: {}, created_at: "2026-01-01T00:00:00Z" }];
  await f.poll(); assert.equal(f.sent.length, 0);
  const state = await f.state(); assert.equal(state.version, 2);
  assert.equal(state.repositories["owner/alpha"].initializedAt, legacy.initializedAt);
  assert.equal(state.repositories["other/beta"].lastEventId, "same-event");
  f.advance("owner/alpha"); await f.poll(); assert.equal(f.sent.length, 1);
});

test("one repository's API failure does not block another or advance the failed cursor", async t => {
  const f = await watcherFixture(t); await f.poll();
  f.advance("owner/alpha"); f.advance("other/beta"); f.feeds["owner/alpha"].fail = true;
  await f.poll();
  assert.equal(f.sent.length, 1); assert.equal(f.sent[0].embeds[0].data.footer.text, "Other/beta");
  assert.equal((await f.state()).repositories["owner/alpha"].lastCommitSha, "head-1");
  assert.ok(f.errors[0].includes("Owner/alpha"));
  f.feeds["owner/alpha"].fail = false; await f.poll();
  assert.equal(f.sent.length, 2); assert.equal(f.sent[1].embeds[0].data.footer.text, "Owner/alpha");
});

test("Discord failures preserve the affected repository cursor and shutdown during AI prevents a send", async t => {
  const f = await watcherFixture(t); await f.poll();
  f.advance("owner/alpha"); f.advance("other/beta"); f.failSend();
  await f.poll(); assert.equal(f.sent.length, 1);
  assert.equal((await f.state()).repositories["owner/alpha"].lastCommitSha, "head-1");
  let stopped = false;
  await pollGitHubActivity(f.client, f.settings, { ...f.options, stopped: () => stopped, summarize: async () => { stopped = true; return null; } });
  assert.equal(f.sent.length, 1);
  assert.equal((await f.state()).repositories["owner/alpha"].lastCommitSha, "head-1");
});
