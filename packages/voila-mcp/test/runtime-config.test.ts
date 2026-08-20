import { Result, Schema } from "effect"
import { describe, expect, it } from "vitest"

import { makeRuntimeConfig, RuntimeEnvSchema, TcpPortSchema } from "../src/runtime-config.js"

describe("MCP runtime configuration", () => {
  it("decodes a whole-second keepalive interval into a safe millisecond brand", () => {
    const result = makeRuntimeConfig({ VOILA_KEEPALIVE_INTERVAL_SECONDS: "3600" })

    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isSuccess(result)) {
      expect(result.success.keepaliveIntervalMs).toBe(3_600_000)
      expect(result.success.keepaliveMode).toBe("enabled")
    }
  })

  it("rejects fractional, below-minimum, nonfinite, and unsafe intervals", () => {
    for (const value of ["3599", "3600.5", "3e3", "Infinity", "9007199254741"]) {
      expect(Result.isFailure(makeRuntimeConfig({ VOILA_KEEPALIVE_INTERVAL_SECONDS: value }))).toBe(true)
    }
  })

  it("represents opt-out as an explicit operator mode", () => {
    const result = makeRuntimeConfig({ VOILA_KEEPALIVE: "0" })

    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isSuccess(result)) {
      expect(result.success.keepaliveMode).toBe("disabled")
      expect(result.success.keepaliveIntervalMs).toBeUndefined()
    }
  })

  it("keeps the environment decoder schema-owned", () => {
    const decoded = Schema.decodeUnknownResult(RuntimeEnvSchema)({ VOILA_KEEPALIVE_INTERVAL_SECONDS: "3600" })

    expect(Result.isSuccess(decoded)).toBe(true)
  })

  it("parses TCP ports through a branded schema at the environment boundary", () => {
    const result = makeRuntimeConfig({ MCP_HTTP_PORT: "8080" })

    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isSuccess(result)) {
      expect(result.success.httpPort).toBe(8080)
    }

    expect(Result.isSuccess(Schema.decodeUnknownResult(TcpPortSchema)(8080))).toBe(true)
  })

  it("rejects non-canonical, out-of-range, and unsafe TCP port values", () => {
    for (const value of ["0", "65536", "08080", "8080.0", "8e3", "Infinity", "9007199254740992"]) {
      expect(Result.isFailure(makeRuntimeConfig({ MCP_HTTP_PORT: value }))).toBe(true)
    }
  })
})
