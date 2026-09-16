import { EmbedBuilder } from "discord.js";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { generateGitHubUpdateMessage } from "./aiUpdateMessage.js";

const GITHUB_API_VERSION = "2022-11-28";
const DEFAULT_POLL_INTERVAL_MS = 5 * 60 * 1000;
const MIN_POLL_INTERVAL_MS = 60 * 1000;
const MAX_PAGES = 10;

function truncate(value, maxLength) {
  const text = String(value ?? "");
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

function eventDetails(event) {
  const payload = event.payload ?? {};
  const repoUrl = `https://github.com/${event.repo.name}`;

  switch (event.type) {
    case "PushEvent": {
      const branch = payload.ref?.replace("refs/heads/", "") || "unknown branch";
      const commits = payload.commits ?? [];
      const summary = commits
        .slice(0, 5)
        .map((commit) => `[\`${commit.sha?.slice(0, 7)}\`](${repoUrl}/commit/${commit.sha}) ${truncate(commit.message?.split("\n")[0], 120)}`)
        .join("\n");
      const extra = commits.length > 5 ? `\n…and ${commits.length - 5} more` : "";
      return {
        title: `Pushed ${commits.length} commit${commits.length === 1 ? "" : "s"} to ${branch}`,
        description: `${summary || "A branch was updated."}${extra}`,
        url: payload.head ? `${repoUrl}/commit/${payload.head}` : repoUrl,
        color: 0x2da44e,
      };
    }
    case "PullRequestEvent":
      return {
        title: `${payload.action ?? "updated"} pull request #${payload.number}`,
        description: payload.pull_request?.title,
        url: payload.pull_request?.html_url ?? repoUrl,
        color: payload.action === "closed" ? 0x8250df : 0x1f6feb,
      };
    case "PullRequestReviewEvent":
      return {
        title: `${payload.action ?? "updated"} a pull request review`,
        description: payload.pull_request?.title,
        url: payload.review?.html_url ?? payload.pull_request?.html_url ?? repoUrl,
        color: 0x1f6feb,
      };
    case "PullRequestReviewCommentEvent":
    case "IssueCommentEvent":
      return {
        title: `${payload.action ?? "updated"} a comment on #${payload.issue?.number ?? payload.pull_request?.number ?? "?"}`,
        description: payload.comment?.body,
        url: payload.comment?.html_url ?? repoUrl,
        color: 0x57606a,
      };
    case "IssuesEvent":
      return {
        title: `${payload.action ?? "updated"} issue #${payload.issue?.number}`,
        description: payload.issue?.title,
        url: payload.issue?.html_url ?? repoUrl,
        color: payload.action === "closed" ? 0x8250df : 0x1a7f37,
      };
    case "ReleaseEvent":
      return {
        title: `${payload.action ?? "updated"} release ${payload.release?.tag_name ?? ""}`.trim(),
        description: payload.release?.name || payload.release?.body,
        url: payload.release?.html_url ?? repoUrl,
        color: 0x8250df,
      };
    case "CreateEvent":
    case "DeleteEvent":
      return {
        title: `${event.type === "CreateEvent" ? "Created" : "Deleted"} ${payload.ref_type ?? "reference"}${payload.ref ? ` ${payload.ref}` : ""}`,
        description: payload.description,
        url: repoUrl,
        color: event.type === "CreateEvent" ? 0x2da44e : 0xcf222e,
      };
    case "ForkEvent":
      return {
        title: `Forked repository to ${payload.forkee?.full_name ?? "a new repository"}`,
        url: payload.forkee?.html_url ?? repoUrl,
        color: 0x57606a,
      };
    case "WatchEvent":
      return { title: "Starred the repository", url: repoUrl, color: 0xe3b341 };
    default:
      return {
        title: event.type.replace(/Event$/, " event"),
        description: "New repository activity",
        url: repoUrl,
        color: 0x57606a,
      };
  }
}

export function buildActivityEmbed(event, aiMessage = null) {
  const details = eventDetails(event);
  const actor = event.actor?.display_login ?? event.actor?.login ?? "Someone";
  const description = aiMessage
    ? `${truncate(aiMessage, 500)}\n\n${details.description || "New repository activity"}`
    : details.description || "New repository activity";

  return new EmbedBuilder()
    .setColor(details.color)
    .setAuthor({
      name: actor,
      iconURL: event.actor?.avatar_url ?? undefined,
      url: `https://github.com/${event.actor?.login ?? ""}`,
    })
    .setTitle(truncate(details.title, 256))
    .setURL(details.url)
    .setDescription(truncate(description, 4096))
    .setFooter({ text: event.repo.name })
    .setTimestamp(new Date(event.created_at));
}

async function loadState(stateFile) {
  try {
    return JSON.parse(await readFile(stateFile, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

async function saveState(stateFile, state) {
  await mkdir(path.dirname(stateFile), { recursive: true });
  const temporaryFile = `${stateFile}.tmp`;
  await writeFile(temporaryFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryFile, stateFile);
}

async function fetchEvents({ owner, repo, token, lastEventId }) {
  const events = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/events?per_page=100&page=${page}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "User-Agent": "MommyBot-GitHub-Activity",
          "X-GitHub-Api-Version": GITHUB_API_VERSION,
        },
      },
    );

    if (!response.ok) {
      const requestId = response.headers.get("x-github-request-id");
      throw new Error(`GitHub API returned ${response.status} ${response.statusText}${requestId ? ` (request ${requestId})` : ""}`);
    }

    const pageEvents = await response.json();
    for (const event of pageEvents) {
      if (event.id === lastEventId) return events;
      events.push(event);
    }

    if (pageEvents.length < 100) break;
  }

  return events;
}

async function fetchJson(endpoint, token, description) {
  const response = await fetch(endpoint, { headers: githubHeaders(token) });

  if (!response.ok) {
    const requestId = response.headers.get("x-github-request-id");
    throw new Error(`${description} (HTTP ${response.status}${requestId ? `, request ${requestId}` : ""})`);
  }

  return response.json();
}

function commitTimestamp(commit) {
  // Prefer the committer time because it most closely represents when GitHub received the commit.
  return commit.commit?.committer?.date ?? commit.commit?.author?.date ?? new Date().toISOString();
}

function makePushEvent(commits, config, branch, previousHead) {
  const newestCommit = commits.at(-1);
  const actor = newestCommit?.committer ?? newestCommit?.author;

  return {
    id: `commit:${newestCommit.sha}`,
    type: "PushEvent",
    actor: {
      login: actor?.login ?? newestCommit.commit?.author?.name ?? "unknown",
      display_login: actor?.login ?? newestCommit.commit?.author?.name ?? "Someone",
      avatar_url: actor?.avatar_url,
    },
    repo: { name: `${config.owner}/${config.repo}` },
    payload: {
      ref: `refs/heads/${branch}`,
      before: previousHead,
      head: newestCommit.sha,
      commits: commits.map((commit) => ({
        sha: commit.sha,
        message: commit.commit?.message ?? "",
        author: {
          name: commit.commit?.author?.name,
          username: commit.author?.login,
        },
      })),
    },
    created_at: commitTimestamp(newestCommit),
  };
}

export async function fetchDefaultBranchPush(config, state) {
  const repositoryUrl = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`;
  const repository = await fetchJson(repositoryUrl, config.token, "Could not load GitHub repository details");
  const branch = repository.default_branch;
  const commitsUrl = `${repositoryUrl}/commits?sha=${encodeURIComponent(branch)}&per_page=100`;
  const latestCommits = await fetchJson(commitsUrl, config.token, "Could not load GitHub commits");
  const newestCommit = latestCommits[0];

  if (!newestCommit || newestCommit.sha === state.lastCommitSha) {
    return { event: null, lastCommitSha: newestCommit?.sha ?? state.lastCommitSha ?? null, defaultBranch: branch };
  }

  let unseenCommits;
  if (state.lastCommitSha) {
    const previousIndex = latestCommits.findIndex((commit) => commit.sha === state.lastCommitSha);
    unseenCommits = previousIndex >= 0 ? latestCommits.slice(0, previousIndex) : [];

    if (previousIndex < 0) {
      try {
        // The compare endpoint handles normal pushes containing more than one page of commits.
        const comparison = await fetchJson(
          `${repositoryUrl}/compare/${encodeURIComponent(state.lastCommitSha)}...${encodeURIComponent(newestCommit.sha)}`,
          config.token,
          "Could not compare GitHub commits",
        );
        unseenCommits = comparison.commits ?? [];
      } catch (error) {
        // A force-push can make the old head unreachable, so use timestamps as a bounded fallback.
        console.warn(`🐙 ${error.message}; using recent commit timestamps instead`);
        unseenCommits = latestCommits.filter((commit) => commitTimestamp(commit) > (state.lastCheckedAt ?? state.initializedAt ?? ""));
      }
    }
  } else if (state.initializedAt) {
    // Migrate legacy state by recovering commits made after the last successful activity check.
    const cutoff = state.lastCheckedAt ?? state.initializedAt;
    unseenCommits = latestCommits.filter((commit) => commitTimestamp(commit) > cutoff);
  } else {
    unseenCommits = config.announceExisting ? latestCommits : [];
  }

  unseenCommits = unseenCommits.slice(0, config.maxAnnouncements * 10).reverse();
  return {
    event: unseenCommits.length ? makePushEvent(unseenCommits, config, branch, state.lastCommitSha) : null,
    lastCommitSha: newestCommit.sha,
    defaultBranch: branch,
  };
}

function githubHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "MommyBot-GitHub-Activity",
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
  };
}

async function fetchPushCommits(event, config) {
  if (event.type !== "PushEvent" || event.payload?.commits?.length) return event;

  const { before, head } = event.payload ?? {};
  if (!head) return event;

  const repoUrl = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`;
  const hasBefore = before && !/^0+$/.test(before);
  const endpoint = hasBefore
    ? `${repoUrl}/compare/${encodeURIComponent(before)}...${encodeURIComponent(head)}`
    : `${repoUrl}/commits/${encodeURIComponent(head)}`;
  const response = await fetch(endpoint, { headers: githubHeaders(config.token) });

  if (!response.ok) {
    const permissionHint = response.status === 403
      ? "; give the fine-grained GitHub token Contents: Read-only permission"
      : "";
    throw new Error(`Could not load GitHub commit text (HTTP ${response.status}${permissionHint})`);
  }

  const data = await response.json();
  const commits = hasBefore ? data.commits ?? [] : [data];
  event.payload.commits = commits.slice(-10).map((commit) => ({
    sha: commit.sha,
    message: commit.commit?.message ?? "",
    author: {
      name: commit.commit?.author?.name,
      username: commit.author?.login,
    },
  }));
  return event;
}

export function readGitHubConfig(env = process.env) {
  const repositoryList = env.GITHUB_REPOSITORIES?.trim();
  const repository = repositoryList || env.GITHUB_REPOSITORY?.trim();
  const token = env.GITHUB_TOKEN?.trim();
  const channelId = (env.GITHUB_ACTIVITY_CHANNEL_ID || env.CHANNEL_ID)?.trim();

  if (!repository && !token) return null;
  if (!repository || !token || !channelId) {
    throw new Error("GitHub activity requires GITHUB_REPOSITORIES (or GITHUB_REPOSITORY), GITHUB_TOKEN, and GITHUB_ACTIVITY_CHANNEL_ID (or CHANNEL_ID)");
  }

  const repositories = [], seen = new Set();
  for (const name of repositoryList ? repository.split(",").map(value => value.trim()) : [repository]) {
    if (!/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(name) || [".", ".."].includes(name.split("/")[1])) {
      throw new Error("GitHub repositories must use owner/repository format; separate GITHUB_REPOSITORIES entries with commas");
    }
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const [owner, repo] = name.split("/");
    repositories.push({ owner, repo });
  }
  // Repository names are case-insensitive; duplicate entries must not create duplicate announcements.

  const requestedInterval = Number(env.GITHUB_POLL_INTERVAL_MS || DEFAULT_POLL_INTERVAL_MS);
  if (!Number.isFinite(requestedInterval) || requestedInterval < MIN_POLL_INTERVAL_MS) {
    throw new Error(`GITHUB_POLL_INTERVAL_MS must be at least ${MIN_POLL_INTERVAL_MS}`);
  }

  return {
    repositories,
    token,
    channelId,
    interval: requestedInterval,
    announceExisting: env.GITHUB_ANNOUNCE_EXISTING === "true",
    maxAnnouncements: Math.max(1, Math.min(20, Number(env.GITHUB_MAX_ANNOUNCEMENTS) || 10)),
    stateFile: path.resolve(env.GITHUB_STATE_FILE || "data/github-activity-state.json"),
  };
} // Prefer the multi-repository list while preserving existing single-repository installations.

function migrateState(saved) {
  if (saved.version === 2 && saved.repositories && typeof saved.repositories === "object" && !Array.isArray(saved.repositories)) {
    return { version: 2, repositories: { ...saved.repositories } };
  }
  if (saved.version !== undefined) throw new Error("Unsupported GitHub activity state version");
  const repositories = {};
  if (typeof saved.repository === "string") repositories[saved.repository.toLowerCase()] = saved;
  return { version: 2, repositories };
} // Retain the legacy repository's exact cursors; newly added repositories get their own baseline.

export async function pollGitHubActivity(client, settings, { stopped = () => false, summarize = generateGitHubUpdateMessage, logger = console } = {}) {
  const savedState = migrateState(await loadState(settings.stateFile));
  for (const entry of settings.repositories) {
    if (stopped()) return;
    const config = { ...settings, ...entry }, repository = `${entry.owner}/${entry.repo}`, key = repository.toLowerCase();
    try {
      const state = savedState.repositories[key] || {};
      const activityEvents = await fetchEvents({ ...config, lastEventId: state.lastEventId });
      const push = await fetchDefaultBranchPush(config, state);
      const events = activityEvents
        // GitHub documents that its Events feed can lag for hours; direct commit polling handles default-branch pushes.
        .filter((event) => event.type !== "PushEvent" || event.payload?.ref !== `refs/heads/${push.defaultBranch}`)
        .concat(push.event ? [push.event] : [])
        .sort((left, right) => new Date(right.created_at) - new Date(left.created_at));
      if (stopped()) return; // Shutdown must not publish activity after an outstanding GitHub request finishes.

      const isFirstCheck = !state.initializedAt && !state.lastEventId;
      if (isFirstCheck && !config.announceExisting && activityEvents.length) {
        logger.log(`🐙 ${repository}: activity baseline set at event ${activityEvents[0].id}`);
      } else if (events.length) {
        const channel = await client.channels.fetch(config.channelId);
        if (!channel || typeof channel.send !== "function") {
          throw new Error(`Discord channel ${config.channelId} is not a sendable channel`);
        }

        const announcements = events.slice(0, config.maxAnnouncements).reverse();
        for (const event of announcements) {
          let enrichedEvent = event;
          try {
            enrichedEvent = await fetchPushCommits(event, config);
          } catch (error) {
            logger.error(`🐙 ${repository}: ${error.message}`);
          }
          if (stopped()) return;
          const aiMessage = await summarize(enrichedEvent);
          if (stopped()) return;
          await channel.send({ embeds: [buildActivityEmbed(enrichedEvent, aiMessage)] });
        }

        if (events.length > announcements.length) {
          if (stopped()) return;
          await channel.send(`🐙 ${repository}: ${events.length - announcements.length} additional GitHub events were omitted to avoid flooding this channel.`);
        }
        logger.log(`🐙 ${repository}: posted ${announcements.length} GitHub activit${announcements.length === 1 ? "y" : "ies"}`);
      }

      const nextState = {
        repository,
        lastEventId: activityEvents[0]?.id ?? state.lastEventId ?? null,
        lastCommitSha: push.lastCommitSha,
        initializedAt: state.initializedAt ?? new Date().toISOString(),
        lastCheckedAt: new Date().toISOString(),
      };
      await saveState(config.stateFile, { version: 2, repositories: { ...savedState.repositories, [key]: nextState } });
      savedState.repositories[key] = nextState; // Publish the cursor in memory only after the atomic state-file replacement succeeds.
    } catch (error) {
      logger.error(`🐙 ${repository}: GitHub activity check failed:`, error.message);
    }
  }
} // Poll and checkpoint repositories separately; an inaccessible repository cannot block the others.

export function startGitHubActivityWatcher(client) {
  const config = readGitHubConfig();
  if (!config) {
    console.log("🐙 GitHub activity watcher is disabled");
    return () => {};
  }
  let stopped = false;
  let timer;
  const poll = async () => {
    try {
      await pollGitHubActivity(client, config, { stopped: () => stopped });
    } catch (error) {
      console.error("🐙 GitHub activity state could not be loaded:", error.message);
    } finally {
      if (!stopped) timer = setTimeout(poll, config.interval);
    }
  };

  console.log(`🐙 Watching GitHub activity for ${config.repositories.map(({ owner, repo }) => `${owner}/${repo}`).join(", ")}`);
  void poll();

  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
