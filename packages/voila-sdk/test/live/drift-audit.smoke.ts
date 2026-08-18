import { Result } from "effect"

import { bootstrapGuestSession, getCart, searchProducts } from "../../src/index.js"
import { runLive } from "./live-transport.js"

const driftAuditFlag = "VOILA_DRIFT_AUDIT"
const enabledValue = "1"
const harmlessQuery = "milk"
const pageSize = 24
const successStatus = 0
const failureStatus = 1

type DriftAuditOperation = "guest-bootstrap" | "catalog-search" | "cart-read"

type EndpointDriftAuditFailure =
  | {
      readonly _tag: "EndpointDriftAuditOperationFailed"
      readonly causeTag: string
      readonly operation: DriftAuditOperation
    }
  | { readonly _tag: "EndpointDriftAuditNoProducts"; readonly operation: "catalog-search" }

interface EndpointDriftAuditSuccess {
  readonly cartItemCount: number
  readonly productCount: number
}

const toCauseTag = (error: { readonly _tag: string }): string => error._tag

const operationFailed = (operation: DriftAuditOperation, causeTag: string): EndpointDriftAuditFailure => ({
  _tag: "EndpointDriftAuditOperationFailed",
  causeTag,
  operation
})

const runAudit = async (): Promise<Result.Result<EndpointDriftAuditSuccess, EndpointDriftAuditFailure>> => {
  const bootstrap = await runLive(bootstrapGuestSession())

  if (Result.isFailure(bootstrap)) {
    return Result.fail(operationFailed("guest-bootstrap", toCauseTag(bootstrap.failure)))
  }

  const search = await runLive(searchProducts(bootstrap.success.session, { pageSize, query: harmlessQuery }))

  if (Result.isFailure(search)) {
    return Result.fail(operationFailed("catalog-search", toCauseTag(search.failure)))
  }

  if (search.success.value.products.length === 0) {
    return Result.fail({ _tag: "EndpointDriftAuditNoProducts", operation: "catalog-search" })
  }

  const cart = await runLive(getCart(search.success.session))

  if (Result.isFailure(cart)) {
    return Result.fail(operationFailed("cart-read", toCauseTag(cart.failure)))
  }

  return Result.succeed({
    cartItemCount: cart.success.value.itemCount,
    productCount: search.success.value.products.length
  })
}

if (process.env[driftAuditFlag] !== enabledValue) {
  process.stdout.write(`${driftAuditFlag}=1 is required; skipping endpoint drift audit.\n`)
  process.exit(successStatus)
} else {
  const result = await runAudit()

  if (Result.isSuccess(result)) {
    process.stdout.write(
      `Endpoint drift audit passed with ${String(result.success.productCount)} products and ${String(
        result.success.cartItemCount
      )} cart items.\n`
    )
    process.exit(successStatus)
  } else {
    process.stderr.write(`Endpoint drift audit returned typed failure: ${JSON.stringify(result.failure)}\n`)
    process.exit(failureStatus)
  }
}
