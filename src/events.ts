export type SessionInitType = "new" | "resume"
export type Provider = "anthropic" | "openai"
export type DeltaType = "thinking" | "text"
export type JsonPrimitive = string | number | boolean | null
export type JsonValue =
{ [key: string]: JsonValue | undefined; }
| JsonValue[]
| JsonPrimitive
export type ToolResult = { type: "success", result: string } | { type: "error", error: string }

export interface TextPart {
    text: string,
}

export interface ThinkingPart {
    thinking: string,
    signature?: string,
}

export interface ToolCallPart {
    id: string,
    name: string,
    arguments: string,
}

export type AssistantMessagePart = ({type: "text" & TextPart} | {type: "thinking" & ThinkingPart} | {type: "toolCall" & ToolCallPart})

export interface Usage {
    latency: number,
    inputTokens: number,
    outputTokens: number,
    cacheWritetokens: number,
    cacheReadTokens: number,
}

export interface SessionInitEvent {
  sessionId: string,
  type: SessionInitType,
  provider: Provider,
  model: string,
  system: string,
  timestamp: Date,
}


/* Event emitted when a session stops. */
export interface SessionStopEvent {
    sessionId: string,
    success: boolean,
    result?: AssistantMessagePart[],
    error?: string,
    timestamp: Date,
    usage: Usage,
}

/* Event emitted when the user submits a prompt. */
export interface UserPromptSubmitEvent {
    sessionId: string,
    turnId: string,
    prompt: string,
    timestamp: Date,
}

/* Event emitted for each delta in a streaming response. */
export interface StreamDeltaEvent {
    sessionId: string,
    turnId: string,
    delta: string,
    type: DeltaType,
    timestamp: Date,
}

/* Event emitted when a tool is called. */
export interface ToolCallEvent {
    sessionId: string,
    turnId: string,
    name: string,
    toolCallId: string,
    input: JsonValue,
    timestamp: Date,
}

/* Event emitted when any tool (generic, skill or tasks) is called. */
export interface ToolCallAnyEvent {
    sessionId: string,
    turnId: string,
    name: string,
    toolCallId: string,
    input: JsonValue,
    timestamp: Date,
}

/* Event emitted when a tool returns a result. */
export interface ToolResultEvent {
    sessionId: string,
    turnId: string,
    result: ToolResult,
    toolCallId: string,
    timestamp: Date,
}

/* Event emitted when a skill is loaded. */
export interface SkillLoadEvent {
    sessionId: string,
    turnId: string,
    skillName: string,
    timestamp: Date,
}


/* Event emitted when the assistant produces a complete response. */
export interface AssistantResponseEvent {
    sessionId: string,
    turnId: string,
    content: AssistantMessagePart[],
    timestamp: Date,
}

export type AgentEvent = SessionInitEvent | SessionStopEvent | UserPromptSubmitEvent | AssistantResponseEvent | ToolCallEvent | ToolCallAnyEvent | SkillLoadEvent | ToolResultEvent | StreamDeltaEvent
