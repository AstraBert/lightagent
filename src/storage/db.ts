import { Database } from "@db/sqlite";

export const LIGHTAGENT_DB_PATH = "lightagent/sessions.sqlite";
let dbClient: undefined | Database = undefined;

export function homeDir(): string | undefined {
  return Deno.build.os === "windows"
    ? Deno.env.get("USERPROFILE")
    : Deno.env.get("HOME");
}

export function getDbClient() {
  if (!dbClient) {
    const base = homeDir()
    if (!base) {
      throw new Error(`Could not find a home directory for the current environment. Ensure that the variable ${Deno.build.os === 'windows' ? 'USERPROFILE' : 'HOME'} is set.`)
    }
    const path = (base.endsWith("/") ? base.slice(0, base.length - 1) : base) + "/" + LIGHTAGENT_DB_PATH
    dbClient = new Database(path);
    dbClient.exec("pragma journal_mode = WAL")
    dbClient.exec("pragma synchronous = NORMAL")
  }
  return dbClient
}
