import { defineConfig } from "vitest/config"

import { coveragePolicy } from "./scripts/coverage-policy.mjs"

const coverageThresholds = Object.fromEntries(
  coveragePolicy.metrics.map((metric) => [metric, coveragePolicy.threshold])
)

export default defineConfig({
  resolve: {
    alias: {
      "@firfi/voila-cli": new URL("packages/voila-cli/src/index.ts", import.meta.url).pathname,
      "@firfi/voila-mcp": new URL("packages/voila-mcp/src/index.ts", import.meta.url).pathname,
      "@firfi/voila-sdk": new URL("packages/voila-sdk/src/index.ts", import.meta.url).pathname
    }
  },
  test: {
    globals: true,
    environment: "node",
    include: ["packages/*/src/**/*.test.ts", "packages/*/test/**/*.test.ts", "scripts/*.test.ts"],
    reporters: ["dot"],
    silent: "passed-only",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/",
        "scripts/",
        "**/dist/**",
        "packages/*/test/",
        "packages/voila-cli/src/**",
        "packages/voila-mcp/src/**",
        "**/*.test.ts",
        "**/*.config.ts",
        "packages/*/src/index.ts",
        "packages/*/src/bin.ts"
      ],
      skipFull: true,
      thresholds: coverageThresholds
    }
  }
})
