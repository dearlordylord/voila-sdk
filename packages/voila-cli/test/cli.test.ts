import type { KeepaliveStopReason } from "@firfi/voila-sdk"
import type { OperationExecutionResult, VoilaOperationName } from "@firfi/voila-mcp"
import { describe, expect, it } from "vitest"

import {
  type CliKeepaliveOptions,
  type CliLoginOptions,
  type CliOperationOptions,
  type CliPorts,
  runCli
} from "../src/cli.js"

const success = (value: unknown): OperationExecutionResult => ({ ok: true, value })

const failure = (tag: string): OperationExecutionResult => ({ error: { _tag: tag, message: "failed" }, ok: false })

const authGuidanceFailure = (): OperationExecutionResult => ({
  error: {
    _tag: "CompletedOrdersGraphqlError",
    authGuidance: {
      command: "npx -y @firfi/voila-cli auth login --session /tmp/session.json",
      instructions: "Run login, close the browser window, then retry.",
      mcpEnv: { VOILA_AUTH_SESSION_PATH: "/tmp/session.json" },
      message: "Voila account session is required."
    },
    message: "Voila completed orders returned a GraphQL error; account login may be required"
  },
  ok: false
})

const makePorts = (
  result: OperationExecutionResult = success({ status: "ok" }),
  keepaliveReason: KeepaliveStopReason = "cancelled"
): {
  readonly calls: ReadonlyArray<{
    readonly input: unknown
    readonly name: VoilaOperationName
    readonly options: CliOperationOptions
  }>
  readonly keepaliveCalls: ReadonlyArray<CliKeepaliveOptions>
  readonly loginCalls: ReadonlyArray<CliLoginOptions>
  readonly ports: CliPorts
} => {
  const calls: Array<{
    readonly input: unknown
    readonly name: VoilaOperationName
    readonly options: CliOperationOptions
  }> = []
  const loginCalls: Array<CliLoginOptions> = []
  const keepaliveCalls: Array<CliKeepaliveOptions> = []

  return {
    calls,
    keepaliveCalls,
    loginCalls,
    ports: {
      keepalive: async (options) => {
        keepaliveCalls.push(options)

        return keepaliveReason
      },
      login: async (options) => {
        loginCalls.push(options)

        return result
      },
      runOperation: async (name, input, options) => {
        calls.push({ input, name, options })

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
    const result = await runCli(
      ["search", "milk", "--page-size", "3", "--page-token", "next", "--session", "/tmp/voila-session.json", "--json"],
      fake.ports
    )

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({ ok: true, value: { products: [] } })
    expect(fake.calls).toEqual([
      {
        input: { pageSize: 3, pageToken: "next", query: "milk" },
        name: "voila_search_products",
        options: { sessionPath: "/tmp/voila-session.json" }
      }
    ])
  })

  it("refuses a relative session path before reaching any port", async () => {
    const fake = makePorts(success({ products: [] }))
    const result = await runCli(["search", "milk", "--session", "relative/session.json"], fake.ports)

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain("--session must be an absolute path")
    // the path itself stays out of the message: it can name a user or a profile
    expect(result.stderr).not.toContain("relative/session.json")
    expect(fake.calls).toEqual([])
  })

  it("refuses a relative session path for login before launching a browser", async () => {
    const fake = makePorts(success({ products: [] }))
    const result = await runCli(["auth", "login", "--session", "relative/session.json"], fake.ports)

    expect(result.exitCode).toBe(2)
    expect(fake.loginCalls).toEqual([])
  })

  it("maps JSON discount commands to discounted product operation input", async () => {
    const fake = makePorts(success({ products: [] }))
    const result = await runCli(
      [
        "discounts",
        "milk",
        "--min-percent",
        "15",
        "--sort",
        "best-percent",
        "--page-size",
        "3",
        "--session",
        "/tmp/voila-session.json",
        "--json"
      ],
      fake.ports
    )

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({ ok: true, value: { products: [] } })
    expect(fake.calls).toEqual([
      {
        input: { minSavingsPercent: 15, pageSize: 3, query: "milk", sort: "best-percent" },
        name: "voila_get_discounted_products",
        options: { sessionPath: "/tmp/voila-session.json" }
      }
    ])
  })

  it("renders discounted products as a compact table", async () => {
    const fake = makePorts(
      success({
        products: [
          {
            discountPrice: { amount: "4.00", currency: "CAD" },
            name: "Discounted milk",
            promotionSummary: "Member price",
            regularPrice: { amount: "5.00", currency: "CAD" },
            savingsPercent: 20,
            savingsPrice: { amount: "1.00", currency: "CAD" }
          }
        ]
      })
    )
    const result = await runCli(["discounts", "milk"], fake.ports)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("Product\tNow\tWas\tSaved\tSave %\tPromo")
    expect(result.stdout).toContain("Discounted milk\t$4.00\t$5.00\t$1.00\t20.0%\tMember price")
  })

  it("returns usage errors for invalid discount numeric flags", async () => {
    for (const args of [
      ["discounts", "milk", "--min-percent"],
      ["discounts", "milk", "--min-amount", "-1"],
      ["discounts", "milk", "--min-percent", "not-a-number"],
      ["discounts", "milk", "--page-size", "25"]
    ]) {
      const fake = makePorts()
      const result = await runCli(args, fake.ports)

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain("Usage:")
      expect(fake.calls).toEqual([])
    }
  })

  it("maps cart add commands to cart item operation input", async () => {
    const fake = makePorts()
    const result = await runCli(
      ["cart", "add", "product-id", "--quantity", "2", "--session", "/tmp/cart-session.json"],
      fake.ports
    )

    expect(result.exitCode).toBe(0)
    expect(fake.calls).toEqual([
      {
        input: { items: [{ productId: "product-id", quantity: 2 }] },
        name: "voila_add_cart_items",
        options: { sessionPath: "/tmp/cart-session.json" }
      }
    ])
  })

  it("maps order list commands to completed order operation input", async () => {
    const fake = makePorts(success({ orders: [] }))
    const result = await runCli(
      ["orders", "list", "--page-size", "2", "--page-token", "next-orders", "--session", "/tmp/orders-session.json"],
      fake.ports
    )

    expect(result.exitCode).toBe(0)
    expect(fake.calls).toEqual([
      {
        input: { pageSize: 2, pageToken: "next-orders" },
        name: "voila_get_completed_orders",
        options: { sessionPath: "/tmp/orders-session.json" }
      }
    ])
  })

  it("maps order detail commands to order detail operation input", async () => {
    const fake = makePorts(success({ items: [] }))
    const result = await runCli(
      ["orders", "details", "sanitized-order-id-1", "--session", "/tmp/orders-session.json"],
      fake.ports
    )

    expect(result.exitCode).toBe(0)
    expect(fake.calls).toEqual([
      {
        input: { orderId: "sanitized-order-id-1" },
        name: "voila_get_order_details",
        options: { sessionPath: "/tmp/orders-session.json" }
      }
    ])
  })

  it("maps completed order item commands to aggregate operation input", async () => {
    const fake = makePorts(success({ items: [] }))
    const result = await runCli(
      [
        "orders",
        "items",
        "--from-date",
        "2026-06-01",
        "--to-date",
        "2026-06-30",
        "--page-size",
        "5",
        "--max-orders",
        "4",
        "--session",
        "/tmp/orders-session.json"
      ],
      fake.ports
    )

    expect(result.exitCode).toBe(0)
    expect(fake.calls).toEqual([
      {
        input: { fromDate: "2026-06-01", maxOrders: 4, pageSize: 5, toDate: "2026-06-30" },
        name: "voila_get_completed_order_items",
        options: { sessionPath: "/tmp/orders-session.json" }
      }
    ])
  })

  it("runs the keepalive loop and reports a clean stop", async () => {
    const fake = makePorts(success({ status: "ok" }), "cancelled")
    const result = await runCli(
      ["auth", "keepalive", "--session", "/tmp/session.json", "--interval", "3600"],
      fake.ports
    )

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe("Keepalive stopped.\n")
    expect(fake.keepaliveCalls).toEqual([{ intervalSeconds: 3600, sessionPath: "/tmp/session.json" }])
  })

  it("defaults the keepalive interval and session path when omitted", async () => {
    const fake = makePorts()
    const result = await runCli(["auth", "keepalive"], fake.ports)

    expect(result.exitCode).toBe(0)
    expect(fake.keepaliveCalls).toHaveLength(1)
    expect(fake.keepaliveCalls[0]?.intervalSeconds).toBeUndefined()
    expect(fake.keepaliveCalls[0]?.sessionPath).toContain("session.json")
  })

  it("reports a non-zero exit when the keepalive loop detects expiry", async () => {
    const fake = makePorts(success({ status: "ok" }), "expired")
    const result = await runCli(["auth", "keepalive", "--session", "/tmp/session.json"], fake.ports)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("Session requires re-authentication")
    expect(result.stdout).toBe("")
  })

  it("rejects a non-positive keepalive interval before starting the loop", async () => {
    const fake = makePorts()
    const result = await runCli(["auth", "keepalive", "--interval", "0"], fake.ports)

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain("Usage:")
    expect(fake.keepaliveCalls).toEqual([])
  })

  it("rejects a keepalive interval below the 1-hour floor", async () => {
    const fake = makePorts()
    const result = await runCli(["auth", "keepalive", "--interval", "3599"], fake.ports)

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain("at least 3600")
    expect(fake.keepaliveCalls).toEqual([])
  })

  it("passes auth login defaults and overrides to the login port", async () => {
    const fake = makePorts(success({ status: "active" }))
    const result = await runCli(
      ["auth", "login", "--session", "/tmp/auth.json", "--profile", "/tmp/profile", "--timeout-ms", "10"],
      fake.ports
    )

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe("Authenticated session saved.\n")
    expect(fake.loginCalls).toEqual([{ profilePath: "/tmp/profile", sessionPath: "/tmp/auth.json", timeoutMs: 10 }])
  })

  it("returns typed operation failures on stderr", async () => {
    const fake = makePorts(failure("VoilaUnauthorizedSession"))
    const result = await runCli(["cart", "get", "--session", "/tmp/session.json"], fake.ports)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe("VoilaUnauthorizedSession: failed\n")
    expect(result.stdout).toBe("")
  })

  it("renders auth guidance for text failures", async () => {
    const fake = makePorts(authGuidanceFailure())
    const result = await runCli(["orders", "list", "--session", "/tmp/session.json"], fake.ports)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("CompletedOrdersGraphqlError")
    expect(result.stderr).toContain("Voila account session is required.")
    expect(result.stderr).toContain("Login command: npx -y @firfi/voila-cli auth login --session /tmp/session.json")
    expect(result.stdout).toBe("")
  })

  it("renders complete typed failures in JSON mode", async () => {
    const fake = makePorts(authGuidanceFailure())
    const result = await runCli(["orders", "list", "--session", "/tmp/session.json", "--json"], fake.ports)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe("")
    expect(JSON.parse(result.stdout)).toMatchObject({
      error: {
        _tag: "CompletedOrdersGraphqlError",
        authGuidance: { command: "npx -y @firfi/voila-cli auth login --session /tmp/session.json" }
      },
      ok: false
    })
  })
})
