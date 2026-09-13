export function completionText(data) {
  const choice = data?.choices?.[0];
  const raw = choice?.message?.content;
  if (typeof raw === "string" && raw.trim()) return raw.trim();

  const details = {
    finish_reason: choice?.finish_reason ?? null,
    completion_tokens: data?.usage?.completion_tokens ?? null,
    reasoning_chars: typeof choice?.message?.reasoning_content === "string"
      ? choice.message.reasoning_content.length : 0,
    content_type: raw === null ? "null" : typeof raw,
  }; // Report response shape and counters without exposing reasoning text.
  const error = new Error(`Model returned no answer text: ${JSON.stringify(details)}`);
  error.code = "EMPTY_MODEL_RESPONSE";
  throw error;
} // Separate an empty completion from an actual model reply instead of inventing a successful response.
