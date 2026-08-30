import { DOFileSystem } from "./fs.ts";
import * as path from "@std/path"
// import git from "isomorphic-git"
// import http from "isomorphic-git/http/web"

export class FileUploader {
  baseSkillPath: string = ".agents/skills"
  private fs: DOFileSystem

  constructor(bucket: R2Bucket) {
    this.fs = new DOFileSystem(bucket)
  }

  async uploadFile(path: string, content: string) {
    await this.fs.write(path, content)
  }

  async uploadSkill(name: string, content: string, global: boolean) {
    if (global) {
      const p = path.join(this.fs.homeDir()!, this.baseSkillPath, name, "SKILL.md")
      await this.fs.write(p, content)
    } else {
      const p = path.join(this.fs.cwd(), this.baseSkillPath, name, "SKILL.md")
      await this.fs.write(p, content)
    }
  }

  // async gitClone(repository: string, options?: { branch?: string, commit?: string, authToken?: string }) {
  // }
}
