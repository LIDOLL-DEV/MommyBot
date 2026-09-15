import { Annotation } from "@langchain/langgraph";

/**
 * Sakura's Graph State
 * - messages: The conversation history for a specific user
 * - next: The name of the next node to run (router uses this to decide)
 * - force_respond: Direct invitations bypass classification; empty messages and commands still skip
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
  routing_context: Annotation({ default: () => null }), // Replace channel context each turn; never infer activity from a user's old cross-channel memory.
  routing_reason: Annotation({ default: () => "" }), // Keep a short observable reason for responding or staying silent.
});
