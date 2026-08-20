import {
  classifyHealthStatus,
  describeKeepaliveOutcome,
  KeepaliveExpiryPolicySchema,
  KeepaliveHealthyIntervalMsSchema,
  KeepaliveIntervalSecondsSchema,
  KeepaliveMaxRetryDelayMsSchema,
  KeepaliveConfigSchema,
  KeepaliveOutcomeSchema,
  KeepaliveRetryDelayMsSchema,
  KeepaliveStopReasonSchema,
  keepaliveIntervalMsFromSeconds,
  type KeepaliveOutcome,
  type SessionHealthStatus
} from "@firfi/voila-sdk"
import { Result, Schema } from "effect"
import { describe, expect, it } from "vitest"

describe("keepalive core", () => {
  it("classifies every session-health status", () => {
    const cases: ReadonlyArray<readonly [SessionHealthStatus, KeepaliveOutcome["_tag"]]> = [
      ["active", "healthy"],
      ["retry", "transient"],
      ["schema-changed", "schema-changed"],
      ["reauth-required", "expired"],
      ["unauthorized", "expired"]
    ]

    for (const [status, tag] of cases) {
      expect(classifyHealthStatus(status)._tag).toBe(tag)
    }
  })

  it("describes each schema outcome through the exhaustive matcher", () => {
    expect(describeKeepaliveOutcome({ _tag: "healthy" })).toContain("session active")
    expect(describeKeepaliveOutcome({ _tag: "transient" })).toContain("will retry")
    expect(describeKeepaliveOutcome({ _tag: "schema-changed" })).toContain("schema changed")
    expect(describeKeepaliveOutcome({ _tag: "expired" })).toContain("auth login")
    expect(describeKeepaliveOutcome({ _tag: "check-failed", cause: "VoilaOperationFailed" })).toBe(
      "session keepalive check failed (VoilaOperationFailed); will retry"
    )
  })

  it("exports runtime schemas for every public keepalive contract", () => {
    const outcomeValues: ReadonlyArray<unknown> = [
      { _tag: "healthy" },
      { _tag: "transient" },
      { _tag: "schema-changed" },
      { _tag: "expired" },
      { _tag: "check-failed", cause: "VoilaOperationFailed" }
    ]

    for (const value of outcomeValues) {
      expect(Result.isSuccess(Schema.decodeUnknownResult(KeepaliveOutcomeSchema)(value))).toBe(true)
    }

    expect(
      Result.isFailure(Schema.decodeUnknownResult(KeepaliveOutcomeSchema)({ _tag: "check-failed", cause: 1 }))
    ).toBe(true)
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(KeepaliveOutcomeSchema)({ _tag: "check-failed", cause: "secret-cookie-value" })
      )
    ).toBe(true)
    expect(Result.isFailure(Schema.decodeUnknownResult(KeepaliveOutcomeSchema)({ _tag: "check-failed" }))).toBe(true)
    expect(Result.isFailure(Schema.decodeUnknownResult(KeepaliveOutcomeSchema)({ _tag: "unknown" }))).toBe(true)

    for (const reason of ["expired", "cancelled", "misconfigured"]) {
      expect(Result.isSuccess(Schema.decodeUnknownResult(KeepaliveStopReasonSchema)(reason))).toBe(true)
    }

    expect(Result.isFailure(Schema.decodeUnknownResult(KeepaliveStopReasonSchema)("healthy"))).toBe(true)
  })

  it("parses only canonical whole-second intervals at or above one hour", () => {
    expect(Schema.decodeUnknownSync(KeepaliveIntervalSecondsSchema)("3600")).toBe(3600)
    expect(Schema.decodeUnknownSync(KeepaliveIntervalSecondsSchema)("9007199254740")).toBe(9007199254740)

    for (const value of ["", "0", "3599", "3600.5", "3600.0", "3e3", "-3600", "Infinity", "9007199254741"]) {
      expect(() => Schema.decodeUnknownSync(KeepaliveIntervalSecondsSchema)(value)).toThrow()
    }
  })

  it("converts interval seconds only when millisecond conversion remains safe", () => {
    const converted = keepaliveIntervalMsFromSeconds(Schema.decodeUnknownSync(KeepaliveIntervalSecondsSchema)("3600"))

    expect(converted).toBe(3_600_000)

    expect(() => Schema.decodeUnknownSync(KeepaliveIntervalSecondsSchema)("9007199254741")).toThrow()
  })

  it("constrains each keepalive duration to a distinct positive safe integer brand", () => {
    for (const schema of [
      KeepaliveHealthyIntervalMsSchema,
      KeepaliveRetryDelayMsSchema,
      KeepaliveMaxRetryDelayMsSchema
    ]) {
      expect(Schema.decodeUnknownSync(schema)(1)).toBe(1)

      for (const value of [-1, 0, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
        expect(() => Schema.decodeUnknownSync(schema)(value)).toThrow()
      }
    }
  })

  it("models expiry handling as an explicit policy", () => {
    expect(Schema.decodeUnknownSync(KeepaliveExpiryPolicySchema)("continue")).toBe("continue")
    expect(Schema.decodeUnknownSync(KeepaliveExpiryPolicySchema)("stop")).toBe("stop")
    expect(() => Schema.decodeUnknownSync(KeepaliveExpiryPolicySchema)("unknown")).toThrow()
  })

  it("rejects a retry cap below the initial retry delay", () => {
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(KeepaliveConfigSchema)({
          healthyIntervalMs: 100,
          maxRetryDelayMs: 9,
          retryDelayMs: 10,
          expiryPolicy: "continue"
        })
      )
    ).toBe(true)

    expect(
      Result.isSuccess(
        Schema.decodeUnknownResult(KeepaliveConfigSchema)({
          healthyIntervalMs: 100,
          maxRetryDelayMs: 10,
          retryDelayMs: 10,
          expiryPolicy: "continue"
        })
      )
    ).toBe(true)
  })
})
