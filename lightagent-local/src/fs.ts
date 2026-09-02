import {
  DirEntry,
  FileInfo,
  FileNotFoundError,
  FileSystem,
} from "@cle-does-things/lightagent-core";
import { LocalEnvironment } from "./environment.ts";

export class LocalFileSystem implements FileSystem {
  env: LocalEnvironment = new LocalEnvironment();

  async readToString(path: string): Promise<string> {
    return await Deno.readTextFile(path);
  }

  async write(path: string, content: string) {
    return await Deno.writeTextFile(path, content);
  }

  readDir(path: string): AsyncIterable<DirEntry> {
    return Deno.readDir(path);
  }

  async stat(path: string): Promise<FileInfo> {
    try {
      return await Deno.stat(path);
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) {
        throw new FileNotFoundError(e.message);
      }
      throw e;
    }
  }

  homeDir(): string | undefined {
    return this.env.get("USERPROFILE") ?? this.env.get("HOME");
  }

  cwd(): string {
    return Deno.cwd();
  }

  async mkdir(path: string, recursive: boolean): Promise<void> {
    return await Deno.mkdir(path, { recursive });
  }

  async readLines(path: string, nLines: number): Promise<string[]> {
    const input = await Deno.open(path);
    const reader = input.readable.getReader();
    const lines: string[] = [];
    let buffer = "";

    const decoder = new TextDecoder();

    try {
      while (lines.length < nLines) {
        const { value: encoded, done } = await reader.read();
        if (done) break;
        const value = decoder.decode(encoded);
        buffer += value;
        let idx: number;
        while (lines.length < nLines && (idx = buffer.indexOf("\n")) !== -1) {
          lines.push(buffer.slice(0, idx));
          buffer = buffer.slice(idx + 1);
        }
      }
    } finally {
      await reader.cancel();
    }

    return lines;
  }
}
