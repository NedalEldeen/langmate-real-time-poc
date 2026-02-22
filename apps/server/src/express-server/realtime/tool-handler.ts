/**
 * Tool handler — OpenAI Realtime API function call definitions and execution.
 *
 * TOOL_DEFINITIONS — interactive tools the AI may call spontaneously:
 *   get_user_profile — fetches learner profile from Redis.
 *
 * Adding a new interactive tool:
 *   1. Add an entry to TOOL_DEFINITIONS with the JSON schema.
 *   2. Add a handler function to TOOL_HANDLERS keyed by the tool name.
 *
 * Event flow when the AI calls a tool:
 *
 *   OpenAI → response.output_item.added   (item.type: "function_call")
 *   OpenAI → response.function_call_arguments.delta  (streaming JSON args)
 *   OpenAI → response.function_call_arguments.done   (complete args)
 *   OpenAI → response.done   (this response has no audio — just the call)
 *
 *   Server → executeTool(name, argsJson, userId)
 *   Server → conversation.item.create   (type: "function_call_output")
 *   Server → response.create            (AI continues and speaks the result)
 *
 * Note: post-turn grammar/fluency feedback is handled via structured JSON
 * text output (response.text.done) in session-handler.ts — no tool required.
 */

import { UserProfileStore } from "./user-profile-store";

// ── Tool definitions (sent to OpenAI in session.update) ───────────────────────

export const TOOL_DEFINITIONS = [
  {
    type: "function" as const,
    name: "get_user_profile",
    description:
      "Retrieve the learner's profile: their name, native language, " +
      "current level in the target language, topics they enjoy, and " +
      "their learning goals. Call this to personalise your teaching " +
      "style, choose relevant topics, and adapt to their level.",
    parameters: {
      type: "object",
      properties: {},  // no parameters — server resolves the userId from the session
      required:   [] as string[],
    },
  },
] as const;

// ── Tool execution handlers ───────────────────────────────────────────────────

type ToolHandler = (argsJson: string, userId: string) => Promise<string>;

const TOOL_HANDLERS: Record<string, ToolHandler> = {

  async get_user_profile(_argsJson, userId) {
    const profile = await new UserProfileStore(userId).get();

    if (Object.keys(profile).length === 0) {
      return JSON.stringify({
        note: "The user has not configured their profile yet.",
      });
    }

    return JSON.stringify(profile);
  },

};

// ── Public executor ───────────────────────────────────────────────────────────

/**
 * Executes a named tool and returns the result as a JSON string.
 *
 * The returned string is sent back to OpenAI via `conversation.item.create`
 * (type: "function_call_output").  Always returns valid JSON so the AI can
 * parse it reliably.
 *
 * @param name     - Function name as received from the AI.
 * @param argsJson - Raw JSON argument string from `response.function_call_arguments.done`.
 * @param userId   - Session user ID (used to scope Redis lookups).
 */
export async function executeTool(
  name:     string,
  argsJson: string,
  userId:   string,
): Promise<string> {
  const handler = TOOL_HANDLERS[name];

  if (!handler) {
    console.warn(`[tools] unknown tool requested: ${name}`);
    return JSON.stringify({ error: `Unknown tool: ${name}` });
  }

  console.log(`[tools] executing ${name}(${argsJson || "{}"})`);

  try {
    const result = await handler(argsJson, userId);
    console.log(`[tools] ${name} → ${result.slice(0, 120)}`);
    return result;
  } catch (err) {
    console.error(`[tools] ${name} execution failed:`, err);
    return JSON.stringify({ error: "Tool execution failed" });
  }
}
