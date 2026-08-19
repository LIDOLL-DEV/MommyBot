import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, "../../data/memory.db");

// Ensure the data directory exists
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize SQLite checkpointer
export const checkpointer = await SqliteSaver.fromConnString(dbPath);

// Helper to initialize the database tables
export async function initCheckpointer() {
  await checkpointer.setup();
  console.log("🌸 Sakura's memory database initialized!");
}
