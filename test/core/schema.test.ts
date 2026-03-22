import { describe, test, expect } from "bun:test";
import { createTestDb } from "../helpers/db";

describe("in-memory schema", () => {
  test("all 10 tables exist after migration", () => {
    const db = createTestDb();
    const tables = db.$client
      .query(
        "SELECT name FROM sqlite_master WHERE type='table'" +
          " AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'" +
          " ORDER BY name",
      )
      .all() as Array<{ name: string }>;

    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain("markets");
    expect(tableNames).toContain("market_links");
    expect(tableNames).toContain("prices");
    expect(tableNames).toContain("bot_instances");
    expect(tableNames).toContain("orders");
    expect(tableNames).toContain("trades");
    expect(tableNames).toContain("positions");
    expect(tableNames).toContain("bot_metrics");
    expect(tableNames).toContain("tracked_traders");
    expect(tableNames).toContain("audit_log");
  });

  test("markets table has expected columns", () => {
    const db = createTestDb();
    const columns = db.$client
      .query("PRAGMA table_info(markets)")
      .all() as Array<{ name: string }>;
    const colNames = columns.map((c) => c.name);

    expect(colNames).toContain("id");
    expect(colNames).toContain("platform");
    expect(colNames).toContain("platform_id");
    expect(colNames).toContain("title");
    expect(colNames).toContain("status");
    expect(colNames).toContain("created_at");
    expect(colNames).toContain("updated_at");
    expect(colNames).toContain("clob_token_ids");
    expect(colNames).toContain("neg_risk_market_id");
  });

  test("bot_instances table has expected columns", () => {
    const db = createTestDb();
    const columns = db.$client
      .query("PRAGMA table_info(bot_instances)")
      .all() as Array<{ name: string }>;
    const colNames = columns.map((c) => c.name);

    expect(colNames).toContain("id");
    expect(colNames).toContain("bot_type");
    expect(colNames).toContain("config");
    expect(colNames).toContain("status");
  });
});
