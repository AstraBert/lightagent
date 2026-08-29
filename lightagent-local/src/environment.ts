import { Environment, OSType } from "@cle-does-things/lightagent-core";

export class LocalEnvironment implements Environment {
  get(key: string): string | undefined {
    return Deno.env.get(key);
  }

  set(key: string, value: string): void {
    Deno.env.set(key, value);
  }

  contains(key: string): boolean {
    return Deno.env.has(key);
  }

  delete(key: string): void {
    Deno.env.delete(key);
  }

  os(): OSType {
    return Deno.build.os;
  }
}
