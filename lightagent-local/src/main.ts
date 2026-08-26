import { LocalLightAgent } from "./agent.ts";
import { parseArgs } from "@std/cli";
import { isProvider, Provider, EventLogger } from "@cle-does-things/lightagent-core"

const VERSION = "0.1.0"

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

  await agent.checkForMigrations()

  const logger = new EventLogger(cmdOptions.json)

  // Headless mode: --prompt provided
  if (cmdOptions.prompt) {
    for await (const event of agent.run(cmdOptions.prompt, cmdOptions["session-id"])) {
      await logger.log(event);
    }
    Deno.exit(0)
  }

  // Interactive CLI mode
  console.log(`\x1b[1;36mLightAgent v${VERSION}\x1b[0m`)
  console.log("\x1b[2mType your prompt and press Enter. Use Ctrl+C or type 'exit' to quit.\x1b[0m\n")

  let sessionId: string | undefined = cmdOptions["session-id"];

  while (true) {
    const promptText = prompt("\x1b[1;32m>\x1b[0m ")
    if (promptText === null || promptText.trim().toLowerCase() === "exit") {
      console.log("\x1b[2mGoodbye!\x1b[0m")
      break
    }
    if (!promptText.trim()) continue

    for await (const event of agent.run(promptText, sessionId)) {
      await logger.log(event)
      if (event.type === "session.init") {
        sessionId = event.sessionId;
      }
    }

    console.log() // blank line between turns
  }
}
