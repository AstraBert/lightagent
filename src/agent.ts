import { ApiType, Llm, LlmRequest, Message, MessageRole, textMessage } from "@cle-does-things/llms-sdk";
import { AgentEvent, convertEventsToMessages, Provider, SessionInitType } from "./events.ts";
import { AgentStorage } from "./storage/store.ts";
import { EditTool, ReadTool, ShellTool, SkillsTool, ToolFunction, WriteTool } from "./tools.ts";
import { getSkillPath, parseSkill, findSkills } from "./skills.ts";
import { toJsonSchema } from "@valibot/to-json-schema";
import { crypto } from "@std/crypto/crypto";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1"
const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1"
const DEFAULT_SYSTEM_PROMPT = `<identity>
You are LightAgent, an AI agent whose purpose is to
fulfil request coming from a user, employing the tools and skills
available to you and interacting with the environment
you are given
</identity>
<guidelines>
<general>
To carry out a task, follow the main rules of the Zen of Python whenever possible:
- Beautiful is better than ugly.
- Explicit is better than implicit.
- Simple is better than complex.
- Complex is better than complicated.
- Flat is better than nested.
- Readability counts.
- Special cases aren't special enough to break the rules, although practicality beats purity.
- Errors should never pass silently, unless explicitly silenced.
- In the face of ambiguity, refuse the temptation to guess.
- There should be one (and preferably only one) obvious way to do it.
- If the implementation is hard to explain, it's a bad idea.
- If the implementation is easy to explain, it _may_ be a good idea, but **it is not necessarily**.
</general>
<tools_and_skills_usage>
Tools can be invoked by providing their name and an input conforming to their input JSON schema.
Call tools either when requested by the user, or when the description of the tool seems compelling
enough for the task at hand.
You also have a special tool called 'skills'. When you want to access specialized knowledge over a
particular area, you can invoke the skill pertaining to that area by calling the 'skills' tool and
providing the name of the skill to it. The 'skills' tool will return the specific instructions for that
skill. Invoke a skill either when directly prompted by the user to do so, or when the skill's description
seems compelling enough for the task at hand.
</tools_and_skills_usage>
</guidelines>`

export class LightAgent {
  provider: Provider
  baseUrl: string
  model: string
  summarizingModel: string
  apiKey: string
  system: string
  skillsList?: string[]
  autoSkillDiscovery: boolean
  parallelToolCalls: boolean
  promptCaching: boolean
  private skills: Map<string, string>
  private history: Message[]
  private tools: ToolFunction[]
  private storage: AgentStorage
  private client: Llm
  private systemResolved: boolean
  private skillsResolved: boolean

  constructor(
    model: string,
    provider?: Provider,
    apiKey?: string,
    summarizingModel?: string,
    skills?: string[],
    autoSkillDiscovery?: boolean,
    baseUrl?: string,
    parallelToolCalls?: boolean,
    promptCaching?: boolean,
    system?: { content: string, append: boolean },
  ) {
    this.storage = new AgentStorage()
    this.client = new Llm()
    this.tools = [new SkillsTool(), new ReadTool(), new WriteTool(), new EditTool(), new ShellTool()]
    this.history = []
    this.model = model
    this.summarizingModel = summarizingModel ?? model
    if (!apiKey && provider) {
      this.provider = provider
      const key = Deno.env.get(`${provider.toUpperCase()}_API_KEY`)
      if (key) {
        this.apiKey = key
      } else {
        throw new Error(`Could not find ${provider.toUpperCase()}_API_KEY in the current environment`)
      }
    } else if (!apiKey && !provider) {
      const openaiKey = Deno.env.get("OPENAI_API_KEY")
      if (openaiKey) {
        this.apiKey = openaiKey
        this.provider = "openai"
      } else {
        const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")
        if (anthropicKey) {
          this.apiKey = anthropicKey
          this.provider = "anthropic"
        } else {
          throw new Error("Neither ANTHROPIC_API_KEY nor OPENAI_API_KEY are set in the environment, could not infer provider")
        }
      }
    } else if (apiKey && provider) {
      this.apiKey = apiKey
      this.provider = provider
    } else {
      throw new Error("Provider is not set and cannot be inferred from the provided API key")
    }
    this.skillsList = skills
    this.skills = new Map()
    this.autoSkillDiscovery = autoSkillDiscovery ?? true
    if (system && system.append) {
      this.system = DEFAULT_SYSTEM_PROMPT + `\n\n${system.content}`
    } else if (system && !system.append) {
      this.system = system.content
    } else {
      this.system = DEFAULT_SYSTEM_PROMPT
    }
    this.parallelToolCalls = parallelToolCalls ?? false
    this.promptCaching = promptCaching ?? false
    this.baseUrl = baseUrl ? baseUrl : provider === "openai" ? DEFAULT_OPENAI_BASE_URL : DEFAULT_ANTHROPIC_BASE_URL
    this.skillsResolved = false
    this.systemResolved = false
  }

  private async resolveSkills() {
    if (this.skillsResolved) {
      return
    }
    if (this.skillsList && !this.autoSkillDiscovery) {
      for (const skill of this.skillsList) {
        const skillPath = await getSkillPath(skill)
        const { description } = await parseSkill(skillPath)
        this.skills.set(skill, description)
      }
    } else if (this.autoSkillDiscovery) {
      this.skills = await findSkills()
    }
    this.skillsResolved = true
  }

  private async resolveSystem() {
    if (this.systemResolved) {
      return
    }
    this.system += `<model>You are ${this.model} served through an ${this.provider}-compatible API</model>`
    if (this.skillsList && this.skillsList.length > 0) {
      this.system += "\n<skills>\n"
      await this.resolveSkills()
      for (const [skill, description] of this.skills.entries()) {
        this.system += `\n<name>${skill}</name>\n<description>${description}</description>`
      }
      this.system += "\n</skills>\n"
    }
    this.system += "\n<tools>\n"
    for (const tool of this.tools) {
      this.system += `\n<name>${tool.name}</name>\n<description>${tool.description}</description>\n<input_schema>\n${toJsonSchema(tool.inputSchema)}\n</input_schema>`
    }
    this.system += "\n</tools>\n"
    this.systemResolved = true
  }

  private async resolvePrompt(prompt: string) {
    if (prompt.startsWith("/")) {
      const skillName = prompt.split(" ")[0]!.slice(1)
      const skillPath = await getSkillPath(skillName)
      const { content } = await parseSkill(skillPath)
      const newPrompt = prompt.replace(`/${skillName}`, `<skill>\n${content}\n</skill>\n`)
      return newPrompt
    }
    return prompt
  }


  async* run(prompt: string, sessionId?: string): AsyncGenerator<AgentEvent> {
    await this.resolveSystem()
    let resolvedSid: string;
    if (sessionId) {
      resolvedSid = sessionId;
      const previousEvents = await this.storage.getSessionEvents(sessionId)
      this.history = convertEventsToMessages(previousEvents)
      const initEvent = { type: "session.init" as const, initType: "resume" as SessionInitType, system: this.system, sessionId, provider: this.provider, model: this.model, timestamp: new Date() }
      await this.storage.store(initEvent)
      yield initEvent
    } else {
      resolvedSid = crypto.randomUUID()
      const initEvent = { type: "session.init" as const, initType: "new" as SessionInitType, system: this.system, sessionId: resolvedSid, provider: this.provider, model: this.model, timestamp: new Date() }
      await this.storage.store(initEvent)
      yield initEvent
    }
    this.history = [textMessage(this.system, "system" as MessageRole), ...this.history]
    const resolvedPrompt = await this.resolvePrompt(prompt)
    this.history.push(textMessage(resolvedPrompt))
    let request = {
      model: this.model,
      baseUrl: this.baseUrl,
      apiType: this.provider as ApiType,
      apiKey: this.apiKey,
      stream: true,
      messages: this.history,
      tools: this.tools.map((t) => t.toSdkTool()),
      parallelToolCalls: this.parallelToolCalls,
      promptCacheTtl: this.promptCaching ? this.provider === "anthropic" ? "5m" : "30m" : undefined,
    } as LlmRequest;
    // to be continued
  }
}
