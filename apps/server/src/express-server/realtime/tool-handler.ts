/**
 * Tool handler — OpenAI Realtime API function call definitions and execution.
 *
 * Two categories of tools:
 *
 *   TOOL_DEFINITIONS — interactive tools the AI may call spontaneously:
 *     get_user_profile — fetches learner profile from Redis.
 *
 *   FEEDBACK_TOOL_DEFINITION — post-turn analysis, called via forced
 *     tool_choice after every normal AI response:
 *     submit_turn_feedback — structured grammar + fluency assessment of
 *       the user's last utterance.  Result is emitted to the client as a
 *       "turn_feedback" custom event; no audio response follows.
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

// ── §4 Structured Output — feedback tool ─────────────────────────────────────

/**
 * Registered in session.update alongside TOOL_DEFINITIONS, but only ever
 * *called* via a forced response.create after each normal AI turn.
 *
 * The AI evaluates the user's last utterance and fills in:
 *   grammar_errors[]   — zero or more correction objects
 *   fluency_score      — 1 (broken) to 10 (native-like)
 *   tip                — one short actionable improvement tip
 */
export const FEEDBACK_TOOL_DEFINITION = {
  type:        "function" as const,
  name:        "submit_turn_feedback",
  description:
    "Called automatically after each assistant response. " +
    "Evaluate the learner's most recent spoken utterance for grammar, " +
    "vocabulary, and fluency. Provide corrections and a concise improvement tip. " +
    "Do not duplicate feedback from previous turns.",
  parameters: {
    type: "object",
    properties: {
      grammar_errors: {
        type: "array",
        description: "Grammar or vocabulary mistakes in the user's last utterance. Empty array if none.",
        items: {
          type: "object",
          properties: {
            original:   { type: "string", description: "The incorrect phrase as spoken." },
            suggestion: { type: "string", description: "The corrected version." },
            rule:       { type: "string", description: "One-sentence explanation of the rule." },
          },
          required: ["original", "suggestion", "rule"],
        },
      },
      fluency_score: {
        type:        "integer",
        description: "Overall fluency score: 1 = very broken, 10 = fully native-like.",
        minimum: 1,
        maximum: 10,
      },
      tip: {
        type:        "string",
        description: "One short, actionable tip the learner can apply immediately (1–2 sentences).",
      },
    },
    required: ["grammar_errors", "fluency_score", "tip"],
  },
} as const;

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
