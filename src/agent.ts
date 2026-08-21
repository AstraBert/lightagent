// import { Llm, Message } from "@cle-does-things/llms-sdk";
// import { Provider } from "./events.ts";
// import { AgentStorage } from "./storage/store.ts";
// import { EditTool, ReadTool, ShellTool, SkillsTool, ToolFunction, WriteTool } from "./tools.ts";

// const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1"
// const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1"


// export class LightAgent {
//   provider: Provider
//   baseUrl?: string
//   model: string
//   apiKey: string
//   system: string
//   skills: Map<string, string>
//   parallelToolCalls: boolean
//   promptCaching: boolean
//   private history: Message[]
//   private tools: ToolFunction[]
//   private storage: AgentStorage
//   private client: Llm

//   constructor(
//     provider: Provider,
//     model: string,
//     apiKey: string,
//     skills?: string[],
//     baseUrl?: string,
//     parallelToolCalls?: boolean,
//     promptCaching?: boolean,
//     system?: string,
//   ) {
//     this.storage = new AgentStorage()
//     this.client = new Llm()
//     this.tools = [new SkillsTool(), new ReadTool(), new WriteTool(), new EditTool(), new ShellTool()]
//     this.history = []
//     this.model = model
//     this.provider = provider
//     this.apiKey = apiKey
//     this.skills = new Map()
//     this.system = system ?? ""
//     this.parallelToolCalls = parallelToolCalls ?? false
//     this.promptCaching = promptCaching ?? false
//     this.provider = provider
//     this.baseUrl = baseUrl ? baseUrl : provider === "openai" ? DEFAULT_OPENAI_BASE_URL : DEFAULT_ANTHROPIC_BASE_URL
//   }
// }
