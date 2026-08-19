import { StateGraph } from "@langchain/langgraph";
import { SakuraState } from "./state.js";
import { routerNode, sakuraLLMNode } from "./nodes.js";
import { checkpointer } from "../db/checkpointer.js";

/**
 * Build Sakura's Conversation Graph
 * Flow: START -> router -> (sakura_llm -> END) OR (END)
 */
export function buildGraph() {
  const workflow = new StateGraph(SakuraState)
    .addNode("router", routerNode)
    .addNode("sakura_llm", sakuraLLMNode)
    .addEdge("__start__", "router")
    .addConditionalEdges("router", (state) => state.next || "__end__")
    .addEdge("sakura_llm", "__end__");

  // Compile with the SQLite checkpointer for persistent memory
  return workflow.compile({ checkpointer });
}
