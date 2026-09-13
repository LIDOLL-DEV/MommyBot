import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { HumanMessage } from "@langchain/core/messages";
import { TASKS } from "@langchain/langgraph-checkpoint";
import { ConversationSqliteSaver as SqliteSaver } from "../src/db/sqliteSaver.js";
import { buildGraph } from "../src/graph/graph.js";

test("conversation memory survives a second turn and reopening SQLite", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mommybot-memory-"));
  const database = path.join(directory, "memory.db");
  let saver = SqliteSaver.fromConnString(database);
  context.after(async () => {
    saver.db.close(); // Release native handles before removing the disposable database on Windows.
    await rm(directory, { recursive: true, force: true });
  });
  const requests = [];
  context.mock.method(globalThis, "fetch", async (_url, options) => {
    requests.push(JSON.parse(options.body)); // Capture actual graph history without contacting a model server.
    return { ok: true, json: async () => ({ choices: [{ message: { content: `Reply number ${requests.length}.` } }] }) };
  });
  const config = { configurable: { thread_id: "memory-regression" } };
  const turn = (text) => ({ messages: [new HumanMessage(text)], force_respond: true });

  const first = await buildGraph(saver).invoke(turn("Remember my favorite color is green."), config);
  assert.equal(first.messages.length, 2);
  const second = await buildGraph(saver).invoke(turn("What color did I mention?"), config);
  assert.equal(second.messages.length, 4); // This second read exposed the incompatible checkpoint versions.
  assert.deepEqual(requests[1].messages.slice(1).map(({ role }) => role), ["user", "assistant", "user"]);
  assert.equal(requests[1].messages[1].content, "Remember my favorite color is green.");

  saver.db.close();
  saver = SqliteSaver.fromConnString(database); // Reopen the same file to simulate a service restart.
  const third = await buildGraph(saver).invoke(turn("Do you still remember?"), config);
  assert.equal(third.messages.length, 6);
  assert.equal(requests[2].messages[1].content, "Remember my favorite color is green.");

  const other = await buildGraph(saver).invoke(turn("A different user's message."), {
    configurable: { thread_id: "another-user" },
  });
  assert.equal(other.messages.length, 2); // Saved conversation state must stay isolated by Discord user.
});

test("continues checkpoints written by the incompatible Fedora dependency combination", async (context) => {
  const saver = SqliteSaver.fromConnString(":memory:");
  context.after(() => saver.db.close());
  saver.setup();
  const fixture = JSON.parse(await readFile(new URL("./fixtures/legacy-checkpoints.json", import.meta.url), "utf8"));
  const checkpointInsert = saver.db.prepare(`INSERT INTO checkpoints
    (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata)
    VALUES (@thread_id, @checkpoint_ns, @checkpoint_id, @parent_checkpoint_id, @type, @checkpoint, @metadata)`);
  const writeInsert = saver.db.prepare(`INSERT INTO writes
    (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, value)
    VALUES (@thread_id, @checkpoint_ns, @checkpoint_id, @task_id, @idx, @channel, @type, @value)`);
  for (const row of fixture.rows) checkpointInsert.run(row);
  for (const row of fixture.writes) writeInsert.run(row); // Restore synthetic rows created with the exact failing dependency versions.

  context.mock.method(globalThis, "fetch", async (_url, options) => {
    const history = JSON.parse(options.body).messages;
    assert.equal(history[1].content, "My favorite color is green.");
    assert.equal(history[2].content, "I will remember your favorite color.");
    return { ok: true, json: async () => ({ choices: [{ message: { content: "Your favorite color is green." } }] }) };
  });
  const result = await buildGraph(saver).invoke({
    messages: [new HumanMessage("What color did I mention?")], force_respond: true,
  }, { configurable: { thread_id: "legacy-conversation" } });
  assert.equal(result.messages.length, 4);
  assert.equal(result.messages.at(-1).content, "Your favorite color is green.");
});

test("legacy checkpoint migration preserves queued tasks in Topic checkpoint format", async (context) => {
  const saver = SqliteSaver.fromConnString(":memory:");
  context.after(() => saver.db.close());
  saver.setup();
  const task = { node: "sakura_llm", args: { force_respond: true } };
  await saver.putWrites({ configurable: { thread_id: "pending-test", checkpoint_ns: "", checkpoint_id: "parent" } },
    [[TASKS, task]], "task-id"); // Store a real serialized pending send, rather than only testing empty migration output.
  const checkpoint = { v: 1, channel_values: {}, channel_versions: { messages: 2 } };
  await saver.migratePendingSends(checkpoint, "pending-test", "parent");
  assert.deepEqual(checkpoint.channel_values[TASKS], [[], [task]]);
  assert.equal(checkpoint.channel_versions[TASKS], 2);
});
