import { makeKeepaliveConfig, type KeepaliveConfig } from "./keepalive-runner.js"

import type { OperationEnvironment } from "./operations.js"

export interface KeepaliveRuntimeConfig {
  readonly keepaliveDisabled: boolean
  readonly keepaliveIntervalMs: number | undefined
}

/**
 * Decide whether MCP startup may launch a keepalive. Auth guidance is a tool
 * response concern and is intentionally not an eligibility signal: ordinary
 * guest operation environments can carry guidance while having no configured
 * state file path.
 */
export const keepaliveConfigFor = (
  runtime: KeepaliveRuntimeConfig,
  env: OperationEnvironment
): KeepaliveConfig | undefined => {
  if (runtime.keepaliveDisabled || env.sessionSnapshotPath === undefined) {
    return undefined
  }

  return makeKeepaliveConfig({
    ...(runtime.keepaliveIntervalMs === undefined ? {} : { healthyIntervalMs: runtime.keepaliveIntervalMs })
  })
}
