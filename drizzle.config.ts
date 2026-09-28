import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/lib/server/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
});
