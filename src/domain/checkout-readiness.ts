import type {
  CheckoutReadinessDecision,
  CheckoutReadinessReason,
  CheckoutReadinessStatus,
  NormalizedCheckoutSummary
} from "./schemas/index.js"

const emptyCount = 0

const makeDecision = (
  summary: NormalizedCheckoutSummary,
  status: CheckoutReadinessStatus,
  reason: CheckoutReadinessReason,
  canContinueToManualCheckout: boolean
): CheckoutReadinessDecision => ({
  canContinueToManualCheckout,
  checkoutRestrictions: summary.checkoutRestrictions,
  reason,
  status,
  warnings: summary.warnings
})

export const decideCheckoutReadiness = (
  summary: NormalizedCheckoutSummary
): CheckoutReadinessDecision => {
  if (!summary.canCheckout || summary.checkoutRestrictions.length > emptyCount) {
    return makeDecision(summary, "blocked", "checkout-blocked", false)
  }

  if (summary.warnings.length > emptyCount) {
    return makeDecision(summary, "needs-review", "review-signals-present", false)
  }

  return makeDecision(summary, "ready-for-manual-checkout", "ready-for-manual-checkout", true)
}
