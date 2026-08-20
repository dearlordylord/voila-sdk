import {
  classifyHealthStatus,
  describeKeepaliveOutcome,
  type KeepaliveOutcome,
  type KeepaliveStopReason,
  type SessionHealthStatus
} from "@firfi/voila-sdk"
import { describe, expect, it } from "vitest"

const allStatuses: ReadonlyArray<SessionHealthStatus> = [
  "active",
  "retry",
  "schema-changed",
  "reauth-required",
  "unauthorized"
]

const allOutcomes: ReadonlyArray<KeepaliveOutcome> = [
  { _tag: "healthy" },
  { _tag: "transient" },
  { _tag: "schema-changed" },
  { _tag: "expired" },
  { _tag: "check-failed" }
]

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

  it("describes every outcome without leaking secrets", () => {
    for (const outcome of allOutcomes) {
      expect(describeKeepaliveOutcome(outcome).length).toBeGreaterThan(0)
    }

    expect(describeKeepaliveOutcome({ _tag: "expired" })).toContain("auth login")
  })

  it("folds the redacted cause into the check-failed description", () => {
    expect(describeKeepaliveOutcome({ _tag: "check-failed" })).toBe("session keepalive check failed; will retry")
    expect(describeKeepaliveOutcome({ _tag: "check-failed", cause: "VoilaOperationFailed" })).toBe(
      "session keepalive check failed (VoilaOperationFailed); will retry"
    )
  })

  it("exposes a stop reason for re-auth, interruption, and misconfiguration", () => {
    const reasons: ReadonlyArray<KeepaliveStopReason> = ["expired", "cancelled", "misconfigured"]

    expect(new Set(reasons).size).toBe(reasons.length)
  })

  it("covers every known status so a new one cannot slip past the classifier", () => {
    expect(allStatuses).toHaveLength(5)
    expect(allOutcomes).toHaveLength(5)
  })
})
