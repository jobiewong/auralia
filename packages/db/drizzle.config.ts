import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./drizzle/schema.ts",
  out: "./drizzle/migrations",
  dbCredentials: {
    // config lives in packages/db, DB lives at repo root data/db
    url: "../../data/db/auralia.sqlite",
  },
});
