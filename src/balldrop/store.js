import Database from "better-sqlite3";
import { randomInt, randomUUID } from "node:crypto";
import { WalletError } from "../wallet/client.js";
import { BETS, WIDTH, HEIGHT, OBSTACLES, COIN_REWARD, BallDropError, ballDropConfig, obstacleDrop, payout } from "./rules.js";
export { BallDropError } from "./rules.js";

export class BallDropStore {
  constructor(filename, wallet, config = ballDropConfig(), { draw = randomInt, obstacles = OBSTACLES } = {}) {
    this.db = new Database(filename); this.db.pragma("journal_mode = WAL");
    this.wallet = wallet; this.config = config; this.draw = draw; this.obstacles = obstacles.map(obstacle => ({ ...obstacle }));
    this.db.exec(`CREATE TABLE IF NOT EXISTS balldrop_rounds (
      id TEXT PRIMARY KEY,user_id TEXT NOT NULL,request_id TEXT NOT NULL,
      bet INTEGER NOT NULL CHECK(bet IN (1,5,10,25,50,100)),guess INTEGER NOT NULL CHECK(guess BETWEEN 1 AND 10),
      path TEXT NOT NULL,landing INTEGER NOT NULL CHECK(landing BETWEEN 1 AND 10),payout INTEGER NOT NULL CHECK(payout>=0),
      state TEXT NOT NULL DEFAULT 'debit' CHECK(state IN ('debit','credit','done','failed')),
      debit_attempted INTEGER NOT NULL DEFAULT 0,account_id TEXT NOT NULL,base_url TEXT NOT NULL,client_id TEXT NOT NULL,
      created INTEGER NOT NULL,UNIQUE(user_id,request_id));
      CREATE UNIQUE INDEX IF NOT EXISTS balldrop_pending ON balldrop_rounds(user_id) WHERE state IN ('debit','credit');`);
    const columns = new Set(this.db.prepare("PRAGMA table_info(balldrop_rounds)").all().map(column => column.name));
    for (const column of ["obstacles", "trajectory"]) if (!columns.has(column)) this.db.exec(`ALTER TABLE balldrop_rounds ADD COLUMN ${column} TEXT NOT NULL DEFAULT '[]'`);
    if (!columns.has("bonus")) this.db.exec("ALTER TABLE balldrop_rounds ADD COLUMN bonus INTEGER NOT NULL DEFAULT 0 CHECK(bonus>=0)");
    // Add snapshots without rerolling legacy drops; an empty trajectory replays the original row-by-row path.
    const previous = wallet.hasPending;
    wallet.hasPending = user => previous(user) || Boolean(this.pending(user));
    wallet.balldrop = this;
  } // Load durable debit/payout reservations before HTTP starts and compose them with every other wallet guard.

  pending(user) { return this.db.prepare("SELECT * FROM balldrop_rounds WHERE user_id=? AND state IN ('debit','credit')").get(user); }
  round(id) { return this.db.prepare("SELECT * FROM balldrop_rounds WHERE id=?").get(id); }
  publicRound(round) {
    if (!round || ["debit", "failed"].includes(round.state)) return null;
    return { id: round.id, bet: round.bet, guess: round.guess, path: JSON.parse(round.path), landing: round.landing,
      obstacles: JSON.parse(round.obstacles), trajectory: JSON.parse(round.trajectory),
      bonus: round.bonus, basePayout: round.payout - round.bonus,
      payout: round.payout, state: round.state, created: round.created };
  } // Never reveal the random entry or landing before a matching debit receipt has been saved.
  snapshot(user) {
    const pending = this.pending(user);
    const latest = this.db.prepare("SELECT * FROM balldrop_rounds WHERE user_id=? AND state!='failed' ORDER BY rowid DESC LIMIT 1").get(user);
    const recent = this.db.prepare("SELECT * FROM balldrop_rounds WHERE user_id=? AND state='done' ORDER BY rowid DESC LIMIT 8").all(user);
    const receipt = this.db.prepare("SELECT request_id AS request,state FROM balldrop_rounds WHERE user_id=? ORDER BY rowid DESC LIMIT 1").get(user);
    return { enabled: this.config.enabled, bets: BETS, width: WIDTH, height: HEIGHT, rounding: "up",
      obstacles: this.obstacles.map(obstacle => ({ ...obstacle })), coinReward: COIN_REWARD,
      round: this.publicRound(latest), recent: recent.map(round => this.publicRound(round)), receipt: receipt || null,
      pending: pending ? { action: pending.state, amount: pending.state === "debit" ? pending.bet : pending.payout } : null };
  } // Return only this player's visible rounds and payment status, without credentials or hidden outcomes.
  pinned(round) {
    const account = this.wallet.requireConnection(round.user_id);
    if (account.account_id !== round.account_id || account.base_url !== round.base_url || account.client_id !== round.client_id) throw new BallDropError("Reconnect the original wallet and API settings to finish this drop's payment.");
    return account;
  } // Keep each debit and its payout attached to the original wallet even after a restart or relink.

  async act(user, input) {
    if (input.action !== "drop" || !/^[\w-]{16,80}$/.test(input.request || "") || !BETS.includes(input.bet) || !Number.isInteger(input.guess) || input.guess < 1 || input.guess > WIDTH) throw new BallDropError("Choose a pocket from 1 to 10 and a bet of 1, 5, 10, 25, 50 or 100 coins.");
    return this.wallet.exclusive(user, async () => {
      const existing = this.db.prepare("SELECT * FROM balldrop_rounds WHERE user_id=? AND request_id=?").get(user, input.request);
      if (existing) {
        if (existing.bet !== input.bet || existing.guess !== input.guess) throw new BallDropError("This request belongs to a different bet. Refresh your game.");
        return this.settle(existing);
      }
      if (!this.config.enabled) throw new BallDropError("New drops are paused. You can still recover a pending payment.");
      if (this.wallet.hasPending(user)) throw new BallDropError("Finish your pending wallet action with Retry payment or /lidollid wallet retry first.");
      const account = this.wallet.requireConnection(user), drop = obstacleDrop(this.draw, this.obstacles), landing = drop.path.at(-1), id = randomUUID();
      this.db.prepare("INSERT INTO balldrop_rounds(id,user_id,request_id,bet,guess,path,landing,payout,account_id,base_url,client_id,created,obstacles,trajectory,bonus) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(id, user, input.request, input.bet, input.guess, JSON.stringify(drop.path), landing, payout(input.bet, input.guess, landing) + drop.bonus, account.account_id, account.base_url, account.client_id, Date.now(), JSON.stringify(drop.obstacles), JSON.stringify(drop.trajectory), drop.bonus);
      return this.settle(this.round(id));
    });
  } // Lock the player, freeze the wager and random path, then debit once; browser-supplied results never affect a payout.

  async retry(user) {
    return this.wallet.exclusive(user, async () => {
      const round = this.pending(user);
      if (!round) throw new BallDropError("No ball-drop payment is waiting.");
      return this.settle(round);
    });
  } // Retry only the existing round, using the same path, bet and provider operation IDs.

  async payment(round, kind, amount) {
    const account = this.pinned(round), requestId = `balldrop-${round.id}-${kind}`;
    const receipt = await this.wallet.client.operation(account.token, { request_id: requestId, kind, asset: "coins", amount });
    if (receipt?.request_id !== requestId || receipt.kind !== kind || receipt.amount !== amount || receipt.currency !== "LiDollCoin" ||
      (receipt.asset !== undefined && receipt.asset !== "coins") || !Number.isSafeInteger(receipt.balance) || receipt.balance < 0) throw new BallDropError("The wallet receipt could not be verified. Retry the saved payment.");
  } // Confirm amount, currency, operation and balance before changing any saved payment state.

  async settle(saved) {
    let round = this.round(saved.id);
    if (round.state === "failed") throw new BallDropError("This bet's entry payment was declined. Check your wallet before making a new bet.");
    if (round.state === "debit") {
      const first = !round.debit_attempted;
      this.pinned(round); // A missing or changed connection must not count as an attempted network debit.
      this.db.prepare("UPDATE balldrop_rounds SET debit_attempted=1 WHERE id=?").run(round.id);
      try {
        await this.payment(round, "debit", round.bet);
        this.db.prepare("UPDATE balldrop_rounds SET state='credit' WHERE id=?").run(round.id);
      } catch (error) {
        if (first && error instanceof WalletError && [400, 403, 409].includes(error.status)) {
          this.db.prepare("UPDATE balldrop_rounds SET state='failed' WHERE id=?").run(round.id);
          throw error;
        }
        throw new BallDropError("Entry payment confirmation is pending. Use Retry payment; your original bet and drop are saved.");
      }
      round = this.round(round.id);
    }
    if (round.state === "credit") {
      try {
        if (round.payout > 0) await this.payment(round, "credit", round.payout);
        this.db.prepare("UPDATE balldrop_rounds SET state='done' WHERE id=?").run(round.id);
      } catch {
        throw new BallDropError("Your drop is saved, but its payout is pending. Use Retry payment to collect the same reward.");
      }
    }
    return { round: this.publicRound(this.round(round.id)), snapshot: this.snapshot(round.user_id) };
  } // Lost receipts and storage failures preserve the original debit/credit IDs; a later rejection never erases an uncertain payment.
  close() { this.db.close(); }
}
