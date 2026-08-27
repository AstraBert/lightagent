import {
  AgentEvent,
  AgentStorage,
  convertEventsToMessages,
  messageToAssistantContent,
  assistantContentToMessage,
  EditTool,
  Provider,
  ReadTool,
  SessionInitType,
  ShellTool,
  SkillsClient,
  SkillsTool,
  WriteTool,
  Usage,
  AsyncQueue,
  JsonValue,
  ToolResult,
  CompactionResultSchema,
  MemoryStorageEvent,
  MemoryTool,
} from "@cle-does-things/lightagent-core";
import { LocalFileSystem } from "./fs.ts";
import { getDbPath, LocalSqliteClient } from "./storage.ts";
import { LocalShell } from "./shell.ts";
import { LocalEnvironment } from "./environment.ts";
import { toJsonSchema } from "@valibot/to-json-schema";
import { ApiType, Llm, LlmRequest, Message, MessageRole, textMessage, ToolCallPart } from "@cle-does-things/llms-sdk";
import { crypto } from "@std/crypto/crypto";
import pLimit from "p-limit"
import * as v from "valibot"

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
const MAX_CONCURRENT_TOOL_CALLS = 10
const COMPACTION_SYSTEM_PROMPT = `You are tasked with compacting a conversation between a user and an AI agent. Conversations may often contain a mix of text, thinking and tool calls/results. Your main task is to compact the conversation to its essential parts, capturing its goals, finished/unfinished tasks, key decisions, blockers, potential next steps and, in general, the critical context that should be carried on from the conversation into future ones. Since the AI agent might have access to the filesystem, you might need to include files that the agent accessed and wrote/modified over the course of the conversation. Your task is to be concise but effective, trying to convey the most information density possible. Your compation summaries will be used for retrieval (the agent goes back to past conversations and tries to see if there was anything relevant through natural language queries), so please structure the summaries in such a way that keywords and information density are optimized for a hybrid search pipeline. Follow this template for the final summary:
\`\`\`md
  ## Goal
  [What the user is trying to accomplish]

  ## Constraints & Preferences
  - [Requirements mentioned by user]

  ## Progress
  ### Done
  - [x] [Completed tasks]

  ### In Progress
  - [ ] [Current work]

  ### Blocked
  - [Issues, if any]

  ## Key Decisions
  - **[Decision]**: [Rationale]

  ## Next Steps
  1. [What should happen next]

  ## Critical Context
  - [Data needed to continue]

  <read-files>
  path/to/file1.ts
  path/to/file2.ts
  </read-files>

  <modified-files>
  path/to/changed.ts
  </modified-files>
\`\`\`
`

const DEFAULT_SUMMARIZATION_BUDGET = 32_000;

function resolveCredentials(env: LocalEnvironment, provider?: Provider, apiKey?: string): {provider: Provider, apiKey: string} {
  if (apiKey && provider) {
    return { provider, apiKey }
  } else if (!apiKey && provider) {
    const key = env.get(`${provider.toUpperCase()}_API_KEY`)
    if (!key) {
      throw new Error(`Could not find ${provider.toUpperCase()}_API_KEY in the current environment`)
    }
    return { provider, apiKey: key }
  } else if (!apiKey && !provider) {
    const openaiKey = env.get("OPENAI_API_KEY")
    if (openaiKey) {
      return { provider: "openai", apiKey: openaiKey }
    }
    const anthropicKey = env.get("ANTHROPIC_API_KEY")
    if (anthropicKey) {
      return { provider: "anthropic", apiKey: anthropicKey }
    }
    throw new Error("Neither OPENAI_API_KEY nor ANTHROPIC_API_KEY are in the current environment, could not infer provider")
  } else {
    throw new Error("Cannot infer provider from the API key only")
  }
}

function defaultUsage(sessionStart: Date): Usage {
  return {
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    latency: Date.now() - Number(sessionStart),
    inputTokens: 0,
    outputTokens: 0,
  }
}

export class LocalLightAgent {
  provider: Provider
  baseUrl: string
  model: string
  summarizingModel: string
  apiKey: string
  system: string
  autoSkillDiscovery: boolean
  skillsList: string[]
  promptCaching: boolean
  parallelToolCalls: boolean
  summarizationBudget: number = DEFAULT_SUMMARIZATION_BUDGET
  private llmClient: Llm = new Llm()
  private history: Message[] = []
  private env: LocalEnvironment = new LocalEnvironment()
  private skills: Map<string, string> = new Map()
  private fs: LocalFileSystem = new LocalFileSystem()
  private shell: LocalShell = new LocalShell()
  private db: LocalSqliteClient
  private storage: AgentStorage
  private skillsClient: SkillsClient
  private tools: {
    shell: ShellTool,
    edit: EditTool,
    write: WriteTool,
    read: ReadTool,
    skills: SkillsTool,
    memory: MemoryTool,
  }
  private resolvedSkills: boolean = false
  private resolvedSystem: boolean = false

  constructor(options: {
    model: string,
    provider?: Provider,
    apiKey?: string,
    baseUrl?: string,
    summarizingModel?: string,
    system?: { content: string, append: boolean },
    autoSkillDiscovery?: boolean,
    skillsList?: string[],
    promptCaching?: boolean,
    parallelToolCalls?: boolean,
    summarizationBudget?: number,
  }) {
    this.model = options.model
    const { provider, apiKey } = resolveCredentials(this.env, options.provider, options.apiKey)
    this.provider = provider
    this.apiKey = apiKey
    this.summarizingModel = options.summarizingModel ?? options.model
    this.baseUrl = options.baseUrl ?? provider == "openai" ? DEFAULT_OPENAI_BASE_URL : DEFAULT_ANTHROPIC_BASE_URL
    this.autoSkillDiscovery = options.autoSkillDiscovery ?? options.skillsList ? false : true
    this.skillsList = options.skillsList ?? []
    this.system = options.system ? options.system.append ? `${DEFAULT_SYSTEM_PROMPT}\n\n${options.system.content}` : options.system.content : DEFAULT_SYSTEM_PROMPT
    this.promptCaching = options.promptCaching ?? true
    this.parallelToolCalls = options.parallelToolCalls ?? false
    if (typeof options.summarizationBudget !== "undefined") {
      this.summarizationBudget = options.summarizationBudget
    }
    this.db = new LocalSqliteClient(getDbPath(this.fs))
    this.storage = new AgentStorage(this.db, this.fs)
    this.skillsClient = new SkillsClient(this.fs)
    this.tools = {
      edit: new EditTool(this.fs),
      read: new ReadTool(this.fs),
      write: new WriteTool(this.fs),
      skills: new SkillsTool(this.skillsClient),
      shell: new ShellTool(this.shell),
      memory: new MemoryTool(this.storage)
    }
  }

  private async resolveSkills() {
    if (this.resolvedSkills) {
      return
    }
    if (this.autoSkillDiscovery) {
      this.skills = await this.skillsClient.findSkills()
    } else if (this.skillsList) {
      for (const skill of this.skillsList) {
        const skillPath = await this.skillsClient.getSkillPath(skill)
        const { description } = await this.skillsClient.parseSkill(skillPath)
        this.skills.set(skill, description)
      }
    }
    this.resolvedSkills = true
  }

  private async resolveSystem() {
    if (this.resolvedSystem) {
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
    for (const [_, tool] of Object.entries(this.tools)) {
      this.system += `\n<name>${tool.name}</name>\n<description>${tool.description}</description>\n<input_schema>\n${JSON.stringify(toJsonSchema(tool.inputSchema))}\n</input_schema>`
    }
    this.system += "\n</tools>\n"
    this.resolvedSystem = true
  }

  async checkForMigrations(): Promise<void> {
    await this.storage.initStorage()
  }

  private async resolvePrompt(prompt: string) {
    if (prompt.startsWith("/")) {
      const skillName = prompt.split(" ")[0]!.slice(1)
      const skillPath = await this.skillsClient.getSkillPath(skillName)
      const { content } = await this.skillsClient.parseSkill(skillPath)
      const newPrompt = prompt.replace(`/${skillName}`, `<skill>\n${content}\n</skill>\n`)
      return newPrompt
    }
    return prompt
  }


  private async safeStore(event: AgentEvent, sessionId: string, usage?: Usage, startTime?: Date): Promise<AgentEvent | undefined> {
    try {
      await this.storage.store(event)
    } catch (e) {
      return {
        type: "session.stop" as const,
        success: false,
        timestamp: new Date(),
        error: `An error occurred while trying to store an event in the SQLite database: ${e}`,
        usage: usage ?? defaultUsage(startTime ?? new Date()),
        sessionId,
      }
    }
  }

  private async safeGetSessionEvents(sessionId: string): Promise<{type: "success", events: AgentEvent[]} | { type: "failure", event: AgentEvent }> {
    try {
      return {type: "success", events: await this.storage.getSessionEvents(sessionId)}
    } catch (e) {
      return {
        type: "failure",
        event: {
          type: "session.stop" as const,
          success: false,
          timestamp: new Date(),
          error: `An error occurred while trying to store an event in the SQLite database: ${e}`,
          usage: defaultUsage(new Date()),
          sessionId,
        }
      }
    }
  }

  async* run(prompt: string, sessionId?: string): AsyncGenerator<AgentEvent> {
    await this.resolveSystem()
    let resolvedSid: string;
    let errEvent: AgentEvent | undefined;
    if (sessionId) {
      resolvedSid = sessionId;
      const result = await this.safeGetSessionEvents(sessionId)
      if (result.type == "failure") {
        yield result.event
        return
      }
      this.history = convertEventsToMessages(result.events)
      const initEvent = { type: "session.init" as const, initType: "resume" as SessionInitType, system: this.system, sessionId, provider: this.provider, model: this.model, timestamp: new Date() }
      errEvent = await this.safeStore(initEvent, resolvedSid)
      if (errEvent) {
        yield errEvent
        return
      }
      yield initEvent
    } else {
      resolvedSid = crypto.randomUUID()
      const initEvent = { type: "session.init" as const, initType: "new" as SessionInitType, system: this.system, sessionId: resolvedSid, provider: this.provider, model: this.model, timestamp: new Date() }
      errEvent = await this.safeStore(initEvent, resolvedSid)
      if (errEvent) {
        yield errEvent
        return
      }
      yield initEvent
    }
    this.history = [textMessage(this.system, "system" as MessageRole), ...this.history]
    const resolvedPrompt = await this.resolvePrompt(prompt)
    this.history.push(textMessage(resolvedPrompt))
    const sessionStart = new Date();
    let inputTokens = 0
    let outputTokens = 0
    let cacheReadTokens = 0
    let cacheWriteTokens = 0
    const turnId = crypto.randomUUID()
    const userPromptSubmit: AgentEvent = {
      type: "user.prompt_submit",
      prompt: resolvedPrompt,
      sessionId: resolvedSid,
      turnId,
      timestamp: new Date(),
    }
    errEvent = await this.safeStore(userPromptSubmit, resolvedSid, undefined, sessionStart)
    if (errEvent) {
      yield errEvent
      return
    }
    while (true) {
      const request = {
        model: this.model,
        baseUrl: this.baseUrl,
        apiType: this.provider as ApiType,
        apiKey: this.apiKey,
        stream: true,
        messages: this.history,
        tools: Object.values(this.tools).map((t) => t.toSdkTool()),
        parallelToolCalls: this.parallelToolCalls,
        promptCacheTtl: this.promptCaching ? this.provider === "anthropic" ? "5m" : "30m" : undefined,
      } as LlmRequest;
      const queue = new AsyncQueue<AgentEvent>()
      let toolCalls: ToolCallPart[] = []
      let assistantMessage: Message | null = null
      this.llmClient.streamResponse(request, (err, chunk) => {
        if (err) {
          queue.push({
            chunk: {
              type: "session.stop" as const,
              success: false,
              timestamp: new Date(),
              error: `An error occurred while generating the agent response: ${err}`,
              usage: {
                cacheReadTokens,
                cacheWriteTokens,
                inputTokens,
                outputTokens,
                latency: Date.now() - Number(sessionStart)
              },
              sessionId: resolvedSid,
            },
            isError: true,
          })
          return
        }
        if (!chunk) {
          queue.push({done: true})
          return
        }
        switch (chunk.type) {
          case "textDelta":
            queue.push({chunk: {
                type: "stream.delta",
                delta: chunk.textDelta ?? "",
                deltaType: "text",
                turnId,
                sessionId: resolvedSid,
                timestamp: new Date(),
              }
            })
            break
          case "thinkingDelta":
            queue.push({chunk: {
              type: "stream.delta",
              delta: chunk.thinkingDelta ?? "",
              deltaType: "thinking",
              turnId,
              sessionId: resolvedSid,
              timestamp: new Date(),
            }})
            break
          case "complete": {
            assistantMessage = chunk.message
            toolCalls = chunk.toolCalls ?? []
            if (chunk.usage) {
              inputTokens += chunk.usage.inputTokens
              outputTokens += chunk.usage.outputTokens
              cacheReadTokens += chunk.usage.cacheReadTokens ?? 0
              cacheWriteTokens += chunk.usage.cacheWriteTokens ?? 0
            }
            queue.push({chunk: {
              type: "assistant.response",
              content: messageToAssistantContent(chunk.message.content),
              sessionId: resolvedSid,
              turnId,
              timestamp: new Date(),
            }, done: true})
            break
          }
          default:
        }
      })

      let hasError = false

      while (true) {
        const item = await queue.next();
        if (item.chunk && item.isError) {
          hasError = true
          errEvent = await this.safeStore(item.chunk, resolvedSid, {
            inputTokens,
            outputTokens,
            cacheReadTokens,
            cacheWriteTokens,
            latency: Date.now() - Number(sessionStart)
          })
          if (errEvent) {
            yield errEvent
            break
          }
          yield item.chunk
          break
        } else if (item.done && !item.chunk) {
          break
        } else {
          errEvent = await this.safeStore(item.chunk!, resolvedSid, {
            inputTokens,
            outputTokens,
            cacheReadTokens,
            cacheWriteTokens,
            latency: Date.now() - Number(sessionStart)
          })
          if (errEvent) {
            hasError = true
            yield errEvent
            break
          }
          yield item.chunk!;
          if (item.done) {
            break
          }
        }
      }

      if (!assistantMessage) {
        yield {
          type: "session.stop",
          sessionId: resolvedSid,
          success: false,
          error: "No assistant message produced",
          timestamp: new Date(),
          usage: {
            inputTokens,
            outputTokens,
            cacheReadTokens,
            cacheWriteTokens,
            latency: Date.now() - Number(sessionStart)
          }
        }
        break
      }

      if (hasError) {
        break
      }

      if (toolCalls.length === 0) {
        await this.summarizeAndStore(resolvedSid)
        const stopEvent: AgentEvent = {
          type: "session.stop",
          timestamp: new Date(),
          success: true,
          result: messageToAssistantContent((assistantMessage as Message).content),
          sessionId: resolvedSid,
          usage: {
            inputTokens,
            cacheReadTokens,
            cacheWriteTokens,
            outputTokens,
            latency: Date.now() - Number(sessionStart)
          }
        }
        errEvent = await this.safeStore(stopEvent, resolvedSid, {
          inputTokens,
          cacheReadTokens,
          cacheWriteTokens,
          outputTokens,
          latency: Date.now() - Number(sessionStart)
        })
        if (errEvent) {
          yield errEvent
          break
        }
        yield stopEvent
        break
      }
      this.history.push(assistantMessage)
      const limit = pLimit(this.parallelToolCalls ? MAX_CONCURRENT_TOOL_CALLS : 1)
      const executeToolWithCallId = async (execFn: (input: JsonValue) => Promise<ToolResult>, args: string, callId: string) => {
        const result = await execFn(JSON.parse(args))
        return { result, callId }
      }
      const promises = []
      let hasStoreError = false
      for (const toolCall of toolCalls) {
        if (Object.keys(this.tools).includes(toolCall.name)) {
          const toolCallEventAny: AgentEvent = { type: "tool.call_any", timestamp: new Date(), input: JSON.parse(toolCall.arguments), name: toolCall.name, turnId, sessionId: resolvedSid, toolCallId: toolCall.id }
          errEvent = await this.safeStore(toolCallEventAny, resolvedSid, {
            outputTokens,
            inputTokens,
            cacheReadTokens,
            cacheWriteTokens,
            latency: Date.now() - Number(sessionStart)
          })
          if (errEvent) {
            hasStoreError = true
            yield errEvent
            break
          }
          if (toolCall.name != "skills") {
            const toolCallEvent: AgentEvent = { type: "tool.call", timestamp: new Date(), input: JSON.parse(toolCall.arguments), name: toolCall.name, turnId, sessionId: resolvedSid, toolCallId: toolCall.id }
            yield toolCallEvent
          } else {
            const payload: { skill_name: string } = JSON.parse(toolCall.arguments)
            const skillLoadEvent: AgentEvent = { type: "skill.load", timestamp: new Date(), turnId, sessionId: resolvedSid,  skillName: payload.skill_name }
            yield skillLoadEvent
          }
          switch (toolCall.name) {
            case "shell": {
              promises.push(limit(() => executeToolWithCallId(this.tools.shell.execute.bind(this.tools.shell), toolCall.arguments, toolCall.id)))
              break
            }
            case "edit":
              promises.push(limit(() => executeToolWithCallId(this.tools.edit.execute.bind(this.tools.edit), toolCall.arguments, toolCall.id)))
              break
            case "write":
              promises.push(limit(() => executeToolWithCallId(this.tools.write.execute.bind(this.tools.write), toolCall.arguments, toolCall.id)))
              break
            case "read":
              promises.push(limit(() => executeToolWithCallId(this.tools.read.execute.bind(this.tools.read), toolCall.arguments, toolCall.id)))
              break
            case "skills":
              promises.push(limit(() => executeToolWithCallId(this.tools.skills.execute.bind(this.tools.skills), toolCall.arguments, toolCall.id)))
          }
        }
      }

      if (hasStoreError) {
        break
      }

      const results = await Promise.all(promises)

      for (const result of results) {
        const toolResultEvent: AgentEvent = {
          type: "tool.result",
          toolCallId: result.callId,
          timestamp: new Date(),
          result: result.result,
          sessionId: resolvedSid,
          turnId
        }
        errEvent = await this.safeStore(toolResultEvent, resolvedSid, {
          inputTokens,
          outputTokens,
          cacheWriteTokens,
          cacheReadTokens,
          latency: Date.now() - Number(sessionStart)
        })
        if (errEvent) {
          yield errEvent
          break
        }
        yield toolResultEvent
        this.history.push({
          role: "tool" as MessageRole,
          content: [{
            type: "toolResult",
            result: result.result.type === "success" ? result.result.result : `ERROR!\n${result.result.error}`,
            toolCallId: result.callId,
          }]
        })
      }
    }
    return
  }

  private async summarizeAndStore(sessionId: string): Promise<MemoryStorageEvent> {
    try {
      const existing = await this.storage.getSessionSummary(sessionId)
      let messages: Message[] = []
      let shouldUpdate = false
      if (!existing) {
        messages = this.history.filter((m) => m.role !== "system")
      } else {
        shouldUpdate = true
        const base = textMessage(`Summary of the previous checkpoint for session titled ${existing.title}\n\n${existing.summary}`, "user" as MessageRole)
        const events = await this.storage.getSessionEvents(sessionId, existing.updated_at)
        const filtered = events.filter((e) => e.type === "user.prompt_submit" || e.type === "assistant.response" || e.type === "tool.result")
        messages = filtered.map((e) => {
          switch (e.type) {
            case "assistant.response":
              return assistantContentToMessage(e.content)
            case "user.prompt_submit":
              return textMessage(e.prompt)
            case "tool.result":
              return {
                role: "tool" as MessageRole,
                content: [
                  {
                    type: "toolResult",
                    result: e.result.type === "success" ? e.result.result : `An error occurred: ${e.result.error}`,
                    toolCallId: e.toolCallId
                  }
                ]
              } as Message
          }
        })
        messages = [base, ...messages]
      }
      messages = [textMessage(COMPACTION_SYSTEM_PROMPT, "system" as MessageRole), ...messages]
      const request = {
        apiType: this.provider,
        apiKey: this.apiKey,
        model: this.summarizingModel,
        messages,
        stream: false,
        parallelToolCalls: false,
        maxOutputTokens: this.summarizationBudget,
        outputFormat: {
          name: "summary",
          description: "Summary of the current session, based on the provided messages",
          schema: toJsonSchema(CompactionResultSchema),
        }
      } as LlmRequest;
      const llm = new Llm()
      const response = await llm.respond(request)
      const responseText = response.message.content.filter((c) => c.type === "text")[0]
      if (!responseText) {
        return { sessionId, success: false, timestamp: new Date(), type: "memory.storage", error: "Summarization model did not produce any summary" }
      }
      const validated = await v.parseAsync(CompactionResultSchema, JSON.parse(responseText.text))
      if (shouldUpdate) {
        await this.storage.updateSessionSummary(sessionId, validated.summary, validated.title)
      } else {
        await this.storage.setSessionSummary(sessionId, validated.summary, validated.title)
      }
      return { sessionId, success: true, timestamp: new Date(), type: "memory.storage" }
    } catch (e) {
      return { sessionId, success: false, timestamp: new Date(), type: "memory.storage", error: `An error occurred: ${e}` }
    }
  }
}
