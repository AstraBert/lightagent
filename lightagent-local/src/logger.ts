import type { AgentEvent } from "@cle-does-things/lightagent-core";

const encoder = new TextEncoder();

function addColor(s: string, colorCode: number) {
  return `\x1b[38;5;${colorCode}m${s}\x1b[0m`;
}

// Deno.stdout.write() may perform a partial write; loop until everything is flushed.
async function writeAll(bytes: Uint8Array): Promise<void> {
  let written = 0;
  while (written < bytes.length) {
    written += await Deno.stdout.write(bytes.subarray(written));
  }
}

async function writeOut(text: string): Promise<void> {
  await writeAll(encoder.encode(text));
}

async function writeLine(text: string): Promise<void> {
  await writeOut(text + "\n");
}

export class EventLogger {
  private wasThinking = false;
  private wasTexting = false;

  constructor(private readonly json: boolean) {}

  async log(event: AgentEvent): Promise<void> {
    if (this.json) {
      await writeLine(JSON.stringify(event));
      return;
    }

    switch (event.type) {
      case "stream.delta":
        await this.logDelta(event);
        break;
      case "tool.call":
        await writeOut("\n");
        await writeLine(
          `${addColor("Tool Call " + event.toolCallId, 214)}\n` +
            addColor(`Calling tool ${event.name} with arguments:\n`, 214) +
            `${addColor(JSON.stringify(event.input, undefined, 2), 214)}`,
        );
        break;
      case "skill.load":
        await writeOut("\n");
        await writeLine(`Loaded skill: ${addColor(event.skillName, 45)}`);
        break;
      case "session.init":
        await writeLine(addColor(`Starting session ${event.sessionId}`, 253));
        await writeOut("\n")
        break;
      case "tool.result": {
        await writeOut("\n")
        const body = event.result.type === "success"
          ? event.result.result!.slice(0, 200)
          : addColor(event.result.error!, 196);
        await writeLine(
          `${event.result.type === "success" ? addColor("✓", 207) : addColor("✗", 207)} ${addColor("Tool Result for " + event.toolCallId, 207)}\n${addColor(body, 219)}`,
        );
        await writeOut("\n")
        break;
      }
      case "memory.storage": {
        if (event.error) {
          await writeOut("\n")
          await writeLine(`${addColor("\WARNING!", 220)} Could not store the summary of the current session, memories will be out of sync`)
        }
        break
      }
      case "session.stop":
        await writeOut("\n")
        await writeLine(
          event.success
            ? addColor(
                `\nDone. toks in: ${event.usage.inputTokens}; toks out: ${event.usage.outputTokens}; duration: ${event.usage.latency}s`,
                253,
              )
            : `${addColor("\nERROR!", 196)} ${event.error ?? "unknown errors"}`,
        );
        break;
      default:
        break;
    }
  }

  private async logDelta(event: Extract<AgentEvent, { type: "stream.delta" }>): Promise<void> {
    const isText = event.deltaType === "text";

    // Switching between thinking <-> texting: break the line once.
    if (isText && this.wasThinking) {
      await writeOut("\n");
    } else if (!isText && this.wasTexting) {
      await writeOut("\n");
    }

    this.wasTexting = isText;
    this.wasThinking = !isText;

    await writeOut(isText ? event.delta : addColor(event.delta, 253));
  }
}
