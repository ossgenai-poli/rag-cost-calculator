import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "components/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["lib/calc-engine.ts", "lib/crossover.ts"],
      thresholds: {
        lines: 90,
        functions: 90,
        statements: 90,
      },
      reporter: ["text", "json-summary"],
    },
  },
});
