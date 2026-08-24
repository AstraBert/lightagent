import { LocalLightAgent } from "./agent.ts";
import { parseArgs } from "@std/cli";
import { isProvider, Provider, logEvent } from "@cle-does-things/lightagent-core"

if (import.meta.main) {
  const cmdOptions = parseArgs(Deno.args, {
    string: ["model", "provider", "api-key", "base-url", "summarizer", "system", "prompt", "session-id", "skill" ],
    boolean: ["parallel-tool-calls", "append-system", "prompt-caching", "discover-skills", "json"],
    negatable: ["prompt-caching", "discover-skills"],
    collect: ["skill"],
    default: {
      provider: undefined,
      "api-key": undefined,
      "base-url": undefined,
      summarizer: undefined,
      system: undefined,
      "parallel-tool-calls": false,
      "append-system": false,
      "prompt-caching": true,
      skill: undefined,
      prompt: undefined,
      "session-id": undefined,
      "discover-skills": true,
      json: false,
    },
  });

  if (!cmdOptions.model) {
    console.error("\x1b[1;31mERROR! Missing required option `--model`\x1b[1;39m")
    Deno.exit(1)
  }

  let system = undefined
  if (cmdOptions.system) {
    system = { content: cmdOptions.system, append: cmdOptions["append-system"] }
  }

  if (cmdOptions.provider) {
    if (!isProvider(cmdOptions.provider)) {
      console.error("\x1b[1;31mERROR! Unsupported provider. The only supported providers are: openai, anthropic\x1b[1;39m")
      Deno.exit(1)
    }
  }

  let promptInput: string | null = null;
  if (cmdOptions.prompt) {
    promptInput = cmdOptions.prompt
  } else {
    promptInput = prompt("What do you want to do today?")
  }

  if (!promptInput) {
    console.error("\x1b[1;31mERROR! You need to provide a prompt, either through the `--prompt` flag or through the interactive terminal interface\x1b[1;39m")
    Deno.exit(1)
  }

  const agent = new LocalLightAgent({
    model: cmdOptions.model,
    summarizingModel: cmdOptions.summarizer,
    system,
    skillsList: cmdOptions.skill,
    apiKey: cmdOptions["api-key"],
    provider: cmdOptions.provider as Provider | undefined,
    promptCaching: cmdOptions["prompt-caching"],
    parallelToolCalls: cmdOptions["parallel-tool-calls"],
    baseUrl: cmdOptions["base-url"],
    autoSkillDiscovery: cmdOptions["discover-skills"],
  })

  let wasTexting = false;
  let wasThinking = false;
  for await (const event of agent.run(promptInput, cmdOptions["session-id"])) {
    ({ wasTexting, wasThinking } = await logEvent(cmdOptions.json, event, wasTexting, wasThinking));
  }
}
