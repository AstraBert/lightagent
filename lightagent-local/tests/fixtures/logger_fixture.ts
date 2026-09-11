// Test fixture: logs a fixed series of events through EventLogger and exits.
// Invoked in a subprocess by logger_test.ts so stdout can be captured.
// Args: <mode> ["replay"] where mode is "json" or "pretty".
import { EventLogger } from "../../src/logger.ts";
import type { AgentEvent } from "@cle-does-things/lightagent-core";

const mode = Deno.args[0];
const json = mode === "json";

const usage = {
  latency: 5,
  inputTokens: 12,
  outputTokens: 34,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
};

const events: AgentEvent[] = [
  {
    type: "session.init",
    sessionId: "sid-1",
    initType: "new",
    provider: "anthropic",
    model: "claude",
    system: "sys",
    timestamp: new Date(0),
  },
  {
    type: "user.prompt_submit",
    sessionId: "sid-1",
    turnId: "t1",
    prompt: "hello agent",
    timestamp: new Date(0),
  },
  {
    type: "stream.delta",
    sessionId: "sid-1",
    turnId: "t1",
    delta: "thinking...",
    deltaType: "thinking",
    timestamp: new Date(0),
  },
  {
    type: "stream.delta",
    sessionId: "sid-1",
    turnId: "t1",
    delta: "answer",
    deltaType: "text",
    timestamp: new Date(0),
  },
  {
    type: "tool.call",
    sessionId: "sid-1",
    turnId: "t1",
    name: "read",
    toolCallId: "c1",
    input: { file_path: "a.ts" },
    timestamp: new Date(0),
  },
  {
    type: "tool.result",
    sessionId: "sid-1",
    turnId: "t1",
    toolCallId: "c1",
    result: { type: "success", result: "file contents" },
    timestamp: new Date(0),
  },
  {
    type: "tool.result",
    sessionId: "sid-1",
    turnId: "t1",
    toolCallId: "c2",
    result: { type: "error", error: "boom" },
    timestamp: new Date(0),
  },
  {
    type: "skill.load",
    sessionId: "sid-1",
    turnId: "t1",
    skillName: "pdf",
    timestamp: new Date(0),
  },
  {
    type: "session.interrupt",
    sessionId: "sid-1",
    timestamp: new Date(0),
  },
  {
    type: "session.stop",
    sessionId: "sid-1",
    success: true,
    timestamp: new Date(0),
    usage,
  },
  {
    type: "session.stop",
    sessionId: "sid-1",
    success: false,
    error: "fatal",
    timestamp: new Date(0),
    usage,
  },
];

const logger = new EventLogger(json);
for (const event of events) {
  await logger.log(event);
}

// Replay mode: only user prompts are framed specially in pretty mode.
if (Deno.args[1] === "replay") {
  await logger.logReplay(events);
}
