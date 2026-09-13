import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { TASKS } from "@langchain/langgraph-checkpoint";

export class ConversationSqliteSaver extends SqliteSaver {
  static fromConnString(databasePath) {
    const saver = SqliteSaver.fromConnString(databasePath);
    return new ConversationSqliteSaver(saver.db); // Reuse the library's connection setup with our legacy checkpoint reader.
  }

  async migratePendingSends(checkpoint, threadId, parentCheckpointId) {
    await super.migratePendingSends(checkpoint, threadId, parentCheckpointId);
    const pending = checkpoint.channel_values[TASKS];
    checkpoint.channel_values[TASKS] = [[], pending]; // Topic checkpoints contain [seen, values], not the raw values array emitted by the SQLite migration.
  } // Preserve every pending task when older saved conversations are loaded; no database rows are deleted or rewritten here.
}
