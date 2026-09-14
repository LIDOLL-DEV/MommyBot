import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

export class ReportStore {
  constructor(filename) {
    if (filename !== ":memory:") mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new Database(filename);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`CREATE TABLE IF NOT EXISTS report_feeds (
      channel TEXT NOT NULL, url TEXT NOT NULL, cursor INTEGER NOT NULL,
      PRIMARY KEY(channel, url));
      CREATE TABLE IF NOT EXISTS report_deliveries (
      channel TEXT NOT NULL, id TEXT NOT NULL, url TEXT NOT NULL, cursor INTEGER NOT NULL,
      payload TEXT NOT NULL, attempted INTEGER, message_id TEXT,
      PRIMARY KEY(channel, id));`);
  } // Persist report snapshots and channel-specific receipts independently of wallet and identity data.
  cursor(config) { return this.db.prepare("SELECT cursor FROM report_feeds WHERE channel=? AND url=?").get(config.channelId, config.url)?.cursor; }
  initialize(config, cursor) { this.db.prepare("INSERT OR IGNORE INTO report_feeds VALUES (?,?,?)").run(config.channelId, config.url, cursor); }
  get(config, id) { return this.db.prepare("SELECT * FROM report_deliveries WHERE channel=? AND id=?").get(config.channelId, id); }
  pending(config) { return this.db.prepare("SELECT * FROM report_deliveries WHERE channel=? AND message_id IS NULL ORDER BY cursor LIMIT 1").get(config.channelId); }
  prepare(config, report) {
    this.db.prepare("INSERT OR IGNORE INTO report_deliveries (channel,id,url,cursor,payload) VALUES (?,?,?,?,?)").run(config.channelId, report.id, config.url, report.cursor, JSON.stringify(report));
    return this.get(config, report.id);
  } // Save the full document before attempting any external send.
  attempt(config, id, now) { this.db.prepare("UPDATE report_deliveries SET attempted=? WHERE channel=? AND id=? AND attempted IS NULL").run(now, config.channelId, id); }
  complete(config, record, messageId) {
    this.db.transaction(() => {
      this.db.prepare("UPDATE report_deliveries SET message_id=? WHERE channel=? AND id=?").run(messageId, config.channelId, record.id);
      this.advance(config, record.cursor);
    })();
  } // Commit the Discord receipt and cursor together so a restart cannot skip an unfinished send.
  advance(config, cursor) { this.db.prepare("UPDATE report_feeds SET cursor=MAX(cursor,?) WHERE channel=? AND url=?").run(cursor, config.channelId, config.url); }
  close() { this.db.close(); }
}
