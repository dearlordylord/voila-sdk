import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["packages/*/src/**/*.test.ts", "packages/*/test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/",
        "**/dist/**",
        "packages/*/test/",
        "packages/voila-cli/src/**",
        "packages/voila-mcp/src/**",
        "**/*.test.ts",
        "**/*.config.ts",
        "packages/*/src/index.ts",
        "packages/*/src/bin.ts"
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
