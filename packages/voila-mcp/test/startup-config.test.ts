import { KeepaliveHealthyIntervalMsSchema, type KeepaliveHealthyIntervalMs } from "@firfi/voila-sdk"
import { Result, Schema } from "effect"
import { describe, expect, it } from "vitest"

import {
  KeepaliveStartupStateSchema,
  keepaliveEligibilityFor,
  keepaliveStartupStateFor as makeKeepaliveStartupState,
  NodeEnvironmentSchema
} from "../src/startup-config.js"

const nodeConfig = (input: Record<string, string>) => Schema.decodeUnknownSync(NodeEnvironmentSchema)(input)

const keepaliveStartupStateFor = (...args: Parameters<typeof makeKeepaliveStartupState>) => {
  const state = makeKeepaliveStartupState(...args)

  if (Result.isFailure(state)) {
    throw new Error(state.failure.message)
  }

  return state.success
}

describe("MCP keepalive startup state", () => {
  it("distinguishes authenticated, guest, and missing-session eligibility", () => {
    expect(keepaliveEligibilityFor(nodeConfig({ VOILA_AUTH_SESSION_PATH: "/tmp/session.json" }))).toBe(
      "authenticated-session"
    )
    expect(keepaliveEligibilityFor(nodeConfig({}))).toBe("missing-session")
    expect(
      keepaliveEligibilityFor(nodeConfig({ VOILA_AUTH_SESSION_PATH: "/tmp/session.json", VOILA_GUEST: "1" }))
    ).toBe("guest")
  })

  it("constructs one explicit startup state instead of a boolean product", () => {
    const interval: KeepaliveHealthyIntervalMs = Schema.decodeUnknownSync(KeepaliveHealthyIntervalMsSchema)(3_600_000)

    expect(keepaliveStartupStateFor({ mode: "disabled", eligibility: "authenticated-session" })).toEqual({
      _tag: "disabled",
      reason: "operator"
    })
    expect(keepaliveStartupStateFor({ mode: "enabled", eligibility: "guest", healthyIntervalMs: interval })).toEqual({
      _tag: "ineligible",
      reason: "guest"
    })
    expect(keepaliveStartupStateFor({ mode: "enabled", eligibility: "missing-session" })).toEqual({
      _tag: "ineligible",
      reason: "missing-session"
    })
    expect(keepaliveStartupStateFor({ mode: "enabled", eligibility: "authenticated-session" })).toMatchObject({
      _tag: "enabled",
      config: { healthyIntervalMs: 86_400_000 }
    })
    expect(
      keepaliveStartupStateFor({ mode: "enabled", eligibility: "authenticated-session", healthyIntervalMs: interval })
    ).toEqual({
      _tag: "enabled",
      config: { healthyIntervalMs: interval, maxRetryDelayMs: 300_000, retryDelayMs: 30_000, expiryPolicy: "continue" }
    })
  })

  it("keeps startup states schema-owned", () => {
    const interval = Schema.decodeUnknownSync(KeepaliveHealthyIntervalMsSchema)(3_600_000)
    const state = keepaliveStartupStateFor({
      mode: "enabled",
      eligibility: "authenticated-session",
      healthyIntervalMs: interval
    })

    expect(Result.isSuccess(Schema.decodeUnknownResult(KeepaliveStartupStateSchema)(state))).toBe(true)
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(KeepaliveStartupStateSchema)({
          _tag: "enabled",
          config: { healthyIntervalMs: 0, maxRetryDelayMs: 1, retryDelayMs: 1, expiryPolicy: "continue" }
        })
      )
    ).toBe(true)
  })
})
