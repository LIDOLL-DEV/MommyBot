import { HumanMessage } from "@langchain/core/messages";
import { buildGraph } from "../../graph/graph.js";

/**
 * Handle incoming Discord messages
 */
export async function handleMessage(message, botId) {
  if (message.author.id === botId) return;
  if (!message.content.trim()) return;

  const isPing = message.mentions.users.has(botId);

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🌸 [INCOMING MESSAGE]");
  console.log(`   User: ${message.author.tag}`);
  console.log(`   Content: "${message.content}"`);
  console.log(`   Pinged Bot: ${isPing}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const input = {
    messages: [new HumanMessage(message.content)],
    force_respond: isPing,
  };

  const config = { configurable: { thread_id: message.author.id } };

  try {
    console.log("🌸 [HANDLER] Invoking LangGraph...");
    const graph = buildGraph();
    const result = await graph.invoke(input, config);

    const finalMessage = result.messages[result.messages.length - 1];
    let finalContent = finalMessage?.content || "";
    const userInput = message.content;

    console.log("🌸 [HANDLER] Graph finished.");
    console.log(`   📥 Final state message: "${finalContent}"`);
    console.log(`   📤 Original user input: "${userInput}"`);

    // 🧹 Clean up thinking tags to hide internal thoughts
    // Handles: <think>...</think>, <think>...</think>, <thinking>...</thinking>, <think>...</think>, and ```thinking``` blocks
    const thoughtPatterns = [
      /<think[\s\S]*?<\/think>/gi,
      /<thinking[\s\S]*?<\/thinking>/gi,
      /<think[\s>][\s\S]*?<\/think>/gi,
      /<thinking[\s>][\s\S]*?<\/thinking>/gi,
      /```thinking```[\s\S]*?```\/thinking```/gi,
      // Chinese bracket formats (using actual UTF-8 characters)
      new String('\u3010think\u3011[\s\S]*?\u3010\/think\u3011').replace(/[\[\]\(\)]/g, (m) => '\\' + m),
    ];

    // Simplified approach: just match any tag containing "think" in it
    const cleanedContent = finalContent
      .replace(/<think[^>]*>[\s\S]*?<\/think[^>]*>/gi, '')
      .replace(/<thinking[^>]*>[\s\S]*?<\/thinking[^>]*>/gi, '')
      .replace(/```thinking```[\s\S]*?```\/thinking```/gi, '')
      .replace(/\u3010think\u3011[\s\S]*?\u3010\/think\u3011/gi, '')
      .replace(/\u3010thinking\u3011[\s\S]*?\u3010\/thinking\u3011/gi, '')
      .trim();

    // 🐛 Debug: Log if tags were found
    const hasThinkTags = /<think/i.test(finalContent);
    if (hasThinkTags) {
      console.log("🌸 [CLEANER] ✅ Found and removed thinking tags!");
      console.log(`🌸 [CLEANER] Original had: ${finalContent.length} chars, Cleaned has: ${cleanedContent.length} chars`);
    } else {
      console.log("🌸 [CLEANER] ℹ️ No thinking tags found in output.");
    }

    // 🛡️ Strict Echo Check: Only reply if the cleaned message is DIFFERENT from user input
    if (cleanedContent && cleanedContent.trim() !== userInput.trim()) {
      console.log("🌸 [HANDLER] ✅ Sakura replied! Sending to Discord...");
      console.log(`   📤 Cleaned response: "${cleanedContent}"`);
      
      await message.channel.send(`${message.author} ${cleanedContent}`);
      console.log("🌸 [HANDLER] ✅ Message sent successfully!");
    } else {
      console.log("🌸 [HANDLER] 🤫 Sakura stayed silent (message matches input or was empty).");
    }

  } catch (error) {
    console.error("🌸 [HANDLER] ❌ Error during graph execution:");
    console.error("   ", error.message);
    console.error("   Stack:", error.stack);
    await message.channel.send("Oops! Sakura tripped while thinking. 💕");
  } finally {
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  }
}
