import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  schema: "./src/worker/core/db/schema.ts",
  dialect: "sqlite",
});
