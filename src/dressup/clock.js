export class GameClock {
  constructor(db, realNow = Date.now) {
    this.db = db; this.realNow = realNow;
    db.exec("CREATE TABLE IF NOT EXISTS littlepottchi_clock(id INTEGER PRIMARY KEY CHECK(id=1), paused_total INTEGER NOT NULL, frozen_at INTEGER)");
    db.prepare("INSERT OR IGNORE INTO littlepottchi_clock VALUES (1,0,NULL)").run();
    this.state = db.prepare("SELECT paused_total, frozen_at FROM littlepottchi_clock WHERE id=1").get();
    this.now = () => (this.state.frozen_at ?? this.realNow()) - this.state.paused_total;
  } // Game time stops while frozen and resumes exactly where it left off; the simulation never sees the gap.

  get frozen() { return this.state.frozen_at !== null; }
  offset() { return this.realNow() - this.now(); } // Add to a game timestamp to express it in wall-clock time.

  freeze() {
    if (this.frozen) return false;
    const at = this.realNow();
    this.db.prepare("UPDATE littlepottchi_clock SET frozen_at=? WHERE id=1 AND frozen_at IS NULL").run(at);
    this.state = { ...this.state, frozen_at: at };
    return true;
  }

  thaw() {
    if (!this.frozen) return false;
    const paused = Math.max(0, this.realNow() - this.state.frozen_at);
    const total = this.state.paused_total + paused;
    this.db.prepare("UPDATE littlepottchi_clock SET paused_total=?, frozen_at=NULL WHERE id=1").run(total);
    this.state = { paused_total: total, frozen_at: null };
    return true;
  } // Bank the frozen span, so every timer, task, cooldown and wetting clock resumes with exactly the time it had left.
} // Existing saves need no migration: with nothing paused yet, game time equals wall-clock time.
