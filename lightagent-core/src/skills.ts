import * as path from "@std/path";
import { extractYaml } from "@std/front-matter";
import { assertValidSkillName } from "./assertions.ts";
import { exists, type FileSystem } from "./fs.ts";

export class SkillsClient {
  fs: FileSystem;
  basePath: string = ".agents/skills";

  constructor(fs: FileSystem) {
    this.fs = fs;
  }

  async getSkillPath(skillName: string): Promise<string> {
    assertValidSkillName(skillName);
    const globalPath = path.join(
      this.fs.homeDir()!,
      this.basePath,
      skillName,
      "SKILL.md",
    );
    const localPath = path.join(".", this.basePath, skillName, "SKILL.md");
    if (await exists(localPath, this.fs)) {
      return localPath;
    } else if (await exists(globalPath, this.fs)) {
      return globalPath;
    }
    throw new Error(
      `Skill ${skillName} could not be found locally (${localPath}) or globally (${globalPath})`,
    );
  }

  async parseSkill(
    skillPath: string,
  ): Promise<{ description: string; content: string }> {
    const content = await this.fs.readToString(skillPath);
    const parsed = extractYaml<{
      name: string;
      description: string;
      license?: string;
      compatibility?: string;
      metadata?: Record<string, unknown>;
      allowed_tools?: string;
    }>(content);
    return { description: parsed.attrs.description, content: parsed.body };
  }

  async findSkills(): Promise<Map<string, string>> {
    const globalPath = path.join(this.fs.homeDir()!, this.basePath);
    const localPath = path.join(".", this.basePath);
    const map: Map<string, string> = new Map();
    for await (const entry of this.fs.readDir(globalPath)) {
      if (entry.isDirectory) {
        const skillPath = path.join(globalPath, entry.name, "SKILL.md");
        if (await exists(skillPath, this.fs)) {
          map.set(entry.name, (await this.parseSkill(skillPath)).description);
        }
      }
    }
    for await (const entry of this.fs.readDir(localPath)) {
      if (entry.isDirectory) {
        const skillPath = path.join(localPath, entry.name, "SKILL.md");
        if (await exists(skillPath, this.fs)) {
          map.set(entry.name, (await this.parseSkill(skillPath)).description);
        }
      }
    }
    return map;
  }
}
