import { Annotation } from "@langchain/langgraph";

/**
 * Sakura's Graph State
 * - messages: The conversation history for a specific user
 * - next: The name of the next node to run (router uses this to decide)
 * - force_respond: If true (e.g. user @pinged), Sakura ALWAYS responds
 */
export const SakuraState = Annotation.Root({
  messages: Annotation({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
  // Added 'next' so the graph knows where to route!
  next: Annotation({
    reducer: (x, y) => y ?? x,
    default: () => "__end__",
  }),
  force_respond: Annotation({
    default: () => false,
  }),
});
