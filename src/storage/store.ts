import { Database } from "@db/sqlite";
import { getDbClient } from "./db.ts";
import { applyMigrations } from "./migrations.ts";
import { AgentEvent, AgentEventSchema } from "../events.ts";
import * as v from "valibot";

export class AgentStorage {
  private db: Database;
  private initialized: boolean;

  constructor() {
    this.db = getDbClient();
    this.initialized = false;
  }

  private async initStorage() {
    if (!this.initialized) {
      await applyMigrations(this.db);
      this.initialized = true;
    }
  }

  async store(event: AgentEvent) {
    await this.initStorage();
    this.db.exec(
      "insert into events (session_id, payload, created_at) values (:sessionId, :payload, :createdAt)",
      {
        sessionId: event.sessionId,
        payload: JSON.stringify(event),
        createdAt: Number(event.timestamp),
      },
    );
  }

  async getSessionEvents(sessionId: string): Promise<AgentEvent[]> {
    await this.initStorage();
    const stmt = this.db.prepare(
      "select payload from events where session_id = :sessionId order by created_at, id",
    );
    const events = stmt.all<{ payload: string }>({ sessionId });
    const agentEvents: AgentEvent[] = [];
    for (const event of events) {
      const data = JSON.stringify(event.payload);
      agentEvents.push(await v.parseAsync(AgentEventSchema, data));
    }
    return agentEvents;
  }
}
