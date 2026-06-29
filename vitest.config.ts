import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/",
        "test/",
        "**/*.test.ts",
        "**/*.config.ts",
        "src/index.ts"
      ],
      thresholds: {
        branches: 99,
        functions: 99,
        lines: 99,
        statements: 99
      }
    }
  }
})
