import { type AgentEvent, AgentEventSchema } from "./events.ts";
import * as v from "valibot";
import { applyMigrations, type BindType } from "./apply-migrations.ts";

export type SqlBindValue =
  | number
  | string
  | symbol
  | bigint
  | boolean
  | null
  | undefined
  | Date
  | Uint8Array
  | SqlBindValue[]
  | { [key: string]: SqlBindValue };

export type SqlBindParameters = SqlBindValue[] | [SqlBindParameters];

/* SQL statement, resulting from a `prepare` operation */
export interface SqlStatement<T> {
  /* Fetch all records associated with the statement */
  all(...parameters: SqlBindParameters): Promise<T[]>;
  /* Fetch the first record associated with the statement, if any */
  get(...parameters: SqlBindParameters): Promise<T | undefined>;
}

export interface SqliteClient {
  /* Execute a non-readonly SQL statement, optionally specifying bind parameters */
  exec(sql: string, ...parameters: SqlBindParameters): Promise<void>;
  /* Execute a `select` statement, optionally specifying bind parameters */
  prepare<T extends object>(sql: string): Promise<SqlStatement<T>>;
}

function writeQuery(query: string, paramNames: string[]): string {
  let mutable = query;
  for (const paramName of paramNames) {
    mutable = mutable.replace("?", paramName);
  }
  return mutable;
}

export class AgentStorage {
  bindType: BindType;
  private db: SqliteClient;
  private initialized: boolean;

  constructor(db: SqliteClient, bindType: BindType) {
    this.bindType = bindType;
    this.db = db;
    this.initialized = false;
  }

  async initStorage(): Promise<void> {
    if (!this.initialized) {
      await applyMigrations(this.db, this.bindType);
      this.initialized = true;
    }
  }

  async store(event: AgentEvent): Promise<void> {
    await this.initStorage();
    let query =
      "insert into events (session_id, payload, created_at) values (?, ?, ?)";
    let binds: { sessionId: string; payload: string; createdAt: number } | [
      string,
      string,
      number,
    ] = [event.sessionId, JSON.stringify(event), Number(event.timestamp)];
    if (this.bindType === "named") {
      query = writeQuery(query, [":sessionId", ":payload", ":createdAt"]);
      binds = {
        sessionId: event.sessionId,
        payload: JSON.stringify(event),
        createdAt: Number(event.timestamp),
      };
    }
    await this.db.exec(
      query,
      binds,
    );
  }

  async getSessionEvents(
    sessionId: string,
    afterTimestamp?: number,
  ): Promise<AgentEvent[]> {
    await this.initStorage();
    let sql =
      "select payload from events where session_id = ? order by id, created_at";
    let params: Record<string, string | number> | (string | number)[] = [
      sessionId,
    ];
    if (this.bindType === "named") {
      sql = writeQuery(sql, [":sessionId"]);
      params = { sessionId };
    }
    if (afterTimestamp) {
      sql =
        "select payload from events where session_id = ? and created_at > ? order by id, created_at";
      params = [sessionId, afterTimestamp];
      if (this.bindType === "named") {
        sql = writeQuery(sql, [":sessionId", ":timestamp"]);
        params = {
          sessionId,
          timestamp: afterTimestamp,
        };
      }
    }
    const stmt = await this.db.prepare<{ payload: string }>(sql);
    const events = await stmt.all(params);
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
