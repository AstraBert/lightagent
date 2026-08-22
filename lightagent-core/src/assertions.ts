import * as path from "@std/path"

export function assertValidSkillName(skillName: string) {
  if (skillName.length === 0 || skillName.length > 64) {
    throw new Error(`Invalid skill name: ${skillName}`);
  }
  // Lowercase letters, numbers, hyphens only. Max 64 chars.
  // No leading/trailing hyphen (also excludes empty string and "-").
  if (!/^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/.test(skillName)) {
    throw new Error(`Invalid skill name: ${skillName}`);
  }
}

export function assertFileWithinWorkspace(filePath: string, basePath: string): string {
  let resolved: string;
  if (path.isAbsolute(filePath)) {
    resolved = filePath;
  } else {
    resolved = path.normalize(path.join(basePath, filePath))
  }
  if (path.common([resolved, basePath]) === basePath) {
    return resolved
  }
  throw new Error("Attempting to access file outside of current working directory")
}


export function assertUniqueString(container: string, contained: string) {
  if (container.indexOf(contained) === container.lastIndexOf(contained)) {
    return
  }
  throw new Error("Attempting to modify a non-unique string: set `replace_all` to True if you want to perform multiple edits at once")
}
