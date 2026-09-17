import Database from "better-sqlite3";
import { randomInt, randomUUID } from "node:crypto";
import { WalletError } from "../wallet/client.js";
import { BOOKS, GoFishError, computerAsk, deal, describe, goFishConfig, other, over, play, winner } from "./rules.js";

export { GoFishError };
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Unambiguous characters keep a spoken or retyped invite code usable.
const LIVE = ["starting", "waiting", "active"];
const cards = value => (value ? value.split(",") : []);

export class GoFishStore {
  constructor(filename, wallet, config = goFishConfig(), { draw = randomInt, now = Date.now } = {}) {
    this.db = new Database(filename); this.db.pragma("journal_mode = WAL");
    this.wallet = wallet; this.config = config; this.draw = draw; this.now = now;
    this.db.exec(`CREATE TABLE IF NOT EXISTS gofish_games (
      id TEXT PRIMARY KEY,mode TEXT NOT NULL,visibility TEXT NOT NULL DEFAULT 'private',
      status TEXT NOT NULL DEFAULT 'starting',code TEXT,invited_id TEXT,
      host_id TEXT NOT NULL,guest_id TEXT,host_name TEXT NOT NULL DEFAULT '',guest_name TEXT NOT NULL DEFAULT '',
      deck TEXT NOT NULL,host_hand TEXT NOT NULL,guest_hand TEXT NOT NULL,
      host_books TEXT NOT NULL DEFAULT '',guest_books TEXT NOT NULL DEFAULT '',
      turn TEXT NOT NULL DEFAULT 'host',log TEXT NOT NULL DEFAULT '[]',
      host_request TEXT,guest_request TEXT,account_id TEXT,base_url TEXT,client_id TEXT,
      expires INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL,updated INTEGER NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS gofish_code ON gofish_games(code) WHERE status='waiting';
      CREATE UNIQUE INDEX IF NOT EXISTS gofish_host_live ON gofish_games(host_id) WHERE status IN ('starting','waiting','active');
      CREATE UNIQUE INDEX IF NOT EXISTS gofish_guest_live ON gofish_games(guest_id) WHERE guest_id IS NOT NULL AND status IN ('starting','waiting','active');
      CREATE TABLE IF NOT EXISTS gofish_jobs (
      id TEXT PRIMARY KEY,user_id TEXT NOT NULL,request_id TEXT NOT NULL,game_id TEXT NOT NULL,
      action TEXT NOT NULL,amount INTEGER NOT NULL,state TEXT NOT NULL DEFAULT 'pending',
      attempted INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL,UNIQUE(user_id,request_id));
      CREATE UNIQUE INDEX IF NOT EXISTS gofish_pending ON gofish_jobs(user_id) WHERE state IN ('pending','paid');`);
    const previous = wallet.hasPending;
    wallet.hasPending = user => previous(user) || Boolean(this.pending(user));
    wallet.gofish = this;
  } // Persist every deal, ask and payment before network calls; share the wallet lock with the other games.

  pending(user) { return this.db.prepare("SELECT * FROM gofish_jobs WHERE user_id=? AND state IN ('pending','paid')").get(user); }
  game(id) { return this.db.prepare("SELECT * FROM gofish_games WHERE id=?").get(id); }
  live(user) { return this.db.prepare(`SELECT * FROM gofish_games WHERE (host_id=? OR guest_id=?) AND status IN (${LIVE.map(() => "?").join(",")})`).get(user, user, ...LIVE); }
  latest(user) { return this.live(user) || this.db.prepare("SELECT * FROM gofish_games WHERE (host_id=? OR guest_id=?) AND status NOT IN ('starting','cancelled') ORDER BY updated DESC LIMIT 1").get(user, user); }
  seatOf(row, user) { return row.host_id === user ? "host" : row.guest_id === user ? "guest" : null; }

  pinned(row) {
    const account = this.wallet.requireConnection(row.host_id);
    if (account.account_id !== row.account_id || account.base_url !== row.base_url || account.client_id !== row.client_id) {
      throw new GoFishError("Reconnect the wallet you started this game with before playing or retrying its payment.");
    }
    return account;
  } // Never move an existing game's rewards to a different account after relinking.

  state(row) {
    return { deck: cards(row.deck), hands: { host: cards(row.host_hand), guest: cards(row.guest_hand) },
      books: { host: row.host_books, guest: row.guest_books }, turn: row.turn, log: JSON.parse(row.log) };
  }
  write(id, state, status) {
    this.db.prepare(`UPDATE gofish_games SET deck=?,host_hand=?,guest_hand=?,host_books=?,guest_books=?,turn=?,log=?,status=?,updated=? WHERE id=?`)
      .run(state.deck.join(","), state.hands.host.join(","), state.hands.guest.join(","), state.books.host, state.books.guest,
        state.turn, JSON.stringify(state.log), status, this.now(), id);
  }

  code() {
    for (let attempt = 0; attempt < 50; attempt++) {
      const value = Array.from({ length: 8 }, () => CODE_ALPHABET[this.draw(CODE_ALPHABET.length)]).join("");
      const text = `${value.slice(0, 4)}-${value.slice(4)}`;
      if (!this.db.prepare("SELECT 1 FROM gofish_games WHERE code=? AND status='waiting'").get(text)) return text;
    }
    throw new GoFishError("Too many invites are open right now. Try again in a moment.");
  } // Reuse a retired code only after its game leaves the waiting list.

  publicGame(row, user) {
    if (!row || row.status === "starting" || row.status === "cancelled") return null;
    const seat = this.seatOf(row, user);
    if (!seat) return null; // Only the two seated players ever receive a table.
    const foe = other(seat), state = this.state(row);
    const finished = !["waiting", "active"].includes(row.status);
    const earned = this.db.prepare("SELECT COALESCE(SUM(amount),0) n FROM gofish_jobs WHERE game_id=? AND action='ask' AND state='done'").get(row.id).n;
    return { id: row.id, mode: row.mode, status: row.status, visibility: row.visibility,
      code: row.status === "waiting" && row.host_id === user ? row.code : null,
      you: { seat, hand: [...state.hands[seat]].sort(), books: [...state.books[seat]] },
      them: { name: row.mode === "solo" ? "The computer" : (seat === "host" ? row.guest_name : row.host_name) || "Your friend",
        cards: state.hands[foe].length, books: [...state.books[foe]] },
      pond: state.deck.length, yourTurn: row.status === "active" && state.turn === seat,
      log: state.log.slice(-8).map(event => describe(event, seat)).reverse(),
      result: finished ? (row.status === "forfeited" ? (seat === state.turn ? "left" : "won") : winner(state) === "tie" ? "tie" : winner(state) === seat ? "won" : "lost") : null,
      earned: row.mode === "solo" ? earned : 0 };
  } // Send only this player's own cards; the pond and the opponent's hand never leave the server.

  lobby(user) {
    return this.db.prepare("SELECT id,host_name,created FROM gofish_games WHERE status='waiting' AND visibility='open' AND invited_id IS NULL AND host_id!=? AND expires>? ORDER BY created LIMIT 12")
      .all(user, this.now()).map(row => ({ id: row.id, host: row.host_name || "A player", waiting: row.created }));
  } // The open table lists only games whose host chose to be found, never code or challenge invites.

  snapshot(user) {
    const row = this.latest(user), pending = this.pending(user);
    const totals = this.db.prepare(`SELECT COUNT(*) played,COALESCE(SUM(CASE
      WHEN status='forfeited' THEN ((host_id=@user AND turn!='host') OR (guest_id=@user AND turn!='guest'))
      ELSE ((host_id=@user AND LENGTH(host_books)>LENGTH(guest_books)) OR (guest_id=@user AND LENGTH(guest_books)>LENGTH(host_books))) END),0) won
      FROM gofish_games WHERE (host_id=@user OR guest_id=@user) AND status IN ('finished','forfeited')`).get({ user });
    const earned = this.db.prepare("SELECT COALESCE(SUM(amount),0) n FROM gofish_jobs WHERE user_id=? AND action='ask' AND state='done'").get(user).n;
    return { game: this.publicGame(row, user), pending: pending ? { action: pending.action, amount: pending.amount } : null,
      lobby: this.live(user) ? [] : this.lobby(user), enabled: this.config.enabled, price: this.config.price,
      rewardPerBook: this.config.rewardPerBook, books: BOOKS, totals: { ...totals, earned } };
  } // Expose only the authenticated player's table, saved rewards and progress.

  challenge(user, invited, name = "") {
    if (!this.config.enabled) throw new GoFishError("New games are paused. Finish any game already in progress.");
    if (invited === user) throw new GoFishError("Challenge a friend, not yourself.");
    if (this.live(user)) throw new GoFishError("Finish or leave your current game before starting another.");
    const id = randomUUID(), code = this.code(), state = deal(this.draw);
    this.db.prepare(`INSERT INTO gofish_games(id,mode,visibility,status,code,invited_id,host_id,host_name,deck,host_hand,guest_hand,host_books,guest_books,turn,log,expires,created,updated)
      VALUES (?,'friend','private','waiting',?,?,?,?,?,?,?,?,?,'host','[]',?,?,?)`)
      .run(id, code, invited, user, name, state.deck.join(","), state.hands.host.join(","), state.hands.guest.join(","),
        state.books.host, state.books.guest, this.now() + this.config.challengeMinutes * 60000, this.now(), this.now());
    return { id, code };
  } // A Discord challenge is one private code bound to the invited player and a short expiry.

  async act(user, input, { name = "" } = {}) {
    const { action, request } = input;
    if (!["create", "join", "ask", "leave"].includes(action) || !/^[\w-]{16,80}$/.test(request || "")) throw new GoFishError("Refresh your game and try that again.");
    const existing = this.db.prepare("SELECT * FROM gofish_jobs WHERE user_id=? AND request_id=?").get(user, request);
    if (existing) {
      if (existing.action !== action) throw new GoFishError("This request belongs to a different game action.");
      return this.settle(existing);
    }
    const solo = action === "create" ? input.mode !== "friend" : false;
    if (action === "create" && solo) return this.start(user, request);
    if (action === "ask") return this.ask(user, input, request);
    return { action, snapshot: this.free(user, input, request, name) };
  } // One saved request ID per player replays a lost answer instead of dealing or paying twice.

  free(user, input, request, name) {
    return this.db.transaction(() => {
      if (this.db.prepare("SELECT 1 FROM gofish_games WHERE (host_id=? AND host_request=?) OR (guest_id=? AND guest_request=?)").get(user, request, user, request)) return this.snapshot(user); // A lost answer replays to the same table instead of dealing another.
      if (input.action === "create") {
        if (!this.config.enabled) throw new GoFishError("New games are paused. Finish any game already in progress.");
        if (this.live(user)) throw new GoFishError("Finish or leave your current game before starting another.");
        const open = input.visibility === "open", id = randomUUID(), state = deal(this.draw);
        this.db.prepare(`INSERT INTO gofish_games(id,mode,visibility,status,code,host_id,host_name,deck,host_hand,guest_hand,host_books,guest_books,turn,log,host_request,expires,created,updated)
          VALUES (?,'friend',?,'waiting',?,?,?,?,?,?,?,?,'host','[]',?,?,?,?)`)
          .run(id, open ? "open" : "private", open ? null : this.code(), user, name, state.deck.join(","), state.hands.host.join(","),
            state.hands.guest.join(","), state.books.host, state.books.guest, request,
            this.now() + this.config.waitMinutes * 60000, this.now(), this.now());
        return this.snapshot(user);
      }
      if (input.action === "join") {
        const code = typeof input.code === "string" ? input.code.trim().toUpperCase() : "";
        const row = code ? this.db.prepare("SELECT * FROM gofish_games WHERE code=? AND status='waiting'").get(code.includes("-") ? code : `${code.slice(0, 4)}-${code.slice(4)}`)
          : this.db.prepare("SELECT * FROM gofish_games WHERE id=? AND status='waiting' AND visibility='open' AND invited_id IS NULL").get(String(input.game || ""));
        if (!row || row.expires <= this.now()) throw new GoFishError("That game is no longer waiting. Ask for a fresh invite or start your own.");
        if (row.host_id === user) throw new GoFishError("That is your own game. Share its code with a friend instead."); // Say so before the busy check, or your own code reads as a mistake you made.
        if (this.live(user)) throw new GoFishError("Finish or leave your current game before joining another.");
        if (row.invited_id && row.invited_id !== user) throw new GoFishError("Only the challenged player can join this game.");
        this.db.prepare("UPDATE gofish_games SET guest_id=?,guest_name=?,status='active',guest_request=?,expires=0,updated=? WHERE id=? AND status='waiting'")
          .run(user, name, request, this.now(), row.id);
        return this.snapshot(user);
      }
      const row = this.live(user), seat = this.seatOf(row, user);
      if (!row) throw new GoFishError("You have no game to leave. Refresh your table.");
      if (row.status === "waiting") this.db.prepare("UPDATE gofish_games SET status='cancelled',code=NULL,updated=? WHERE id=?").run(this.now(), row.id);
      else {
        const state = this.state(row);
        state.turn = seat; // The leaver stays recorded as the seat that gave up the table.
        this.write(row.id, state, "forfeited");
      }
      this.db.prepare(`UPDATE gofish_games SET ${seat}_request=? WHERE id=?`).run(request, row.id);
      return this.snapshot(user);
    }).immediate();
  } // Friend tables and invites move no coins, so they settle in one transaction without the wallet lock.

  async start(user, request) {
    return this.wallet.exclusive(user, async () => {
      if (!this.config.enabled) throw new GoFishError("New games are paused. Existing games and payment recovery still work.");
      if (this.wallet.hasPending(user)) throw new GoFishError("Finish your pending wallet action with Retry payment or /lidollid wallet retry first.");
      if (this.live(user)) throw new GoFishError("Finish or leave your current game before starting another.");
      const account = this.wallet.requireConnection(user);
      const job = this.db.transaction(() => {
        const id = randomUUID(), state = deal(this.draw), jobId = randomUUID();
        this.db.prepare(`INSERT INTO gofish_games(id,mode,visibility,status,host_id,deck,host_hand,guest_hand,host_books,guest_books,turn,log,host_request,account_id,base_url,client_id,created,updated)
          VALUES (?,'solo','private','starting',?,?,?,?,?,?,'host','[]',?,?,?,?,?,?)`)
          .run(id, user, state.deck.join(","), state.hands.host.join(","), state.hands.guest.join(","), state.books.host,
            state.books.guest, request, account.account_id, account.base_url, account.client_id, this.now(), this.now());
        this.db.prepare("INSERT INTO gofish_jobs(id,user_id,request_id,game_id,action,amount,state,created) VALUES (?,?,?,?,'create',?,'pending',?)")
          .run(jobId, user, request, id, this.config.price, this.now());
        return this.db.prepare("SELECT * FROM gofish_jobs WHERE id=?").get(jobId);
      }).immediate();
      return this.settle(job);
    });
  } // Deal and journal the entry coin together so a lost response reopens the same table instead of a new one.

  move(row, user, rank) {
    const seat = this.seatOf(row, user), state = this.state(row);
    if (row.status !== "active") throw new GoFishError("That game is not accepting moves. Refresh your table.");
    if (state.turn !== seat) throw new GoFishError("It is not your turn yet.");
    const event = play(state, seat, rank);
    let books = event.books.length;
    for (let guard = 0; row.mode === "solo" && !over(state) && state.turn === "guest" && guard < 200; guard++) play(state, "guest", computerAsk(state, this.draw));
    this.write(row.id, state, over(state) ? "finished" : "active");
    return { books, asked: rank, event };
  } // The computer answers inside the player's own move, and only the player's own books can earn coins.

  async ask(user, input, request) {
    const row = this.live(user);
    if (!row || !this.seatOf(row, user)) throw new GoFishError("You have no game in progress. Start one below.");
    if (row.mode !== "solo") {
      const seat = this.seatOf(row, user);
      if (row[`${seat}_request`] === request) return { action: "ask", amount: 0, snapshot: this.snapshot(user) };
      const result = this.db.transaction(() => {
        const current = this.game(row.id), outcome = this.move(current, user, input.rank);
        this.db.prepare(`UPDATE gofish_games SET ${seat}_request=? WHERE id=?`).run(request, row.id);
        return outcome;
      }).immediate();
      return { action: "ask", amount: 0, asked: result.asked, got: result.event.got, wish: result.event.wish, books: result.event.books, snapshot: this.snapshot(user) };
    }
    return this.wallet.exclusive(user, async () => {
      if (this.wallet.hasPending(user)) throw new GoFishError("Finish your pending wallet action with Retry payment or /lidollid wallet retry first.");
      this.pinned(row);
      const { job, outcome } = this.db.transaction(() => {
        const current = this.game(row.id), played = this.move(current, user, input.rank), id = randomUUID();
        this.db.prepare("INSERT INTO gofish_jobs(id,user_id,request_id,game_id,action,amount,state,created) VALUES (?,?,?,?,'ask',?,?,?)")
          .run(id, user, request, row.id, played.books * this.config.rewardPerBook, played.books ? "pending" : "done", this.now());
        return { job: this.db.prepare("SELECT * FROM gofish_jobs WHERE id=?").get(id), outcome: played };
      }).immediate();
      const settled = await this.settle(job);
      return { ...settled, asked: outcome.asked, got: outcome.event.got, wish: outcome.event.wish, books: outcome.event.books };
    });
  } // Record the ask and its exact book reward atomically; the wallet is touched only for a solo player's own books.

  async retry(user) {
    return this.wallet.exclusive(user, async () => {
      const job = this.pending(user);
      if (!job) throw new GoFishError("No Go Fish payment is waiting.");
      return this.settle(job);
    });
  } // Resume the original debit or book reward after a timeout, daily cap or restart.

  async settle(saved) {
    const job = this.db.prepare("SELECT * FROM gofish_jobs WHERE id=?").get(saved.id);
    if (job.state === "failed") throw new GoFishError("The entry payment was declined. Check your wallet and start a new game.");
    if (job.state === "pending") {
      const row = this.game(job.game_id), account = this.pinned(row), first = !job.attempted;
      const kind = job.action === "create" ? "debit" : "credit";
      this.db.prepare("UPDATE gofish_jobs SET attempted=1 WHERE id=?").run(job.id);
      try {
        const receipt = await this.wallet.client.operation(account.token, { request_id: job.id, kind, asset: "coins", amount: job.amount });
        if (receipt?.request_id !== job.id || receipt.kind !== kind || receipt.amount !== job.amount || receipt.currency !== "LiDollCoin" ||
          (receipt.asset !== undefined && receipt.asset !== "coins") || !Number.isSafeInteger(receipt.balance) || receipt.balance < 0) throw new GoFishError("The wallet receipt could not be verified. Retry the saved payment.");
        this.db.prepare("UPDATE gofish_jobs SET state='paid' WHERE id=?").run(job.id);
      } catch (error) {
        if (job.action === "create" && first && error instanceof WalletError && [400, 403, 409].includes(error.status)) {
          this.db.transaction(() => {
            this.db.prepare("UPDATE gofish_jobs SET state='failed' WHERE id=?").run(job.id);
            this.db.prepare("UPDATE gofish_games SET status='cancelled' WHERE id=?").run(row.id);
          }).immediate();
          throw error;
        }
        const reason = error instanceof WalletError || error instanceof GoFishError ? ` ${error.message}` : "";
        throw new GoFishError(`Payment confirmation is pending.${reason} Press Retry payment; do not start a replacement game.`);
      }
    }
    if (job.state !== "done") this.db.transaction(() => {
      if (job.action === "create") this.db.prepare("UPDATE gofish_games SET status='active' WHERE id=? AND status='starting'").run(job.game_id);
      this.db.prepare("UPDATE gofish_jobs SET state='done' WHERE id=?").run(job.id);
    }).immediate();
    return { action: job.action, amount: job.amount, snapshot: this.snapshot(job.user_id) };
  } // A matching receipt opens the table or confirms a book reward; atomic completion is safe to replay.

  prune() {
    this.db.prepare("UPDATE gofish_games SET status='cancelled',code=NULL WHERE status='waiting' AND expires>0 AND expires<=?").run(this.now());
  } // Retire unanswered invites and open tables so their hosts can start again.
  close() { this.db.close(); }
}
