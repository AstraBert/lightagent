import { LocalLightAgent } from "./agent.ts";

if (import.meta.main) {
  const agent = new LocalLightAgent({
    model: "gpt-5.4-mini",
    promptCaching: false,
  })
  for await (const event of agent.run("hello, can you list the files in the current directory, then read the first one that comes up and transcribe it to agent-test.txt?")) {
    console.log(JSON.stringify(event))
  }
}
