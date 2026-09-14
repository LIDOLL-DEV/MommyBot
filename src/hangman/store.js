import Database from "better-sqlite3";
import { randomInt, randomUUID } from "node:crypto";
import { WalletError } from "../wallet/client.js";
import { WORDS, hangmanConfig } from "./words.js";

export class HangmanError extends Error {}

export class HangmanStore {
  constructor(filename, wallet, config = hangmanConfig(), { words = WORDS, draw = randomInt } = {}) {
    if (!words.length || words.some(item => !/^[A-Z]{3,10}$/.test(item.word) || !item.clue)) throw new Error("Hangman words need 3–10 letters and a clue.");
    this.db = new Database(filename); this.db.pragma("journal_mode = WAL");
    this.wallet = wallet; this.config = config; this.words = words; this.draw = draw;
    this.db.exec(`CREATE TABLE IF NOT EXISTS hangman_rounds (
      id TEXT PRIMARY KEY,user_id TEXT NOT NULL,word TEXT NOT NULL,clue TEXT NOT NULL,
      guesses TEXT NOT NULL DEFAULT '',mistakes INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'starting',
      account_id TEXT NOT NULL,base_url TEXT NOT NULL,client_id TEXT NOT NULL,created INTEGER NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS hangman_active ON hangman_rounds(user_id) WHERE status IN ('starting','active');
      CREATE TABLE IF NOT EXISTS hangman_jobs (
      id TEXT PRIMARY KEY,user_id TEXT NOT NULL,request_id TEXT NOT NULL,round_id TEXT NOT NULL,
      action TEXT NOT NULL,letter TEXT NOT NULL,amount INTEGER NOT NULL,state TEXT NOT NULL DEFAULT 'pending',
      attempted INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL,UNIQUE(user_id,request_id));
      CREATE UNIQUE INDEX IF NOT EXISTS hangman_pending ON hangman_jobs(user_id) WHERE state IN ('pending','paid');`);
    const previous = wallet.hasPending;
    wallet.hasPending = user => previous(user) || Boolean(this.pending(user));
    wallet.hangman = this;
  } // Persist each word, guess and payment before network calls; share the wallet lock with every other game.

  pending(user) { return this.db.prepare("SELECT * FROM hangman_jobs WHERE user_id=? AND state IN ('pending','paid')").get(user); }
  round(id) { return this.db.prepare("SELECT * FROM hangman_rounds WHERE id=?").get(id); }
  active(user) { return this.db.prepare("SELECT * FROM hangman_rounds WHERE user_id=? AND status IN ('starting','active')").get(user); }
  pinned(round) {
    const account = this.wallet.requireConnection(round.user_id);
    if (account.account_id !== round.account_id || account.base_url !== round.base_url || account.client_id !== round.client_id) {
      throw new HangmanError("Reconnect the wallet you started this round with before playing or retrying its payment.");
    }
    return account;
  } // Never move an existing round's rewards to a different account after relinking.

  publicRound(round) {
    if (!round || round.status === "starting" || round.status === "cancelled") return null;
    const finished = round.status !== "active";
    const earned = this.db.prepare("SELECT COALESCE(SUM(amount),0) n FROM hangman_jobs WHERE round_id=? AND action='guess' AND state='done'").get(round.id).n;
    return { id: round.id, clue: round.clue, status: round.status, guesses: [...round.guesses],
      letters: [...round.word].map(letter => finished || round.guesses.includes(letter) ? letter : null),
      mistakes: round.mistakes, remaining: this.config.maxMistakes - round.mistakes, earned,
      answer: finished ? round.word : null };
  } // Never send the hidden word or unguessed letters to the browser during play.

  snapshot(user) {
    const round = this.active(user) || this.db.prepare("SELECT * FROM hangman_rounds WHERE user_id=? AND status!='cancelled' ORDER BY rowid DESC LIMIT 1").get(user);
    const pending = this.pending(user);
    const totals = this.db.prepare("SELECT COUNT(*) played,COALESCE(SUM(status='won'),0) won FROM hangman_rounds WHERE user_id=? AND status NOT IN ('starting','cancelled')").get(user);
    const earned = this.db.prepare("SELECT COALESCE(SUM(amount),0) n FROM hangman_jobs WHERE user_id=? AND action='guess' AND state='done'").get(user).n;
    return { round: this.publicRound(round), pending: pending ? { action: pending.action, amount: pending.amount } : null,
      enabled: this.config.enabled, price: 1, maxMistakes: this.config.maxMistakes, rewardPerLetter: 1, totals: { ...totals, earned } };
  } // Expose only the authenticated player's board, paid rewards and progress.

  async act(user, input) {
    const { action, request, round: roundId } = input;
    const letter = typeof input.letter === "string" ? input.letter.toUpperCase() : "";
    if (!["start", "guess", "forfeit"].includes(action) || !/^[\w-]{16,80}$/.test(request || "") ||
      (action !== "start" && !/^[\w-]{16,80}$/.test(roundId || "")) || (action === "guess" && !/^[A-Z]$/.test(letter))) {
      throw new HangmanError("Choose one letter from A to Z, or refresh to start a round.");
    }
    return this.wallet.exclusive(user, async () => {
      const existing = this.db.prepare("SELECT * FROM hangman_jobs WHERE user_id=? AND request_id=?").get(user, request);
      if (existing) {
        if (existing.action !== action || (action !== "start" && existing.round_id !== roundId) || (action === "guess" && existing.letter !== letter)) throw new HangmanError("This request belongs to a different game action.");
        return this.settle(existing);
      }
      if (this.wallet.hasPending(user)) throw new HangmanError("Finish your pending wallet action with Retry payment or /lidollid wallet retry first.");
      let round = action === "start" ? null : this.round(roundId);
      if (action === "start") {
        if (!this.config.enabled) throw new HangmanError("New games are paused. Existing rounds and payment recovery still work.");
        if (this.active(user)) throw new HangmanError("Finish your current word before starting a new round.");
      } else {
        if (!round || round.user_id !== user || round.status !== "active") throw new HangmanError("That round is no longer available. Refresh your game.");
        if (action === "guess" && round.guesses.includes(letter)) throw new HangmanError("You already guessed that letter. Choose another one.");
      }
      const account = action === "start" ? this.wallet.requireConnection(user) : action === "guess" ? this.pinned(round) : null;
      const job = this.db.transaction(() => {
        if (action === "start") {
          const item = this.words[this.draw(this.words.length)], id = randomUUID();
          this.db.prepare("INSERT INTO hangman_rounds(id,user_id,word,clue,account_id,base_url,client_id,created) VALUES (?,?,?,?,?,?,?,?)")
            .run(id, user, item.word, item.clue, account.account_id, account.base_url, account.client_id, Date.now());
          round = this.round(id);
        }
        const amount = action === "start" ? 1 : action === "guess" ? [...round.word].filter(value => value === letter).length : 0;
        if (action === "guess") {
          const guesses = round.guesses + letter, mistakes = round.mistakes + Number(amount === 0);
          const status = [...round.word].every(value => guesses.includes(value)) ? "won" : mistakes >= this.config.maxMistakes ? "lost" : "active";
          this.db.prepare("UPDATE hangman_rounds SET guesses=?,mistakes=?,status=? WHERE id=?").run(guesses, mistakes, status, round.id);
        } else if (action === "forfeit") this.db.prepare("UPDATE hangman_rounds SET status='forfeited' WHERE id=?").run(round.id);
        const id = randomUUID();
        this.db.prepare("INSERT INTO hangman_jobs(id,user_id,request_id,round_id,action,letter,amount,state,created) VALUES (?,?,?,?,?,?,?,?,?)")
          .run(id, user, request, round.id, action, action === "guess" ? letter : "", amount, amount ? "pending" : "done", Date.now());
        return this.db.prepare("SELECT * FROM hangman_jobs WHERE id=?").get(id);
      }).immediate();
      return this.settle(job);
    });
  } // Record a correct guess and its exact reward atomically; repeats, wrong guesses and revealed end-of-game letters earn nothing.

  async retry(user) {
    return this.wallet.exclusive(user, async () => {
      const job = this.pending(user);
      if (!job) throw new HangmanError("No hangman payment is waiting.");
      return this.settle(job);
    });
  } // Resume the original debit or letter reward after a timeout, daily cap or restart.

  async settle(saved) {
    const job = this.db.prepare("SELECT * FROM hangman_jobs WHERE id=?").get(saved.id);
    if (job.state === "failed") throw new HangmanError("The entry payment was declined. Check your wallet and start a new game.");
    if (job.state === "pending") {
      const round = this.round(job.round_id), account = this.pinned(round), first = !job.attempted;
      const kind = job.action === "start" ? "debit" : "credit";
      this.db.prepare("UPDATE hangman_jobs SET attempted=1 WHERE id=?").run(job.id);
      try {
        const receipt = await this.wallet.client.operation(account.token, { request_id: job.id, kind, asset: "coins", amount: job.amount });
        if (receipt?.request_id !== job.id || receipt.kind !== kind || receipt.amount !== job.amount || receipt.currency !== "LiDollCoin" ||
          (receipt.asset !== undefined && receipt.asset !== "coins") || !Number.isSafeInteger(receipt.balance) || receipt.balance < 0) throw new HangmanError("The wallet receipt could not be verified. Retry the saved payment.");
        this.db.prepare("UPDATE hangman_jobs SET state='paid' WHERE id=?").run(job.id);
      } catch (error) {
        if (job.action === "start" && first && error instanceof WalletError && [400, 403, 409].includes(error.status)) {
          this.db.transaction(() => {
            this.db.prepare("UPDATE hangman_jobs SET state='failed' WHERE id=?").run(job.id);
            this.db.prepare("UPDATE hangman_rounds SET status='cancelled' WHERE id=?").run(round.id);
          }).immediate();
          throw error;
        }
        const reason = error instanceof WalletError || error instanceof HangmanError ? ` ${error.message}` : "";
        throw new HangmanError(`Payment confirmation is pending.${reason} Press Retry payment; do not start a replacement game.`);
      }
    }
    if (job.state !== "done") this.db.transaction(() => {
      if (job.action === "start") this.db.prepare("UPDATE hangman_rounds SET status='active' WHERE id=? AND status='starting'").run(job.round_id);
      this.db.prepare("UPDATE hangman_jobs SET state='done' WHERE id=?").run(job.id);
    }).immediate();
    return { action: job.action, amount: job.amount, letter: job.letter, round: this.publicRound(this.round(job.round_id)), snapshot: this.snapshot(job.user_id) };
  } // A matching receipt unlocks entry or confirms a reward; atomic completion is safe to replay after storage failures.
  close() { this.db.close(); }
}
