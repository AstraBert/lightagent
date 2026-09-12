import { assert, assertEquals, assertFalse } from "@std/assert";
import * as v from "valibot";
import type { MessagePart } from "@cle-does-things/llms-sdk-wasm";
import {
  type AgentEvent,
  AgentEventSchema,
  assistantContentToMessage,
  type AssistantMessagePart,
  convertEventsToMessages,
  isProvider,
  messageToAssistantContent,
} from "../src/events.ts";

const usage = {
  latency: 100,
  inputTokens: 10,
  outputTokens: 20,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
};

Deno.test("isProvider - accepts valid providers", () => {
  assert(isProvider("anthropic"));
  assert(isProvider("openai"));
});

Deno.test("isProvider - rejects invalid values", () => {
  assertFalse(isProvider("google"));
  assertFalse(isProvider("Anthropic"));
  assertFalse(isProvider(""));
  assertFalse(isProvider(42));
  assertFalse(isProvider(null));
  assertFalse(isProvider(undefined));
  assertFalse(isProvider({}));
});

Deno.test("messageToAssistantContent - converts text parts", () => {
  const parts: MessagePart[] = [{ type: "text", text: "hello" }];
  const content = messageToAssistantContent(parts);
  assertEquals(content, [{ type: "text", text: "hello" }]);
});

Deno.test("messageToAssistantContent - converts thinking parts with signature", () => {
  const parts: MessagePart[] = [{
    type: "thinking",
    thinking: "let me think",
    signature: "sig123",
  }];
  const content = messageToAssistantContent(parts);
  assertEquals(content, [{
    type: "thinking",
    thinking: "let me think",
    signature: "sig123",
  }]);
});

Deno.test("messageToAssistantContent - converts toolCall parts", () => {
  const parts: MessagePart[] = [{
    type: "toolCall",
    id: "call-1",
    name: "read",
    arguments: '{"file_path":"a.ts"}',
  }];
  const content = messageToAssistantContent(parts);
  assertEquals(content, [{
    type: "toolCall",
    id: "call-1",
    name: "read",
    arguments: '{"file_path":"a.ts"}',
  }]);
});

Deno.test("messageToAssistantContent - skips unsupported part types", () => {
  const parts: MessagePart[] = [
    { type: "text", text: "before" },
    {
      type: "image",
      image_data: "data",
      is_base64: false,
      mime_type: undefined,
    },
    {
      type: "toolResult",
      tool_call_id: "call-1",
      result: "done",
    },
    { type: "text", text: "after" },
  ];
  const content = messageToAssistantContent(parts);
  assertEquals(content, [
    { type: "text", text: "before" },
    { type: "text", text: "after" },
  ]);
});

Deno.test("messageToAssistantContent - empty input yields empty output", () => {
  assertEquals(messageToAssistantContent([]), []);
});

Deno.test("assistantContentToMessage - builds an assistant message", () => {
  const content: AssistantMessagePart[] = [
    { type: "text", text: "hi" },
    { type: "thinking", thinking: "hmm", signature: "s" },
    {
      type: "toolCall",
      id: "c1",
      name: "write",
      arguments: "{}",
    },
  ];
  const message = assistantContentToMessage(content);
  assertEquals(message.role, "assistant");
  assertEquals(message.content, [
    { type: "text", text: "hi" },
    { type: "thinking", thinking: "hmm", signature: "s" },
    { type: "toolCall", id: "c1", name: "write", arguments: "{}" },
  ]);
});

Deno.test("messageToAssistantContent and assistantContentToMessage round-trip", () => {
  const original: MessagePart[] = [
    { type: "text", text: "answer" },
    { type: "thinking", thinking: "reasoning", signature: "sig" },
    { type: "toolCall", id: "x", name: "tool", arguments: '{"a":1}' },
  ];
  const roundTripped = assistantContentToMessage(
    messageToAssistantContent(original),
  );
  assertEquals(roundTripped.role, "assistant");
  assertEquals(roundTripped.content, original);
});

Deno.test("convertEventsToMessages - converts user prompts", () => {
  const events: AgentEvent[] = [{
    type: "user.prompt_submit",
    sessionId: "s1",
    turnId: "t1",
    prompt: "hello agent",
    timestamp: new Date(),
  }];
  const messages = convertEventsToMessages(events);
  assertEquals(messages, [{
    role: "user",
    content: [{ type: "text", text: "hello agent" }],
  }]);
});

Deno.test("convertEventsToMessages - converts assistant responses", () => {
  const events: AgentEvent[] = [{
    type: "assistant.response",
    sessionId: "s1",
    turnId: "t1",
    content: [
      { type: "thinking", thinking: "thinking...", signature: "sig" },
      { type: "text", text: "response" },
    ],
    timestamp: new Date(),
  }];
  const messages = convertEventsToMessages(events);
  assertEquals(messages, [{
    role: "assistant",
    content: [
      { type: "thinking", thinking: "thinking...", signature: "sig" },
      { type: "text", text: "response" },
    ],
  }]);
});

Deno.test("convertEventsToMessages - converts tool results, wrapping errors", () => {
  const successEvent: AgentEvent = {
    type: "tool.result",
    sessionId: "s1",
    turnId: "t1",
    toolCallId: "c1",
    result: { type: "success", result: "file contents" },
    timestamp: new Date(),
  };
  const errorEvent: AgentEvent = {
    type: "tool.result",
    sessionId: "s1",
    turnId: "t1",
    toolCallId: "c2",
    result: { type: "error", error: "file not found" },
    timestamp: new Date(),
  };
  const messages = convertEventsToMessages([successEvent, errorEvent]);
  assertEquals(messages, [
    {
      role: "tool",
      content: [{
        type: "toolResult",
        tool_call_id: "c1",
        result: "file contents",
      }],
    },
    {
      role: "tool",
      content: [{
        type: "toolResult",
        tool_call_id: "c2",
        result: "Tool call failed\nfile not found",
      }],
    },
  ]);
});

Deno.test("convertEventsToMessages - converts standalone tool.call_any into assistant toolCall message", () => {
  const events: AgentEvent[] = [{
    type: "tool.call_any",
    sessionId: "s1",
    turnId: "t1",
    name: "skills",
    toolCallId: "c1",
    input: { skill_name: "pdf" },
    timestamp: new Date(),
  }];
  const messages = convertEventsToMessages(events);
  assertEquals(messages, [{
    role: "assistant",
    content: [{
      type: "toolCall",
      id: "c1",
      name: "skills",
      arguments: '{"skill_name":"pdf"}',
    }],
  }]);
});

Deno.test("convertEventsToMessages - skips tool.call_any already present in previous assistant message", () => {
  const events: AgentEvent[] = [
    {
      type: "assistant.response",
      sessionId: "s1",
      turnId: "t1",
      content: [
        { type: "text", text: "calling a tool" },
        {
          type: "toolCall",
          id: "c1",
          name: "read",
          arguments: '{"file_path":"a.ts"}',
        },
      ],
      timestamp: new Date(),
    },
    {
      type: "tool.call_any",
      sessionId: "s1",
      turnId: "t1",
      name: "read",
      toolCallId: "c1",
      input: { file_path: "a.ts" },
      timestamp: new Date(),
    },
  ];
  const messages = convertEventsToMessages(events);
  // The tool.call_any duplicates the toolCall part of the assistant
  // response, so it must not produce an extra message.
  assertEquals(messages.length, 1);
  assertEquals(messages[0].role, "assistant");
  assertEquals(messages[0].content.length, 2);
  assertEquals(
    messages[0].content.filter((c) => c.type === "toolCall").filter((t) =>
      t.id === "c1"
    ).length,
    1,
  );
});

Deno.test("convertEventsToMessages - keeps tool.call_any not present in previous assistant message", () => {
  const events: AgentEvent[] = [
    {
      type: "assistant.response",
      sessionId: "s1",
      turnId: "t1",
      content: [{ type: "text", text: "no tool calls here" }],
      timestamp: new Date(),
    },
    {
      type: "tool.call_any",
      sessionId: "s1",
      turnId: "t1",
      name: "read",
      toolCallId: "c9",
      input: { file_path: "a.ts" },
      timestamp: new Date(),
    },
  ];
  const messages = convertEventsToMessages(events);
  assertEquals(messages.length, 2);
  assertEquals(messages[1], {
    role: "assistant",
    content: [{
      type: "toolCall",
      id: "c9",
      name: "read",
      arguments: '{"file_path":"a.ts"}',
    }],
  });
});

Deno.test("convertEventsToMessages - ignores non-chat events", () => {
  const events: AgentEvent[] = [
    {
      type: "session.init",
      sessionId: "s1",
      initType: "new",
      provider: "anthropic",
      model: "claude",
      system: "you are helpful",
      timestamp: new Date(),
    },
    {
      type: "stream.delta",
      sessionId: "s1",
      turnId: "t1",
      delta: "chunk",
      deltaType: "text",
      timestamp: new Date(),
    },
    {
      type: "skill.load",
      sessionId: "s1",
      turnId: "t1",
      skillName: "pdf",
      timestamp: new Date(),
    },
    {
      type: "tool.call",
      sessionId: "s1",
      turnId: "t1",
      name: "read",
      toolCallId: "c1",
      input: {},
      timestamp: new Date(),
    },
    {
      type: "session.interrupt",
      sessionId: "s1",
      timestamp: new Date(),
    },
    {
      type: "session.stop",
      sessionId: "s1",
      success: true,
      timestamp: new Date(),
      usage,
    },
  ];
  const messages = convertEventsToMessages(events);
  assertEquals(messages, []);
});

Deno.test("convertEventsToMessages - preserves ordering across a full turn", () => {
  const events: AgentEvent[] = [
    {
      type: "user.prompt_submit",
      sessionId: "s1",
      turnId: "t1",
      prompt: "read a file",
      timestamp: new Date(1000),
    },
    {
      type: "assistant.response",
      sessionId: "s1",
      turnId: "t1",
      content: [{
        type: "toolCall",
        id: "c1",
        name: "read",
        arguments: '{"file_path":"a.ts"}',
      }],
      timestamp: new Date(2000),
    },
    {
      type: "tool.call_any",
      sessionId: "s1",
      turnId: "t1",
      name: "read",
      toolCallId: "c1",
      input: { file_path: "a.ts" },
      timestamp: new Date(3000),
    },
    {
      type: "tool.result",
      sessionId: "s1",
      turnId: "t1",
      toolCallId: "c1",
      result: { type: "success", result: "contents" },
      timestamp: new Date(4000),
    },
    {
      type: "assistant.response",
      sessionId: "s1",
      turnId: "t1",
      content: [{ type: "text", text: "here are the contents" }],
      timestamp: new Date(5000),
    },
  ];
  const messages = convertEventsToMessages(events);
  assertEquals(messages.map((m) => m.role), [
    "user",
    "assistant",
    "tool",
    "assistant",
  ]);
});

Deno.test("AgentEventSchema - validates a session.init event", () => {
  const event = {
    type: "session.init",
    sessionId: "s1",
    initType: "resume",
    provider: "openai",
    model: "gpt-5",
    system: "sys",
    timestamp: new Date(),
  } as const;
  const parsed = v.parse(AgentEventSchema, event);
  assertEquals(parsed, event);
});

Deno.test("AgentEventSchema - validates a session.stop event with optional fields", () => {
  const event = {
    type: "session.stop",
    sessionId: "s1",
    success: false,
    error: "boom",
    result: [{ type: "text", text: "partial" }],
    timestamp: new Date(),
    usage,
  } as AgentEvent;
  const parsed = v.parse(AgentEventSchema, event);
  assertEquals(parsed, event);
});

Deno.test("AgentEventSchema - validates tool.call with nested JSON input", () => {
  const event = {
    type: "tool.call",
    sessionId: "s1",
    turnId: "t1",
    name: "edit",
    toolCallId: "c1",
    input: {
      file_path: "a.ts",
      nested: { key: "value", flag: true, count: 3 },
    },
    timestamp: new Date(),
  } as AgentEvent;
  const parsed = v.parse(AgentEventSchema, event);
  assertEquals(parsed, event);
});

Deno.test("AgentEventSchema - validates tool.call with top-level array input", () => {
  const event = {
    type: "tool.call",
    sessionId: "s1",
    turnId: "t1",
    name: "edit",
    toolCallId: "c1",
    input: { list: [1, "two", true, null] },
    timestamp: new Date(),
  } as AgentEvent;
  const parsed = v.parse(AgentEventSchema, event);
  assertEquals((parsed as { input: unknown }).input, {
    list: [1, "two", true, null],
  });
});

Deno.test("AgentEventSchema - rejects unknown event type", () => {
  const event = {
    type: "session.unknown",
    sessionId: "s1",
    timestamp: new Date(),
  };
  const result = v.safeParse(AgentEventSchema, event);
  assertFalse(result.success);
});

Deno.test("AgentEventSchema - rejects invalid initType", () => {
  const event = {
    type: "session.init",
    sessionId: "s1",
    initType: "restart",
    provider: "anthropic",
    model: "m",
    system: "s",
    timestamp: new Date(),
  };
  const result = v.safeParse(AgentEventSchema, event);
  assertFalse(result.success);
});

Deno.test("AgentEventSchema - rejects invalid deltaType", () => {
  const event = {
    type: "stream.delta",
    sessionId: "s1",
    turnId: "t1",
    delta: "x",
    deltaType: "audio",
    timestamp: new Date(),
  };
  const result = v.safeParse(AgentEventSchema, event);
  assertFalse(result.success);
});

Deno.test("AgentEventSchema - rejects malformed tool result variant", () => {
  const event = {
    type: "tool.result",
    sessionId: "s1",
    turnId: "t1",
    toolCallId: "c1",
    result: { type: "success", error: "wrong key" },
    timestamp: new Date(),
  };
  const result = v.safeParse(AgentEventSchema, event);
  assertFalse(result.success);
});

Deno.test("AgentEventSchema - rejects non-JSON input values", () => {
  const event = {
    type: "tool.call",
    sessionId: "s1",
    turnId: "t1",
    name: "read",
    toolCallId: "c1",
    input: { callback: () => {} },
    timestamp: new Date(),
  };
  const result = v.safeParse(AgentEventSchema, event);
  assertFalse(result.success);
});

Deno.test("AgentEventSchema - serialized events survive JSON round-trip with date revival", () => {
  const event: AgentEvent = {
    type: "user.prompt_submit",
    sessionId: "s1",
    turnId: "t1",
    prompt: "hi",
    timestamp: new Date(1735689600000),
  };
  const serialized = JSON.stringify(event);
  const revived = JSON.parse(serialized, (key, value) => {
    if (key === "timestamp" && typeof value === "string") {
      return new Date(value);
    }
    return value;
  });
  const parsed = v.parse(AgentEventSchema, revived);
  assertEquals(parsed, event);
  assert(parsed.timestamp instanceof Date);
});
