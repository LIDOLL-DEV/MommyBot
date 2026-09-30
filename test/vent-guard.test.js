import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "../src/bot/client.js";
import { guardVentChannels, isVentChannel, isVentName } from "../src/bot/ventGuard.js";

const category = { id: "c", name: "VENTING" };
const channels = [
  { id: "1", name: "vent" },
  { id: "2", name: "💭・venting" },
  { id: "3", name: "general" },
  { id: "4", name: "sad-days", parent: category },
  { id: "5", name: "rough night", parent: { id: "6", name: "vent-chat" } },
];
function fakeClient() {
  const sent = [];
  return { sent, channels: { cache: new Map(channels.map(c => [c.id, c])), fetch: async () => { throw Error("Unknown Channel"); } },
    rest: { request: async options => { sent.push(options); return { id: "m" }; } } };
}

test("vent names match the word vent or venting, not words that contain it", () => {
  for (const name of ["vent", "Venting", "vent-chat", "late-night-venting", "💭・vent"]) assert.equal(isVentName(name), true, name);
  for (const name of ["events", "adventure", "prevent", "general", undefined]) assert.equal(isVentName(name), false, String(name));
  assert.equal(isVentChannel(channels[3]), true, "a channel inside a vent category");
  assert.equal(isVentChannel(channels[4]), true, "a thread inside a vent channel");
  assert.equal(isVentChannel(null), false, "DMs and unknown channels");
});

test("messages, reactions, threads and typing to a vent channel never reach Discord", async () => {
  const client = guardVentChannels(fakeClient());
  for (const [method, fullRoute] of [["POST", "/channels/1/messages"], ["PUT", "/channels/2/messages/9/reactions/%F0%9F%8C%B8/@me"],
    ["POST", "/channels/4/threads"], ["POST", "/channels/5/typing"], ["PATCH", "/channels/1/messages/9"]]) {
    await assert.rejects(client.rest.request({ method, fullRoute }), { code: "VENT_CHANNEL" }, `${method} ${fullRoute}`);
  }
  assert.equal(client.sent.length, 0);
  await client.rest.request({ method: "POST", fullRoute: "/channels/3/messages" });
  await client.rest.request({ method: "DELETE", fullRoute: "/channels/1/messages/9" }); // Cleanup stays possible.
  await client.rest.request({ method: "PUT", fullRoute: "/channels/1/permissions/7" }); // Admin tools can still manage the channel.
  await client.rest.request({ method: "POST", fullRoute: "/channels/404/messages" }); // Unresolvable channels fall to Discord's own checks.
  assert.equal(client.sent.length, 4);
});

test("the real client's send helpers go through the guard", async () => {
  const client = createClient({ WELCOME_ENABLED: "false" });
  client.channels.cache.set("1", { id: "1", name: "vent" });
  await assert.rejects(client.rest.post("/channels/1/messages", { body: { content: "hi" } }), { code: "VENT_CHANNEL" });
  await client.destroy();
});
