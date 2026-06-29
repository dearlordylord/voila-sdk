import type { OperationExecutionResult, VoilaOperationName } from "@firfi/voila-mcp"
import { describe, expect, it } from "vitest"

import { type CliLoginOptions, type CliOperationOptions, type CliPorts, runCli } from "../src/cli.js"

const success = (value: unknown): OperationExecutionResult => ({
  ok: true,
  value
})

const failure = (tag: string): OperationExecutionResult => ({
  error: {
    _tag: tag,
    message: "failed"
  },
  ok: false
})

const makePorts = (
  result: OperationExecutionResult = success({ status: "ok" })
): {
  readonly calls: ReadonlyArray<{
    readonly input: unknown
    readonly name: VoilaOperationName
    readonly options: CliOperationOptions
  }>
  readonly loginCalls: ReadonlyArray<CliLoginOptions>
  readonly ports: CliPorts
} => {
  const calls: Array<{
    readonly input: unknown
    readonly name: VoilaOperationName
    readonly options: CliOperationOptions
  }> = []
  const loginCalls: Array<CliLoginOptions> = []

  return {
    calls,
    loginCalls,
    ports: {
      login: async (options) => {
        loginCalls.push(options)

        return result
      },
      runOperation: async (name, input, options) => {
        calls.push({
          input,
          name,
          options
        })

        return result
      }
    }
  }
}

describe("Voila CLI", () => {
  it("renders help without invoking ports", async () => {
    const fake = makePorts()
    const result = await runCli(["--help"], fake.ports)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("voila auth login")
    expect(fake.calls).toEqual([])
    expect(fake.loginCalls).toEqual([])
  })

  it("uses explicit session paths for JSON search commands", async () => {
    const fake = makePorts(success({ products: [] }))
    const result = await runCli([
      "search",
      "milk",
      "--page-size",
      "3",
      "--page-token",
      "next",
      "--session",
      "/tmp/voila-session.json",
      "--json"
    ], fake.ports)

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      value: {
        products: []
      }
    })
    expect(fake.calls).toEqual([{
      input: {
        pageSize: 3,
        pageToken: "next",
        query: "milk"
      },
      name: "voila_search_products",
      options: {
        sessionPath: "/tmp/voila-session.json"
      }
    }])
  })

  it("maps cart add commands to cart item operation input", async () => {
    const fake = makePorts()
    const result = await runCli([
      "cart",
      "add",
      "product-id",
      "--quantity",
      "2",
      "--session",
      "/tmp/cart-session.json"
    ], fake.ports)

    expect(result.exitCode).toBe(0)
    expect(fake.calls).toEqual([{
      input: {
        items: [{
          productId: "product-id",
          quantity: 2
        }]
      },
      name: "voila_add_cart_items",
      options: {
        sessionPath: "/tmp/cart-session.json"
      }
    }])
  })

  it("maps order list commands to completed order operation input", async () => {
    const fake = makePorts(success({ orders: [] }))
    const result = await runCli([
      "orders",
      "list",
      "--page-size",
      "2",
      "--page-token",
      "next-orders",
      "--session",
      "/tmp/orders-session.json"
    ], fake.ports)

    expect(result.exitCode).toBe(0)
    expect(fake.calls).toEqual([{
      input: {
        pageSize: 2,
        pageToken: "next-orders"
      },
      name: "voila_get_completed_orders",
      options: {
        sessionPath: "/tmp/orders-session.json"
      }
    }])
  })

  it("passes auth login defaults and overrides to the login port", async () => {
    const fake = makePorts(success({ status: "active" }))
    const result = await runCli([
      "auth",
      "login",
      "--session",
      "/tmp/auth.json",
      "--profile",
      "/tmp/profile",
      "--timeout-ms",
      "10"
    ], fake.ports)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe("Authenticated session saved.\n")
    expect(fake.loginCalls).toEqual([{
      profilePath: "/tmp/profile",
      sessionPath: "/tmp/auth.json",
      timeoutMs: 10
    }])
  })

  it("returns typed operation failures on stderr", async () => {
    const fake = makePorts(failure("VoilaUnauthorizedSession"))
    const result = await runCli(["cart", "get", "--session", "/tmp/session.json"], fake.ports)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe("VoilaUnauthorizedSession: failed\n")
    expect(result.stdout).toBe("")
  })
})
