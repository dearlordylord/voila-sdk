import {
  classifyHealthStatus,
  type KeepaliveOutcome,
  type KeepalivePolicy,
  type KeepaliveStopReason,
  runKeepaliveLoop
} from "@firfi/voila-sdk"
import { Either } from "effect"

import { type OperationEnvironment, performSessionHealthCheck } from "./operations.js"

const keepaliveCheckFailed: KeepaliveOutcome = { _tag: "check-failed" }

/**
 * A single keepalive tick: re-run the active-session health check (which
 * persists rotated cookies) and classify the resulting session state.
 */
export const runKeepaliveTick = async (env: OperationEnvironment): Promise<KeepaliveOutcome> => {
  const health = await performSessionHealthCheck(env)

  return Either.isLeft(health) ? keepaliveCheckFailed : classifyHealthStatus(health.right.status)
}

export interface KeepaliveLoopPorts {
  readonly isCancelled: () => boolean
  readonly log: (message: string) => void
  readonly sleep: (delayMs: number) => Promise<void>
}

export const startKeepalive = (
  env: OperationEnvironment,
  policy: KeepalivePolicy,
  ports: KeepaliveLoopPorts
): Promise<KeepaliveStopReason> =>
  runKeepaliveLoop(policy, {
    isCancelled: ports.isCancelled,
    log: ports.log,
    sleep: ports.sleep,
    tick: () => runKeepaliveTick(env)
  })

const sleepUntilElapsedOrCancelled = (delayMs: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve()

      return
    }

    const onAbort = (): void => {
      clearTimeout(timer)
      resolve()
    }

    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, delayMs)

    signal.addEventListener("abort", onAbort, { once: true })
  })

export interface KeepaliveHandle {
  readonly stop: () => void
  readonly wait: () => Promise<KeepaliveStopReason>
}

/**
 * Node wiring for the keepalive loop: a cancellable timer-based clock and an
 * stderr logger. Callers own lifecycle by calling `stop()` on shutdown.
 */
export const startNodeKeepalive = (
  env: OperationEnvironment,
  policy: KeepalivePolicy,
  writeLine: (line: string) => void = (line) => void process.stderr.write(line)
): KeepaliveHandle => {
  const controller = new AbortController()
  const done = startKeepalive(env, policy, {
    isCancelled: () => controller.signal.aborted,
    log: (message) => writeLine(`voila keepalive: ${message}\n`),
    sleep: (delayMs) => sleepUntilElapsedOrCancelled(delayMs, controller.signal)
  })

  return { stop: () => controller.abort(), wait: () => done }
}
