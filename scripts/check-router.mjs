import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { decideResponse } from "../src/graph/router.js";

async function main() {
  if (process.argv.length > 3) throw Error("Usage: node scripts/check-router.mjs [path/to/mommybot.env]");
  const env = { ...process.env, ...(process.argv[2] ? parse(readFileSync(process.argv[2])) : {}) };
  const cases = JSON.parse(readFileSync(new URL("./fixtures/router-conversations.json", import.meta.url), "utf8"));
  let passed = 0, evaluated = 0;
  for (const item of cases) {
    const result = await decideResponse({ messages: [{ content: item.text }], routing_context: item.context, force_respond: false }, { env });
    evaluated++;
    const actual = result.next === "sakura_llm" ? "respond" : "skip";
    const valid = !["invalid_decision", "router_unavailable"].includes(result.routing_reason), ok = valid && actual === item.expected;
    if (ok) passed++;
    console.log(`${ok ? "PASS" : "FAIL"}: ${item.name}; expected=${item.expected}, actual=${actual}, reason=${result.routing_reason}`);
    if (result.routing_reason === "router_unavailable") break; // Do not repeat connection timeouts against a model that is down.
  }
  console.log(`${passed}/${cases.length} routing scenarios passed (${evaluated} evaluated). Synthetic conversations only; nothing sent to Discord.`);
  if (passed !== cases.length) process.exitCode = 1;
} // Exercise real routing inference with a small fixed evaluation set, including both interruptions and missed follow-ups.

main().catch(() => { console.error("FAIL: could not load router configuration or fixtures. Check the env-file path and complete release files."); process.exitCode = 1; });
