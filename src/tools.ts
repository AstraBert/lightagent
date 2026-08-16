import * as v from 'valibot';
import { toJsonSchema } from "@valibot/to-json-schema"

import { Tool } from "@cle-does-things/llms-sdk";
import { JsonValue, ToolResult } from "./events.ts";

type ToolParametersSchema = v.ObjectSchema<v.ObjectEntries, v.ErrorMessage<v.ObjectIssue> | undefined>;

export interface ToolExecutionContext<T> {
  context: T,
}

/* A callable tool that the agent can invoke.

Implementors define the JSON schema, description, and execution logic.
The agent automatically serialises the LLM's arguments and validates them
against `inputSchema` before calling `execute`. */
export abstract class ToolFunction<T> {
  /*  Unique tool name exposed to the LLM. */
  abstract name: string
  /* Human-readable description exposed to the LLM. */
  abstract description: string
  /* JSON Schema describing the arguments this tool accepts. */
  abstract inputSchema: ToolParametersSchema
  /* Run the tool with the validated arguments. */
  abstract execute(input: JsonValue, ctx: ToolExecutionContext<T>): Promise<ToolResult>
  /* Convert this tool into the SDK representation used for chat requests. */
  toSdkTool(): Tool {
    return {
      name: this.name,
      description: this.description,
      parameters: toJsonSchema(this.inputSchema),
    }
  }
}


// export class SkillsTool extends ToolFunction<void> {
//   readonly name: string = "skills"
//   readonly description: string = "Call this tool to load a skill, providing the name of the skill you are invoking"
//   readonly inputSchema = v.object({
//     skill_name: v.pipe(v.string(), v.description("Name of the skill to load")),
//   })

//   async execute(input: JsonValue, _ctx: ToolExecutionContext<void>): Promise<ToolResult> {
//     try {
//       const validated = v.parse(this.inputSchema, input)
//       const content = await Deno.readTextFile(`.agents/skills/${validated.skill_name}/SKILL.md`)
//       return { type: "success", result: content }
//     } catch (e) {
//       return { type: "error", error: `An error occurred while executing the \`skills\` tool: ${e}`}
//     }
//   }
// }
