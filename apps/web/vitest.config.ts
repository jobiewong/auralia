import { defineConfig } from "vitest/config";

/** Keeps Vitest decoupled from the TanStack/Vite app config; tests are Node-only smoke checks. */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
