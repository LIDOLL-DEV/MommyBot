import assert from "node:assert/strict";
import test from "node:test";
import { HumanMessage } from "@langchain/core/messages";
import { completionText } from "../src/graph/completion.js";
import { sakuraLLMNode } from "../src/graph/nodes.js";

test("normal answer text is preserved", () => {
  assert.equal(completionText({ choices: [{ message: { content: " Hello! " } }] }), "Hello!");
});

test("missing, blank and reasoning-only completions produce diagnostics without leaking reasoning", () => {
  for (const content of [undefined, null, "", "   "]) {
    assert.throws(() => completionText({
      choices: [{ finish_reason: "length", message: { content, reasoning_content: "private reasoning" } }],
      usage: { completion_tokens: 10000 },
    }), (error) => {
      assert.equal(error.code, "EMPTY_MODEL_RESPONSE");
      assert.match(error.message, /"finish_reason":"length"/);
      assert.match(error.message, /"completion_tokens":10000/);
      assert.match(error.message, /"reasoning_chars":17/);
      assert.ok(!error.message.includes("private reasoning"));
      return true;
    });
  }
  assert.throws(() => completionText({ choices: [] }), /no answer text/);
});

test("the LLM node identifies empty responses instead of reporting the old canned reply as success", async (context) => {
  const errors = [];
  context.mock.method(console, "error", (...args) => errors.push(args.join(" ")));
  context.mock.method(globalThis, "fetch", async () => {
    return { ok: true, json: async () => ({ choices: [{ finish_reason: "length", message: { content: null } }] }) };
  });
  const result = await sakuraLLMNode({ messages: [new HumanMessage("Are you there?")] });
  assert.match(result.messages[0].content, /returned no answer text/);
  assert.ok(errors.some((message) => message.includes('"finish_reason":"length"')));
});
