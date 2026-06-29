import { Either } from "effect"

import { parseUnknown } from "../domain/parse.js"
import { CheckoutSummaryInputSchema } from "../domain/schemas/index.js"
import { VOILA_BASE_URL } from "./urls.js"

const CHECKOUT_SUMMARY_PATH = "/api/cart/v1/carts/active/checkout-summary"

export interface CheckoutSummaryRequest {
  readonly method: "GET"
  readonly url: URL
}

export type CheckoutSummaryRequestError = {
  readonly _tag: "CheckoutSummaryInputInvalid"
  readonly message: string
}

const checkoutSummaryInputInvalid = (): CheckoutSummaryRequestError => ({
  _tag: "CheckoutSummaryInputInvalid",
  message: "Checkout summary request input does not match the SDK schema"
})

export const makeCheckoutSummaryRequest = (
  input: unknown = {}
): Either.Either<CheckoutSummaryRequest, CheckoutSummaryRequestError> =>
  Either.map(
    Either.mapLeft(parseUnknown(CheckoutSummaryInputSchema, input), checkoutSummaryInputInvalid),
    (summaryInput) => {
      const url = new URL(CHECKOUT_SUMMARY_PATH, VOILA_BASE_URL)

      if (summaryInput.fetchAllocatedPaymentChecks === true) {
        url.searchParams.set("fetchAllocatedPaymentChecks", "true")
      }

      if (summaryInput.appliedPaymentCheckId !== undefined) {
        url.searchParams.set("paymentCheckId", summaryInput.appliedPaymentCheckId)
      }

      return {
        method: "GET",
        url
      }
    }
  )
