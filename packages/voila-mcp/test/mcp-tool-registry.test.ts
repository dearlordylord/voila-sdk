import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import { executeVoilaTool } from "../src/mcp-tool-registry.js"
import { makeStubEnvironment } from "./helpers/operations.js"

describe("Voila MCP tool registry", () => {
  it("turns a defect while rendering malformed input into a generic tool error", async () => {
    const environment = makeStubEnvironment(() => Effect.die("transport must not run")).env

    const result = await Effect.runPromise(executeVoilaTool("voila_get_cart", 1n, environment))

    expect(result).toMatchObject({
      content: [{ text: "Tool execution failed due to an internal server error.", type: "text" }],
      isError: true
    })
  })
})
