import path from "node:path";
import { randomUUID } from "node:crypto";
import { TouhouMenus } from "./menu.js";
import { TraderError } from "./store.js";
import { runWalletAction } from "../wallet/commands.js";

export const PUBLIC_GAME_WORLD = "public";

export function publicGameAccess(identities, discord) {
  const player = user => {
    const identity = identities.gameIdentity(user);
    if (!identity) throw new TraderError("Sign in with LiD0llID to play.");
    return identity;
  };
  return {
    async list(user) {
      player(user);
      const servers = identities.get(user) && /^\d{17,20}$/.test(user) ? await discord.list(user) : [];
      return [{ id: PUBLIC_GAME_WORLD, name: "Little Log community" }, ...servers];
    },
    async require(world, user) {
      player(user);
      if (world !== PUBLIC_GAME_WORLD) {
        if (!identities.get(user)) throw new TraderError("Choose the Little Log community to play.");
        return discord.require(world, user); // Discord worlds still require fresh, verified membership.
      }
      identities.db.prepare("INSERT OR IGNORE INTO public_game_players VALUES (?)").run(user);
      return { id: world, name: "Little Log community", members: { fetch: async id => {
        if (!identities.db.prepare("SELECT 1 FROM public_game_players WHERE user_id=?").get(id)) throw new TraderError("Ask this player to open the Little Log community first.");
        const identity = player(id);
        return { user: { id, bot: false, username: identity.username } };
      } } };
    },
  };
} // All authenticated players may join; public stock, collections and trades stay separate from Discord worlds.

export function discordGuildAccess(client) {
  const member = async (guildId, user) => {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) throw new TraderError("This Discord server is not available.");
    try { return await guild.members.fetch({ user, force: true }); }
    catch { throw new TraderError("Your membership in this Discord server could not be verified. Try again or choose another server."); }
  };
  return {
    async list(user) {
      const result = [];
      for (const guild of client.guilds.cache.values()) {
        try { await member(guild.id, user); result.push({ id: guild.id, name: guild.name }); } catch { /* Do not reveal servers the player cannot access. */ }
      }
      return result;
    },
    async require(guildId, user) {
      if (!/^\d{17,20}$/.test(guildId || "")) throw new TraderError("Choose a Discord server first.");
      await member(guildId, user);
      return { id: guildId, name: client.guilds.cache.get(guildId).name, members: { fetch: id => member(guildId, id) } };
    },
  };
} // Use fresh Discord membership for each selected-server request; never trust a guild ID supplied by a browser.

export class TouhouWebGame {
  constructor(services, guilds) {
    Object.assign(this, services); this.guilds = guilds;
    this.menus = new TouhouMenus(this.store, this.game, { ...services, channelId: "" });
    this.views = new Map();
  } // A separate web presentation shares the live game/battle/payment stores with Discord and has its own menu revisions.
  prune() {
    for (const [key, view] of this.views) if (view.expires <= this.store.now()) this.views.delete(key);
    for (const [key, session] of this.menus.sessions) if (session.expiresAt <= this.store.now()) this.menus.sessions.delete(key);
  }
  view(session, guild) {
    this.prune();
    const key = `${session.token}:${guild.id}`;
    let view = this.views.get(key);
    if (!view) {
      view = { body: this.menus.open(guild.id, session.user_id), expires: this.store.now() + 300000, busy: false };
      this.views.set(key, view);
    }
    return view;
  } // Bind browser UI selections to the authenticated game session and server; reloads resume the current panel.
  serialize(view) {
    const body = view.body, embeds = (body.embeds || []).map(embed => embed.toJSON());
    const images = (body.files || []).map(file => ({ name: file.name, url: `/touhou/art/${encodeURIComponent(path.basename(file.attachment))}` }));
    const imageUrl = url => images.find(image => `attachment://${image.name}` === url)?.url || null;
    return { title: embeds[0]?.title || "Touhou Trader", text: embeds.map(embed => embed.description || "").join("\n"),
      images: embeds.flatMap(embed => [imageUrl(embed.thumbnail?.url), imageUrl(embed.image?.url)]).filter(Boolean),
      rows: (body.components || []).map(row => row.toJSON().components), modal: view.modal || null, notice: view.notice || "" };
  } // Convert only the existing display payload; never serialize store objects, wallet grants or attachment file paths.
  offers(guild, user) {
    return this.store.db.prepare("SELECT id,from_id AS sender_id,to_id AS recipient_id,offered,requested,expires_at AS expires FROM trade_offers WHERE guild_id=? AND to_id=? AND status='pending' AND expires_at>? ORDER BY rowid DESC LIMIT 25").all(guild, user, this.store.now());
  } // Both Discord and web offers arrive in the recipient's private inbox and keep the existing expiry and consent rules.
  async state(session, guildId) {
    if (!guildId) return { guilds: await this.guilds.list(session.user_id), panel: null };
    const guild = await this.guilds.require(guildId, session.user_id), view = this.view(session, guild);
    if (!view.busy && !view.modal) {
      const control = view.body.components?.[0]?.toJSON().components[0]?.custom_id;
      const menu = this.menus.sessions.get(control?.split(":")[1]);
      if (menu) { menu.version++; view.body = this.menus.render(menu); }
      else view.body = this.menus.open(guild.id, session.user_id);
    } // Refresh shared Discord changes and invalidate older dropdown indices before displaying newly sorted choices.
    return { guild: { id: guild.id, name: guild.name }, panel: this.serialize(view), offers: this.offers(guild.id, session.user_id) };
  }
  async act(session, input) {
    const guild = await this.guilds.require(input.guild, session.user_id), view = this.view(session, guild);
    if (view.busy) throw new TraderError("Another menu action is finishing. Refresh before trying again.");
    view.busy = true; view.notice = "";
    try {
      if (input.action === "offer") {
        const offer = this.offers(guild.id, session.user_id).find(offer => offer.id === input.offer);
        if (!offer || !["accept", "decline"].includes(input.decision)) throw new TraderError("This offer is no longer available.");
        if (input.decision === "accept") await guild.members.fetch(offer.sender_id);
        const result = this.store.resolveOffer(guild.id, session.user_id, input.offer, input.decision === "accept", `web:${randomUUID()}`);
        view.notice = result.accepted ? "Trade complete! Both collections are updated." : "Trade declined.";
      } else if (input.action === "cancel-modal") {
        view.modal = null;
      } else if (input.action === "restart-menu") {
        view.body = this.menus.open(guild.id, session.user_id); view.modal = null;
      } else {
        const controls = (view.body.components || []).flatMap(row => row.toJSON().components);
        const modal = view.modal && input.control === view.modal.custom_id;
        const control = controls.find(item => item.custom_id === input.control);
        if ((!control && !modal) || control?.disabled) throw new TraderError("This menu changed. Refresh and use its latest controls.");
        if (control?.type === 3 && !control.options.some(option => option.value === input.value)) throw new TraderError("Choose an item from the displayed list.");
        if (control?.type === 5 && !(guild.id === PUBLIC_GAME_WORLD ? /^(?:web_[a-f0-9]{32}|[0-9]{17,20})$/ : /^[0-9]{17,20}$/).test(input.value || "")) throw new TraderError("Enter the recipient's player ID.");
        if (modal && (typeof input.value !== "string" || !/^\d{1,7}$/.test(input.value))) throw new TraderError("Enter a whole-number price from 1 to 1,000,000.");
        const interaction = { customId: input.control, user: { id: session.user_id }, guildId: guild.id, guild,
          values: input.value === undefined ? [] : [input.value], fields: { getTextInputValue: () => input.value },
          deferUpdate: async () => { interaction.deferred = true; }, deferReply: async () => { interaction.deferred = true; },
          editReply: async body => { if (body.components) { view.body = body; view.modal = null; } else view.notice = body.content; },
          reply: async body => { view.notice = body.content; },
          followUp: async () => { view.notice = "Offer saved. The recipient can accept it in their web trader inbox within one minute."; },
          showModal: async value => { view.modal = value.toJSON(); },
        };
        if (input.control.endsWith(":retry-payment")) {
          view.notice = (await runWalletAction(interaction, this.wallet, {}, "retry")).content;
        } else await this.menus.handle(interaction);
      }
      view.expires = this.store.now() + 300000;
      return { guild: { id: guild.id, name: guild.name }, panel: this.serialize(view), offers: this.offers(guild.id, session.user_id) };
    } finally { view.busy = false; }
  } // Validate the displayed control before adapting it to the existing menu handler, including its ownership and receipt checks.
}
