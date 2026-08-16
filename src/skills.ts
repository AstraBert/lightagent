import * as path from "@std/path";
import { homeDir } from "./storage/db.ts";
import { extractYaml } from "@std/front-matter";

export const SKILLS_PATH = ".agents/skills";

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      return false;
    }
    throw e;
  }
  return true;
}

function assertValidSkillName(skillName: string) {
  if (skillName.length === 0 || skillName.length > 64) {
    throw new Error(`Invalid skill name: ${skillName}`);
  }
  // Lowercase letters, numbers, hyphens only. Max 64 chars.
  // No leading/trailing hyphen (also excludes empty string and "-").
  if (!/^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/.test(skillName)) {
    throw new Error(`Invalid skill name: ${skillName}`);
  }
}

export async function getSkillPath(skillName: string) {
  assertValidSkillName(skillName);
  const globalPath = path.join(homeDir()!, SKILLS_PATH, skillName, "SKILL.md");
  const localPath = path.join(".", SKILLS_PATH, skillName, "SKILL.md");
  if (await exists(localPath)) {
    return localPath;
  } else if (await exists(globalPath)) {
    return globalPath;
  }
  throw new Error(
    `Skill ${skillName} could not be found locally (${localPath}) or globally (${globalPath})`,
  );
}

export async function parseSkill(skillPath: string) {
  const content = await Deno.readTextFile(skillPath);
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

export async function findSkills() {
  const globalPath = path.join(homeDir()!, SKILLS_PATH);
  const localPath = path.join(".", SKILLS_PATH);
  const map: Map<string, string> = new Map();
  for await (const entry of Deno.readDir(globalPath)) {
    if (entry.isDirectory) {
      const skillPath = path.join(globalPath, entry.name, "SKILL.md");
      if (await exists(skillPath)) {
        map.set(entry.name, (await parseSkill(skillPath)).description);
      }
    }
  }
  for await (const entry of Deno.readDir(localPath)) {
    if (entry.isDirectory) {
      const skillPath = path.join(localPath, entry.name, "SKILL.md");
      if (await exists(skillPath)) {
        map.set(entry.name, (await parseSkill(skillPath)).description);
      }
    }
  }
  return map;
}
