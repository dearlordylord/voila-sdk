import {
  classifyHealthStatus,
  decideKeepaliveStep,
  defaultKeepalivePolicy,
  describeKeepaliveOutcome,
  type KeepaliveOutcome,
  type KeepalivePolicy,
  runKeepaliveLoop,
  type SessionHealthStatus
} from "@firfi/voila-sdk"
import { describe, expect, it } from "vitest"

const policy: KeepalivePolicy = { healthyIntervalMs: 1000, retryDelayMs: 100, stopOnExpired: true }
const nonStoppingPolicy: KeepalivePolicy = { ...policy, stopOnExpired: false }

const allOutcomes: ReadonlyArray<KeepaliveOutcome> = [
  { _tag: "healthy" },
  { _tag: "transient" },
  { _tag: "schema-changed" },
  { _tag: "expired" },
  { _tag: "check-failed" }
]

const makeRecorder = (): {
  readonly delays: ReadonlyArray<number>
  readonly log: (message: string) => void
  readonly messages: ReadonlyArray<string>
  readonly sleep: (delayMs: number) => Promise<void>
} => {
  const delays: Array<number> = []
  const messages: Array<string> = []

  return {
    delays,
    log: (message) => messages.push(message),
    messages,
    sleep: async (delayMs) => void delays.push(delayMs)
  }
}

const makeQueuedTick = (
  outcomes: ReadonlyArray<KeepaliveOutcome>
): { readonly isCancelled: () => boolean; readonly tick: () => Promise<KeepaliveOutcome> } => {
  let index = 0

  return {
    isCancelled: () => index >= outcomes.length,
    tick: async () => {
      const outcome = outcomes[index]

      if (outcome === undefined) {
        throw new Error("keepalive tick called after queue drained")
      }

      index += 1

      return outcome
    }
  }
}

describe("keepalive core", () => {
  it("exposes a non-stopping default policy with sensible delays", () => {
    expect(defaultKeepalivePolicy.stopOnExpired).toBe(false)
    expect(defaultKeepalivePolicy.healthyIntervalMs).toBeGreaterThan(defaultKeepalivePolicy.retryDelayMs)
    expect(defaultKeepalivePolicy.retryDelayMs).toBeGreaterThan(0)
  })

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

  it("waits after healthy and schema-changed outcomes", () => {
    expect(decideKeepaliveStep(policy, { _tag: "healthy" })).toEqual({ _tag: "wait", delayMs: 1000 })
    expect(decideKeepaliveStep(policy, { _tag: "schema-changed" })).toEqual({ _tag: "wait", delayMs: 1000 })
  })

  it("uses the shorter retry delay for transient and failed checks", () => {
    expect(decideKeepaliveStep(policy, { _tag: "transient" })).toEqual({ _tag: "wait", delayMs: 100 })
    expect(decideKeepaliveStep(policy, { _tag: "check-failed" })).toEqual({ _tag: "wait", delayMs: 100 })
  })

  it("stops on expiry only when the policy opts in", () => {
    expect(decideKeepaliveStep(policy, { _tag: "expired" })).toEqual({ _tag: "stop", reason: "expired" })
    expect(decideKeepaliveStep(nonStoppingPolicy, { _tag: "expired" })).toEqual({ _tag: "wait", delayMs: 1000 })
  })

  it("describes every outcome without leaking secrets", () => {
    for (const outcome of allOutcomes) {
      expect(describeKeepaliveOutcome(outcome).length).toBeGreaterThan(0)
    }

    expect(describeKeepaliveOutcome({ _tag: "expired" })).toContain("auth login")
  })

  it("returns cancelled before ticking when already cancelled", async () => {
    const recorder = makeRecorder()

    const reason = await runKeepaliveLoop(policy, {
      isCancelled: () => true,
      log: recorder.log,
      sleep: recorder.sleep,
      tick: async () => {
        throw new Error("tick should not run when cancelled")
      }
    })

    expect(reason).toBe("cancelled")
    expect(recorder.messages).toEqual([])
    expect(recorder.delays).toEqual([])
  })

  it("stops with the expired reason and logs the outcome", async () => {
    const recorder = makeRecorder()
    let ticks = 0

    const reason = await runKeepaliveLoop(policy, {
      isCancelled: () => false,
      log: recorder.log,
      sleep: recorder.sleep,
      tick: async () => {
        ticks += 1

        return { _tag: "expired" }
      }
    })

    expect(reason).toBe("expired")
    expect(ticks).toBe(1)
    expect(recorder.delays).toEqual([])
    expect(recorder.messages).toHaveLength(1)
  })

  it("waits between ticks using outcome-specific delays until cancelled", async () => {
    const recorder = makeRecorder()
    const queued = makeQueuedTick([{ _tag: "transient" }, { _tag: "healthy" }])

    const reason = await runKeepaliveLoop(policy, {
      isCancelled: queued.isCancelled,
      log: recorder.log,
      sleep: recorder.sleep,
      tick: queued.tick
    })

    expect(reason).toBe("cancelled")
    expect(recorder.delays).toEqual([100, 1000])
    expect(recorder.messages).toHaveLength(2)
  })

  it("keeps polling after expiry when the policy does not stop", async () => {
    const recorder = makeRecorder()
    const queued = makeQueuedTick([{ _tag: "expired" }])

    const reason = await runKeepaliveLoop(nonStoppingPolicy, {
      isCancelled: queued.isCancelled,
      log: recorder.log,
      sleep: recorder.sleep,
      tick: queued.tick
    })

    expect(reason).toBe("cancelled")
    expect(recorder.delays).toEqual([1000])
  })
})
