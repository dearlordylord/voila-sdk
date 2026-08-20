import type { KeepaliveStopReason } from "@firfi/voila-sdk"
import type { OperationExecutionResult, VoilaOperationName } from "@firfi/voila-mcp"
import { describe, expect, it } from "vitest"

import {
  type CliKeepaliveOptions,
  type CliLoginOptions,
  type CliOperationOptions,
  type CliPorts,
  type CliRunResult,
  runCli
} from "../src/cli.js"
import { fail, parseArgs, renderKeepalive } from "../src/cli-model.js"

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

const stdoutOf = (result: CliRunResult): string =>
  result._tag === "success" || result._tag === "json-failure" ? result.stdout : ""

const stderrOf = (result: CliRunResult): string =>
  result._tag === "usage" || result._tag === "text-failure" ? result.stderr : ""

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
  readonly loginCalls: ReadonlyArray<Omit<CliLoginOptions, "delay" | "progress">>
  readonly stderr: ReadonlyArray<string>
  readonly ports: CliPorts
} => {
  const calls: Array<{
    readonly input: unknown
    readonly name: VoilaOperationName
    readonly options: CliOperationOptions
  }> = []
  const loginCalls: Array<Omit<CliLoginOptions, "delay" | "progress">> = []
  const keepaliveCalls: Array<CliKeepaliveOptions> = []
  const stderr: Array<string> = []

  return {
    calls,
    keepaliveCalls,
    loginCalls,
    stderr,
    ports: {
      delay: async () => undefined,
      keepalive: async (options) => {
        keepaliveCalls.push(options)

        return keepaliveReason
      },
      login: async ({ delay: _delay, progress, ...options }) => {
        loginCalls.push(options)
        progress.write("login progress\n")

        return result
      },
      runOperation: async (name, input, options) => {
        calls.push({ input, name, options })

        return result
      },
      writeStderr: (message) => stderr.push(message)
    }
  }
}

describe("Voila CLI", () => {
  it("renders help without invoking ports", async () => {
    const fake = makePorts()
    const result = await runCli(["--help"], fake.ports)

    expect(result.exitCode).toBe(0)
    expect(stdoutOf(result)).toContain("voila auth login")
    expect(fake.calls).toEqual([])
    expect(fake.loginCalls).toEqual([])
  })

  it("resolves group help before subcommand and arity validation", async () => {
    const cases = [
      ["auth", "--help", "extra"],
      ["cart", "--help", "extra"],
      ["search", "--help"],
      ["orders", "--help", "extra"]
    ]

    for (const args of cases) {
      const result = await runCli(args, makePorts().ports)

      expect(result.exitCode).toBe(0)
      expect(stdoutOf(result)).toContain("Usage:")
      expect(stderrOf(result)).toBe("")
    }
  })

  it("uses explicit session paths for JSON search commands", async () => {
    const fake = makePorts(success({ products: [] }))
    const result = await runCli(
      ["search", "milk", "--page-size", "3", "--page-token", "next", "--session", "/tmp/voila-session.json", "--json"],
      fake.ports
    )

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(stdoutOf(result))).toEqual({ ok: true, value: { products: [] } })
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
    expect(stderrOf(result)).toContain("--session must be an absolute path")
    // the path itself stays out of the message: it can name a user or a profile
    expect(stderrOf(result)).not.toContain("relative/session.json")
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
    expect(JSON.parse(stdoutOf(result))).toEqual({ ok: true, value: { products: [] } })
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
    expect(stdoutOf(result)).toContain("Product\tNow\tWas\tSaved\tSave %\tPromo")
    expect(stdoutOf(result)).toContain("Discounted milk\t$4.00\t$5.00\t$1.00\t20.0%\tMember price")
  })

  it("maps sparse discount options and renders sparse product rows safely", async () => {
    const fake = makePorts(
      success({
        products: [
          {
            discountPrice: { amount: "4.00" },
            name: "Sparse product",
            promotionSummary: 123,
            regularPrice: {},
            savingsPercent: Number.NaN,
            savingsPrice: "not-money"
          },
          "not-a-product"
        ]
      })
    )
    const result = await runCli(
      ["discounts", "--min-amount", "0.50", "--page-token", "next", "--session", "/tmp/discounts.json"],
      fake.ports
    )

    expect(result.exitCode).toBe(0)
    expect(fake.calls[0]?.input).toEqual({ minSavingsAmount: 0.5, pageToken: "next" })
    expect(stdoutOf(result)).toContain("Sparse product\t$4.00\t\t\t\t")
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
      expect(stderrOf(result)).toContain("Usage:")
      expect(fake.calls).toEqual([])
    }
  })

  it("rejects route-specific numeric bounds before reaching a port", async () => {
    for (const args of [
      ["search", "milk", "--page-size", "25"],
      ["orders", "list", "--page-size", "51"],
      ["orders", "items", "--max-orders", "51"],
      ["cart", "add", "00000000-0000-4000-8000-000000000001", "--quantity", "0"]
    ]) {
      const fake = makePorts()
      const result = await runCli(args, fake.ports)

      expect(result.exitCode).toBe(2)
      expect(stderrOf(result)).toContain("Usage:")
      expect(fake.calls).toEqual([])
    }
  })

  it("rejects route-illegal flags and extra positionals at the argv boundary", async () => {
    for (const args of [
      ["auth", "keepalive", "--json"],
      ["search", "milk", "extra"],
      ["search", "milk", "--quantity", "1"]
    ]) {
      const fake = makePorts()
      const result = await runCli(args, fake.ports)

      expect(result.exitCode).toBe(2)
      expect(stderrOf(result)).toContain("Usage:")
      expect(fake.calls).toEqual([])
      expect(fake.keepaliveCalls).toEqual([])
      expect(fake.loginCalls).toEqual([])
    }
  })

  it("maps cart add commands to cart item operation input", async () => {
    const fake = makePorts()
    const result = await runCli(
      ["cart", "add", "00000000-0000-4000-8000-000000000001", "--quantity", "2", "--session", "/tmp/cart-session.json"],
      fake.ports
    )

    expect(result.exitCode).toBe(0)
    expect(fake.calls).toEqual([
      {
        input: { items: [{ productId: "00000000-0000-4000-8000-000000000001", quantity: 2 }] },
        name: "voila_add_cart_items",
        options: { sessionPath: "/tmp/cart-session.json" }
      }
    ])
  })

  it("maps cart remove commands to cart item operation input", async () => {
    const fake = makePorts()
    const result = await runCli(
      [
        "cart",
        "remove",
        "00000000-0000-4000-8000-000000000001",
        "--quantity",
        "2",
        "--session",
        "/tmp/cart-session.json"
      ],
      fake.ports
    )

    expect(result.exitCode).toBe(0)
    expect(fake.calls).toEqual([
      {
        input: { items: [{ productId: "00000000-0000-4000-8000-000000000001", quantity: 2 }] },
        name: "voila_remove_cart_items",
        options: { sessionPath: "/tmp/cart-session.json" }
      }
    ])
  })

  it("maps category products and auth status commands to their operations", async () => {
    const category = makePorts(success({ products: [] }))
    const categoryResult = await runCli(
      ["category", "products", "produce", "--page-size", "4", "--page-token", "next", "--json"],
      category.ports
    )
    const auth = makePorts(success({ status: "active" }))
    const authResult = await runCli(["auth", "status", "--json"], auth.ports)

    expect(categoryResult.exitCode).toBe(0)
    expect(category.calls).toEqual([
      {
        input: { categoryId: "produce", pageSize: 4, pageToken: "next" },
        name: "voila_get_category_products",
        options: { sessionPath: expect.stringContaining("session.json") }
      }
    ])
    expect(authResult.exitCode).toBe(0)
    expect(auth.calls).toEqual([
      {
        input: {},
        name: "voila_check_session_health",
        options: { sessionPath: expect.stringContaining("session.json") }
      }
    ])
  })

  it("omits optional pagination and date fields when routes do not receive them", async () => {
    const search = makePorts()
    await runCli(["search", "milk", "--session", "/tmp/search.json"], search.ports)
    const category = makePorts()
    await runCli(["category", "products", "produce", "--session", "/tmp/category.json"], category.ports)
    const orders = makePorts()
    await runCli(["orders", "list", "--session", "/tmp/orders.json"], orders.ports)
    const items = makePorts()
    await runCli(["orders", "items", "--session", "/tmp/items.json"], items.ports)

    expect(search.calls[0]?.input).toEqual({ query: "milk" })
    expect(category.calls[0]?.input).toEqual({ categoryId: "produce" })
    expect(orders.calls[0]?.input).toEqual({})
    expect(items.calls[0]?.input).toEqual({})
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
    expect(stdoutOf(result)).toBe("Keepalive stopped.\n")
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
    expect(stderrOf(result)).toContain("Session requires re-authentication")
  })

  it("rejects a non-positive keepalive interval before starting the loop", async () => {
    const fake = makePorts()
    const result = await runCli(["auth", "keepalive", "--interval", "0"], fake.ports)

    expect(result.exitCode).toBe(2)
    expect(stderrOf(result)).toContain("Usage:")
    expect(fake.keepaliveCalls).toEqual([])
  })

  it("rejects a keepalive interval below the 1-hour floor", async () => {
    const fake = makePorts()
    const result = await runCli(["auth", "keepalive", "--interval", "3599"], fake.ports)

    expect(result.exitCode).toBe(2)
    expect(stderrOf(result)).toContain("at least 3600")
    expect(fake.keepaliveCalls).toEqual([])
  })

  it("rejects negative and fractional keepalive intervals at the argv boundary", async () => {
    for (const interval of ["-1", "3600.5"]) {
      const fake = makePorts()
      const result = await runCli(["auth", "keepalive", "--interval", interval], fake.ports)

      expect(result.exitCode).toBe(2)
      expect(stderrOf(result)).toContain("whole number")
      expect(fake.keepaliveCalls).toEqual([])
    }
  })

  it("passes auth login defaults and overrides to the login port", async () => {
    const fake = makePorts(success({ status: "active" }))
    const result = await runCli(
      ["auth", "login", "--session", "/tmp/auth.json", "--profile", "/tmp/profile", "--timeout-ms", "10"],
      fake.ports
    )

    expect(result.exitCode).toBe(0)
    expect(stdoutOf(result)).toBe("Authenticated session saved.\n")
    expect(fake.loginCalls).toEqual([{ profilePath: "/tmp/profile", sessionPath: "/tmp/auth.json", timeoutMs: 10 }])
    expect(fake.stderr).toEqual(["login progress\n"])
  })

  it("keeps auth login JSON on stdout while progress uses injected stderr", async () => {
    const fake = makePorts(success({ status: "active" }))
    const result = await runCli(["auth", "login", "--session", "/tmp/auth.json", "--json"], fake.ports)

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(stdoutOf(result))).toEqual({ ok: true, value: { status: "active" } })
    expect(fake.stderr).toEqual(["login progress\n"])
  })

  it("returns typed operation failures on stderr", async () => {
    const fake = makePorts(failure("VoilaUnauthorizedSession"))
    const result = await runCli(["cart", "get", "--session", "/tmp/session.json"], fake.ports)

    expect(result.exitCode).toBe(1)
    expect(stderrOf(result)).toBe("VoilaUnauthorizedSession: failed\n")
  })

  it("renders auth guidance for text failures", async () => {
    const fake = makePorts(authGuidanceFailure())
    const result = await runCli(["orders", "list", "--session", "/tmp/session.json"], fake.ports)

    expect(result.exitCode).toBe(1)
    expect(stderrOf(result)).toContain("CompletedOrdersGraphqlError")
    expect(stderrOf(result)).toContain("Voila account session is required.")
    expect(stderrOf(result)).toContain("Login command: npx -y @firfi/voila-cli auth login --session /tmp/session.json")
  })

  it("renders complete typed failures in JSON mode", async () => {
    const fake = makePorts(authGuidanceFailure())
    const result = await runCli(["orders", "list", "--session", "/tmp/session.json", "--json"], fake.ports)

    expect(result.exitCode).toBe(1)
    expect(stdoutOf(result)).toBeTruthy()
    expect(JSON.parse(stdoutOf(result))).toMatchObject({
      error: {
        _tag: "CompletedOrdersGraphqlError",
        authGuidance: { command: "npx -y @firfi/voila-cli auth login --session /tmp/session.json" }
      },
      ok: false
    })
  })

  it("rejects a keepalive interval flag without a value", async () => {
    const fake = makePorts()
    const result = await runCli(["auth", "keepalive", "--interval"], fake.ports)

    expect(result.exitCode).toBe(2)
    expect(stderrOf(result)).toContain("Missing --interval")
    expect(fake.keepaliveCalls).toEqual([])
  })

  it("rejects unknown auth flags and extra auth positionals", async () => {
    const fake = makePorts()
    const unknownFlag = await runCli(["auth", "status", "--interval", "3600"], fake.ports)
    const extraPositional = await runCli(["auth", "status", "unexpected"], fake.ports)

    expect(unknownFlag.exitCode).toBe(2)
    expect(stderrOf(unknownFlag)).toContain("not valid for auth status")
    expect(extraPositional.exitCode).toBe(2)
    expect(stderrOf(extraPositional)).toContain("does not accept positional arguments")
    expect(fake.calls).toEqual([])
  })

  it("rejects unknown commands, subcommands, and duplicate argv options", async () => {
    const fake = makePorts()
    const invalidArgs = [
      ["unknown"],
      ["auth", "unknown"],
      ["cart", "unknown"],
      ["category", "unknown", "id"],
      ["orders", "unknown"],
      ["search"],
      ["category", "products"],
      ["orders", "details"],
      ["cart", "add"],
      ["search", "milk", "--not-an-option"],
      ["search", "milk", "--json", "--json"],
      ["search", "milk", "--page-size", "2", "--page-size", "3"]
    ]

    for (const args of invalidArgs) {
      const result = await runCli(args, fake.ports)

      expect(result.exitCode).toBe(2)
      expect(stderrOf(result)).toContain("Usage:")
    }

    expect(fake.calls).toEqual([])
  })

  it("handles command help and keepalive misconfiguration at the result boundary", async () => {
    const fake = makePorts(success({ status: "ok" }), "misconfigured")
    const commandHelp = await runCli(["search", "milk", "--help"], fake.ports)
    const keepalive = await runCli(["auth", "keepalive"], fake.ports)

    expect(commandHelp.exitCode).toBe(0)
    expect(stdoutOf(commandHelp)).toContain("voila search")
    expect(keepalive.exitCode).toBe(2)
    expect(stderrOf(keepalive)).toContain("No authenticated session snapshot is configured")
  })

  it("couples output channel and exit semantics in the result tag", async () => {
    const fake = makePorts(failure("VoilaUnauthorizedSession"))
    const text = await runCli(["cart", "get", "--session", "/tmp/session.json"], fake.ports)
    const json = await runCli(["cart", "get", "--session", "/tmp/session.json", "--json"], fake.ports)

    expect(text._tag).toBe("text-failure")
    expect(json._tag).toBe("json-failure")
    expect(stderrOf(json)).toBe("")
    expect(stdoutOf(text)).toBe("")
  })

  it("renders defensive discount fallbacks and guards successful results passed to failure rendering", async () => {
    const primitive = makePorts(success("unexpected discounted response"))
    const primitiveResult = await runCli(["discounts"], primitive.ports)
    const object = makePorts(success({ status: "unexpected discounted response" }))
    const objectResult = await runCli(["discounts"], object.ports)

    expect(primitiveResult.exitCode).toBe(0)
    expect(stdoutOf(primitiveResult)).toBe("")
    expect(objectResult.exitCode).toBe(0)
    expect(stdoutOf(objectResult)).toContain('"status": "unexpected discounted response"')

    expect(fail(success({ status: "ok" }), false)).toEqual({ _tag: "text-failure", exitCode: 1, stderr: "" })
    expect(parseArgs(["search", "milk", "--page-size"])).toMatchObject({ _tag: "usage", exitCode: 2 })
    expect(renderKeepalive("misconfigured")).toMatchObject({ _tag: "usage", exitCode: 2 })
  })
})
