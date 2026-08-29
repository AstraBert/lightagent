import { type AgentEvent, AgentEventSchema } from "./events.ts";
import * as v from "valibot";
import type { FileSystem } from "./fs.ts";
import { applyMigrations } from "./migrations.ts";

export type SqlBindValue = number
| string
| symbol
| bigint
| boolean
| null
| undefined
| Date
| Uint8Array
| SqlBindValue[]
| { [key: string]: SqlBindValue; }

export type SqlBindParameters = SqlBindValue[] | [SqlBindParameters]

/* SQL statement, resulting from a `prepare` operation */
export interface SqlStatement<T> {
  /* Fetch all records associated with the statement */
  all(...parameters: SqlBindParameters): T[],
  /* Fetch the first record associated with the statement, if any */
  get(...parameters: SqlBindParameters): T | undefined
}

export interface SqliteClient {
  /* Execute a non-readonly SQL statement, optionally specifying bind parameters */
  exec(sql: string, ...parameters: SqlBindParameters): Promise<void>,
  /* Execute a `select` statement, optionally specifying bind parameters */
  prepare<T extends object>(sql: string): Promise<SqlStatement<T>>,
}

export class AgentStorage {
  private fs: FileSystem
  private db: SqliteClient;
  private initialized: boolean;

  constructor(db: SqliteClient, fs: FileSystem) {
    this.db = db;
    this.fs = fs;
    this.initialized = false;
  }

  async initStorage(): Promise<void> {
    if (!this.initialized) {
      await applyMigrations(this.db, this.fs);
      this.initialized = true;
    }
  }

  async store(event: AgentEvent): Promise<void> {
    await this.initStorage();
    await this.db.exec(
      "insert into events (session_id, payload, created_at) values (:sessionId, :payload, :createdAt)",
      {
        sessionId: event.sessionId,
        payload: JSON.stringify(event),
        createdAt: Number(event.timestamp),
      },
    );
  }

  async getSessionEvents(sessionId: string, afterTimestamp?: number): Promise<AgentEvent[]> {
    await this.initStorage();
    let sql = "select payload from events where session_id = :sessionId order by id, created_at"
    let params: Record<string, string | number> = { sessionId }
    if (afterTimestamp) {
      sql = "select payload from events where session_id = :sessionId and created_at > :timestamp order by id, created_at"
      params = { sessionId, timestamp: afterTimestamp }
    }
    const stmt = await this.db.prepare<{ payload: string }>(sql);
    const events = stmt.all(params);
    const agentEvents: AgentEvent[] = [];
    for (const event of events) {
      const data = JSON.parse(event.payload, (key, value) => {
        if (key === "timestamp" && typeof value === "string") {
          return new Date(value);
        }
        return value;
      });
      agentEvents.push(await v.parseAsync(AgentEventSchema, data));
    }
    return agentEvents;
  }
}
