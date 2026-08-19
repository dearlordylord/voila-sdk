import { describe, expect, it } from "vitest"
import { Schema } from "effect"

import { keepaliveConfigFor, keepaliveEligibleFor, NodeEnvironmentSchema } from "../src/startup-config.js"

const nodeConfig = (input: Record<string, string>) => Schema.decodeUnknownSync(NodeEnvironmentSchema)(input)

describe("MCP keepalive startup eligibility", () => {
  it("requires an explicit authenticated session path and rejects guest mode", () => {
    expect(keepaliveEligibleFor(nodeConfig({ VOILA_AUTH_SESSION_PATH: "/tmp/session.json" }))).toBe(true)
    expect(keepaliveEligibleFor(nodeConfig({}))).toBe(false)
    expect(keepaliveEligibleFor(nodeConfig({ VOILA_AUTH_SESSION_PATH: "/tmp/session.json", VOILA_GUEST: "1" }))).toBe(
      false
    )
  })

  it("keeps disabled startup from constructing a loop configuration", () => {
    expect(keepaliveConfigFor({ keepaliveDisabled: true, keepaliveIntervalMs: undefined }, true)).toBeUndefined()
    expect(keepaliveConfigFor({ keepaliveDisabled: false, keepaliveIntervalMs: undefined }, false)).toBeUndefined()
    expect(
      keepaliveConfigFor({ keepaliveDisabled: false, keepaliveIntervalMs: 3_600_000 }, true)?.healthyIntervalMs
    ).toBe(3_600_000)
  })
})
