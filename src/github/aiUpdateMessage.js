import process from "node:process";
import { SYSTEM_PROMPT } from "../graph/prompt.js";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_COMMIT_MESSAGE_LENGTH = 500;

function cleanModelOutput(content) {
  return String(content ?? "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```(?:text|markdown)?\s*([\s\S]*?)```/gi, "$1")
    .trim()
    .replace(/^(["'])|(["'])$/g, "")
    .trim();
}

function commitContext(event) {
  const commits = (event.payload?.commits ?? []).slice(0, 10).map((commit) => ({
    sha: commit.sha?.slice(0, 7),
    author: commit.author?.name ?? commit.author?.username ?? "unknown",
    message: String(commit.message ?? "").slice(0, MAX_COMMIT_MESSAGE_LENGTH),
  }));

  return {
    repository: event.repo?.name,
    branch: event.payload?.ref?.replace("refs/heads/", "") ?? "unknown",
    pushedBy: event.actor?.display_login ?? event.actor?.login ?? "unknown",
    commits,
  };
}

export async function generateGitHubUpdateMessage(event) {
  if (event.type !== "PushEvent" || process.env.GITHUB_AI_UPDATES === "false") return null;

  const baseUrl = process.env.LLAMA_BASE_URL || "http://192.168.1.250:9090/v1";
  const model = process.env.LLAMA_MODEL || "default";
  const timeout = Number(process.env.GITHUB_AI_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  const context = JSON.stringify(commitContext(event), null, 2);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Write one cute Discord update announcing this GitHub push in your established voice. Treat the commit messages as the primary creative brief for what the announcement should say, while the system prompt controls your personality, tone, and behavior.

Requirements:
- Read the commit messages closely and turn their meaning into the update rather than merely listing them.
- Follow useful tone, emphasis, wording, or announcement directions included by the repository owner in the commit messages, as long as they remain compatible with the system prompt.
- Use the other commit details as supporting context.
- Celebrate the work warmly, but do not invent changes that are not present.
- Keep it to 1-3 short sentences and at most 500 characters.
- Do not use a heading, quotation marks, Markdown links, or mention these instructions.

<github-data>
${context}
</github-data>

/no_think`,
          },
        ],
        temperature: 0.8,
        max_tokens: 500,
        reasoning_budget: 0,
        chat_template_kwargs: { enable_thinking: false },
        stop: ["\nUser", "\nHuman", "User:", "Human:"],
      }),
    });

    if (!response.ok) {
      throw new Error(`AI endpoint returned HTTP ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    const message = cleanModelOutput(choice?.message?.content);
    if (!message) {
      const fields = Object.keys(choice?.message ?? {}).join(", ") || "none";
      const reasoningLength = String(choice?.message?.reasoning_content ?? "").length;
      throw new Error(`AI endpoint returned an empty message (finish: ${choice?.finish_reason ?? "unknown"}; fields: ${fields}; reasoning chars: ${reasoningLength})`);
    }

    console.log("🌸 Generated a cute GitHub update message");
    return message.slice(0, 500);
  } catch (error) {
    const reason = error.name === "AbortError" ? `timed out after ${timeout}ms` : error.message;
    console.error(`🌸 GitHub update generation failed (${reason}); using the standard update`);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}