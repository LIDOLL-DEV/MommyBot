/**
 * Keep Sakura silent in vent channels: no messages, replies, reactions, threads or typing indicators.
 * A channel counts as a vent space when its name, or its parent channel's or category's, has the word "vent" or "venting".
 */
const VENT_WORDS = new Set(["vent", "venting"]);
const WRITE_ROUTE = /^\/channels\/(\d+)\/(?:messages|threads|typing)(?:\/|$)/; // Channel settings and permission routes stay open to admin tools.

export function isVentName(name) {
  return typeof name === "string" && name.toLowerCase().split(/[^a-z0-9]+/).some(word => VENT_WORDS.has(word)); // "vent-chat" and "💭・venting" match; "events" and "adventure" do not.
}

export function isVentChannel(channel) {
  for (let current = channel, depth = 0; current && depth < 3; current = current.parent, depth++) {
    if (isVentName(current.name)) return true;
  } // Thread → channel → category.
  return false;
}

export class VentChannelError extends Error {
  constructor(channelId) {
    super(`Sakura does not post in vent channels (${channelId}).`);
    this.name = "VentChannelError";
    this.code = "VENT_CHANNEL";
  }
}

/**
 * Wrap the client's REST requests so a write to a vent channel is refused before it reaches Discord.
 * Refusals reject like any other Discord API error, which every sender already handles.
 */
export function guardVentChannels(client) {
  const rest = client.rest;
  const request = rest.request.bind(rest);
  async function channelFor(id) {
    const cached = client.channels.cache.get(id);
    if (cached) return cached;
    try { return await client.channels.fetch(id); }
    catch { return null; } // An unreadable channel is left to Discord's own permission checks.
  }
  rest.request = async options => {
    const method = String(options?.method ?? "GET").toUpperCase();
    const target = method === "GET" || method === "DELETE" ? null : WRITE_ROUTE.exec(options?.fullRoute ?? ""); // Cleanup deletes stay allowed.
    if (target && isVentChannel(await channelFor(target[1]))) throw new VentChannelError(target[1]);
    return request(options);
  };
  return client;
}
