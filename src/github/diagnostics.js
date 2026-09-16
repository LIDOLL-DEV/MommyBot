import { readFile } from "node:fs/promises";

async function probe(url, token, fetcher) {
  try {
    const response = await fetcher(url, { redirect: "error", signal: AbortSignal.timeout(15000), headers: {
      Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`,
      "User-Agent": "MommyBot-GitHub-Check", "X-GitHub-Api-Version": "2022-11-28",
    } });
    const status = response.status;
    if (!response.ok) return { ok: false, status };
    return { ok: true, status, data: await response.json() };
  } catch { return { ok: false, reason: "network_timeout_redirect_or_invalid_response" }; }
} // Only bounded read requests; never print response bodies, authorization headers or raw exceptions.

const outcome = result => result.ok ? { status: result.status, ok: true } : { ...result };

export async function inspectGitHubActivity(config, { fetcher = fetch, read = readFile } = {}) {
  let saved = {}, stateStatus = "loaded";
  try {
    saved = JSON.parse(await read(config.stateFile, "utf8"));
    if (!saved || typeof saved !== "object" || Array.isArray(saved) ||
        (saved.version !== undefined && (saved.version !== 2 || !saved.repositories || typeof saved.repositories !== "object" || Array.isArray(saved.repositories)))) {
      saved = {}; stateStatus = "invalid";
    }
  } catch (error) { stateStatus = error.code === "ENOENT" ? "missing" : "unreadable_or_invalid"; }
  const repositories = [];
  for (const { owner, repo } of config.repositories) {
    const repository = `${owner}/${repo}`, key = repository.toLowerCase();
    const state = saved.version === 2 ? saved.repositories[key] || {} : saved.repository?.toLowerCase() === key ? saved : {};
    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    const [metadata, events] = await Promise.all([
      probe(url, config.token, fetcher), probe(`${url}/events?per_page=1`, config.token, fetcher),
    ]);
    const branch = metadata.ok && typeof metadata.data?.default_branch === "string" ? metadata.data.default_branch : null;
    const commits = branch ? await probe(`${url}/commits?sha=${encodeURIComponent(branch)}&per_page=1`, config.token, fetcher) : null;
    const sha = commits?.ok && Array.isArray(commits.data) && typeof commits.data[0]?.sha === "string" ? commits.data[0].sha : null;
    const progress = stateStatus !== "loaded" && stateStatus !== "missing" ? "state_unavailable" : !state.initializedAt && !state.lastEventId
      ? config.announceExisting ? "first_poll_will_announce_recent_activity" : "first_poll_will_set_baseline"
      : !sha ? "head_unavailable" : state.lastCommitSha === sha ? "default_branch_at_saved_head" : "default_branch_has_unsaved_head";
    repositories.push({ repository, metadata: outcome(metadata), events: outcome(events), commits: commits ? outcome(commits) : { ok: false, reason: "metadata_unavailable" },
      defaultBranch: branch, progress, lastCheckedAt: typeof state.lastCheckedAt === "string" ? state.lastCheckedAt : null });
  }
  return { channelId: config.channelId, intervalMs: config.interval, stateStatus, repositories };
} // Report configured access and saved progress without AI calls, Discord connections, state writes or cursor resets.
