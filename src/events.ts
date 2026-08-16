import * as v from "valibot";
import {
  Message,
  MessagePart,
  MessageRole,
  textMessage,
} from "@cle-does-things/llms-sdk";

const SessionInitTypeSchema = v.picklist(["new", "resume"]);
const ProviderSchema = v.picklist(["anthropic", "openai"]);
export type Provider = v.InferOutput<typeof ProviderSchema>;
const DeltaTypeSchema = v.picklist(["text", "thinking"]);

export type JsonData =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonData }
  | JsonData[];
const JsonValueSchema: v.GenericSchema<JsonData> = v.lazy(() =>
  v.union([
    v.string(),
    v.number(),
    v.boolean(),
    v.null(),
    v.record(v.string(), JsonValueSchema),
    v.array(JsonValueSchema),
  ])
);
export type JsonValue = v.InferOutput<typeof JsonValueSchema>;

const ToolResultSchema = v.union([
  v.object({ type: v.literal("success"), result: v.string() }),
  v.object({ type: v.literal("error"), error: v.string() }),
]);
export type ToolResult = v.InferOutput<typeof ToolResultSchema>;

const TextPartSchema = v.object({
  type: v.literal("text"),
  text: v.string(),
});

const ThinkingPartSchema = v.object({
  type: v.literal("thinking"),
  thinking: v.string(),
  signature: v.optional(v.string()),
});

const ToolCallPartSchema = v.object({
  type: v.literal("toolCall"),
  id: v.string(),
  name: v.string(),
  arguments: v.string(),
});

const AssistantMessagePartSchema = v.union([
  TextPartSchema,
  ThinkingPartSchema,
  ToolCallPartSchema,
]);

const UsageSchema = v.object({
  latency: v.number(),
  inputTokens: v.number(),
  outputTokens: v.number(),
  cacheWritetokens: v.number(),
  cacheReadTokens: v.number(),
});

const SessionInitEventSchema = v.object({
  type: v.literal("session.init"),
  sessionId: v.string(),
  initType: SessionInitTypeSchema,
  provider: ProviderSchema,
  model: v.string(),
  system: v.string(),
  timestamp: v.date(),
});

/* Event emitted when a session stops. */
const SessionStopEventSchema = v.object({
  type: v.literal("session.stop"),
  sessionId: v.string(),
  success: v.boolean(),
  result: v.optional(v.array(AssistantMessagePartSchema)),
  error: v.optional(v.string()),
  timestamp: v.date(),
  usage: UsageSchema,
});

/* Event emitted when the user submits a prompt. */
const UserPromptSubmitEventSchema = v.object({
  type: v.literal("user.prompt_submit"),
  sessionId: v.string(),
  turnId: v.string(),
  prompt: v.string(),
  timestamp: v.date(),
});

/* Event emitted for each delta in a streaming response. */
const StreamDeltaEventSchema = v.object({
  type: v.literal("stream.delta"),
  sessionId: v.string(),
  turnId: v.string(),
  delta: v.string(),
  deltaType: DeltaTypeSchema,
  timestamp: v.date(),
});

/* Event emitted when a tool is called. */
const ToolCallEventSchema = v.object({
  type: v.literal("tool.call"),
  sessionId: v.string(),
  turnId: v.string(),
  name: v.string(),
  toolCallId: v.string(),
  input: JsonValueSchema,
  timestamp: v.date(),
});

/* Event emitted when any tool (generic, skill or tasks) is called. */
const ToolCallAnyEventSchema = v.object({
  type: v.literal("tool.call_any"),
  sessionId: v.string(),
  turnId: v.string(),
  name: v.string(),
  toolCallId: v.string(),
  input: JsonValueSchema,
  timestamp: v.date(),
});

/* Event emitted when a tool returns a result. */
const ToolResultEventSchema = v.object({
  type: v.literal("tool.result"),
  sessionId: v.string(),
  turnId: v.string(),
  result: ToolResultSchema,
  toolCallId: v.string(),
  timestamp: v.date(),
});

/* Event emitted when a skill is loaded. */
const SkillLoadEventSchema = v.object({
  type: v.literal("skill.load"),
  sessionId: v.string(),
  turnId: v.string(),
  skillName: v.string(),
  timestamp: v.date(),
});

/* Event emitted when the assistant produces a complete response. */
const AssistantResponseEventSchema = v.object({
  type: v.literal("assistant.response"),
  sessionId: v.string(),
  turnId: v.string(),
  content: v.array(AssistantMessagePartSchema),
  timestamp: v.date(),
});

export const AgentEventSchema = v.union([
  SessionInitEventSchema,
  SessionStopEventSchema,
  UserPromptSubmitEventSchema,
  SkillLoadEventSchema,
  ToolCallAnyEventSchema,
  ToolCallEventSchema,
  AssistantResponseEventSchema,
  ToolResultEventSchema,
  StreamDeltaEventSchema,
]);
export type AgentEvent = v.InferOutput<typeof AgentEventSchema>;

/* Convert persisted `AgentEvent`s back into llms-sdk `Message`s.
Only events that correspond to chat roles (`User`, `Assistant`, `Tool`) are converted. */
export function convertEventsToMessages(events: AgentEvent[]): Message[] {
  const messages: Message[] = [];
  for (const event of events) {
    switch (event.type) {
      case "user.prompt_submit":
        messages.push(textMessage(event.prompt));
        break;
      case "assistant.response": {
        const parts: MessagePart[] = [];
        for (const c of event.content) {
          switch (c.type) {
            case "text":
              parts.push({ text: c.text, type: "text" });
              break;
            case "thinking":
              parts.push({
                thinking: c.thinking,
                signature: c.signature,
                type: "thinking",
              });
              break;
            case "toolCall":
              parts.push({
                type: "toolCall",
                id: c.id,
                arguments: c.arguments,
                name: c.name,
              });
              break;
          }
        }
        messages.push({ role: "assistant" as MessageRole, content: parts });
        break;
      }
      case "tool.call_any":
        messages.push({
          role: "assistant" as MessageRole,
          content: [{
            type: "toolCall",
            id: event.toolCallId,
            name: event.name,
            arguments: JSON.stringify(event.input),
          }],
        });
        break;
      case "tool.result":
        messages.push({
          role: "tool" as MessageRole,
          content: [{
            type: "toolResult",
            toolCallId: event.toolCallId,
            result: event.result.type === "success"
              ? event.result.result
              : `Tool call failed\n${event.result.error}`,
          }],
        });
        break;
      default:
        break;
    }
  }
  return messages;
}
