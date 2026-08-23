import { FileSystem, DirEntry, FileInfo, FileNotFoundError } from "@cle-does-things/lightagent-core";
import { LocalEnvironment } from "./environment.ts";

export class LocalFileSystem implements FileSystem {
  env: LocalEnvironment = new LocalEnvironment()

  async readToString(path: string): Promise<string> {
    return await Deno.readTextFile(path)
  }

  async write(path: string, content: string) {
    return await Deno.writeTextFile(path, content)
  }

  readDir(path: string): AsyncIterable<DirEntry> {
    return Deno.readDir(path)
  }

  async stat(path: string): Promise<FileInfo> {
    try {
      return await Deno.stat(path)
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) {
        throw new FileNotFoundError(e.message)
      }
      throw e
    }
  }

  homeDir(): string | undefined {
    return this.env.get("USERPROFILE") ?? this.env.get("HOME");
  }

  cwd(): string {
    return Deno.cwd()
  }

  async mkdir(path: string, recursive: boolean): Promise<void> {
    return await Deno.mkdir(path, { recursive })
  }
}
