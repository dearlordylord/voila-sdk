import { readFileSync } from "node:fs"

import { Either } from "effect"
import { describe, expect, it } from "vitest"

import { parseJson } from "../../src/domain/parse.js"
import {
  CheckoutReadinessDecisionSchema,
  decideCheckoutReadiness,
  parseCheckoutSummaryResponse
} from "../../src/index.js"
import { assertDecodeSuccess, assertEncodeSuccess } from "../helpers/property.js"

const blockedFixtureText = readFileSync(
  new URL("../fixtures/checkout-summary-blocked.json", import.meta.url),
  "utf8"
)
const unavailableFixtureText = readFileSync(
  new URL("../fixtures/checkout-summary-unavailable-item.json", import.meta.url),
  "utf8"
)
const readyFixtureText = readFileSync(
  new URL("../fixtures/checkout-summary-ready.json", import.meta.url),
  "utf8"
)

const readSummaryFixture = (fixtureText: string) => {
  const parsedJson = parseJson(fixtureText)

  if (Either.isLeft(parsedJson)) {
    throw new Error("Expected fixture JSON to parse")
  }

  const parsedSummary = parseCheckoutSummaryResponse(parsedJson.right)

  if (Either.isLeft(parsedSummary)) {
    throw new Error("Expected checkout summary fixture to parse")
  }

  return parsedSummary.right
}

describe("checkout readiness decisions", () => {
  it("classifies blocked checkout summaries and preserves restrictions", () => {
    const summary = readSummaryFixture(blockedFixtureText)
    const decision = decideCheckoutReadiness(summary)

    expect(decision).toEqual({
      canContinueToManualCheckout: false,
      checkoutRestrictions: summary.checkoutRestrictions,
      reason: "checkout-blocked",
      status: "blocked",
      warnings: summary.warnings
    })
    expect(decision.checkoutRestrictions[0]?.code).toBe("EMPTY_CART")
    expect(decision.warnings[0]?.kind).toBe("checkout-restriction")
  })

  it("classifies warning-bearing summaries as needing review without dropping warning signals", () => {
    const summary = {
      ...readSummaryFixture(unavailableFixtureText),
      canCheckout: true,
      checkoutRestrictions: []
    }
    const decision = decideCheckoutReadiness(summary)

    expect(decision.status).toBe("needs-review")
    expect(decision.reason).toBe("review-signals-present")
    expect(decision.canContinueToManualCheckout).toBe(false)
    expect(decision.checkoutRestrictions).toEqual([])
    expect(decision.warnings).toEqual(summary.warnings)
    expect(decision.warnings.map((warning) => warning.kind)).toEqual([
      "checkout-restriction",
      "limited-item",
      "pricing-notification",
      "substitution",
      "unavailable-item"
    ])
  })

  it("classifies clean checkout summaries as ready for manual checkout only", () => {
    const summary = readSummaryFixture(readyFixtureText)
    const decision = decideCheckoutReadiness(summary)

    expect(decision).toEqual({
      canContinueToManualCheckout: true,
      checkoutRestrictions: [],
      reason: "ready-for-manual-checkout",
      status: "ready-for-manual-checkout",
      warnings: []
    })
    expect(JSON.stringify(decision)).not.toContain("place")
    expect(JSON.stringify(decision)).not.toContain("order")
  })

  it("keeps readiness decisions under the public schema", () => {
    const decision = decideCheckoutReadiness(readSummaryFixture(readyFixtureText))
    const decoded = assertDecodeSuccess(CheckoutReadinessDecisionSchema, decision)

    expect(assertEncodeSuccess(CheckoutReadinessDecisionSchema, decoded)).toEqual(decision)
  })
})
