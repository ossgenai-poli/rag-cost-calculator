import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // Next.js tsconfig uses jsx:preserve; compile JSX for the .tsx component tests (no effect on .ts suites).
  // rolldown-vite transform option (oxc replaces esbuild)
  oxc: { jsx: { runtime: "automatic" } },
  // Resolve the Next.js "@/" path alias for component tests.
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
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
