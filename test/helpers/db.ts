import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "../../src/worker/core/db/schema";

export type TestDb = ReturnType<typeof createTestDb>;

/** Creates an in-memory SQLite database with the full production schema applied. */
export function createTestDb() {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "./drizzle" });
  return db;
}
