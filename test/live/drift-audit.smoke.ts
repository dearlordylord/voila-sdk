import { Either } from "effect"

import type { ResponseHeaders, VoilaTransport, VoilaTransportRequest, VoilaTransportResponse } from "../../src/index.js"
import { bootstrapGuestSession, getCart, searchProducts } from "../../src/index.js"

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
  | {
    readonly _tag: "EndpointDriftAuditNoProducts"
    readonly operation: "catalog-search"
  }

interface EndpointDriftAuditSuccess {
  readonly cartItemCount: number
  readonly productCount: number
}

const responseHeadersFromFetch = (headers: Headers): ResponseHeaders => {
  const setCookie = headers.getSetCookie()
  const headerEntries = Object.fromEntries(headers.entries())

  return setCookie.length === 0
    ? headerEntries
    : {
      ...headerEntries,
      "set-cookie": setCookie
    }
}

const fetchTransport: VoilaTransport = {
  request: async (request: VoilaTransportRequest) => {
    const requestInitBase = {
      headers: request.headers,
      method: request.method,
      redirect: "manual"
    } satisfies RequestInit
    const requestInit = request.body === undefined
      ? requestInitBase
      : {
        ...requestInitBase,
        body: request.body
      }
    const response = await fetch(request.url, requestInit)

    return Either.right(
      {
        body: await response.text(),
        headers: responseHeadersFromFetch(response.headers),
        status: response.status
      } satisfies VoilaTransportResponse
    )
  }
}

const toCauseTag = (error: { readonly _tag: string }): string => error._tag

const operationFailed = (
  operation: DriftAuditOperation,
  causeTag: string
): EndpointDriftAuditFailure => ({
  _tag: "EndpointDriftAuditOperationFailed",
  causeTag,
  operation
})

const runAudit = async (): Promise<Either.Either<EndpointDriftAuditSuccess, EndpointDriftAuditFailure>> => {
  const bootstrap = await bootstrapGuestSession(fetchTransport)

  if (Either.isLeft(bootstrap)) {
    return Either.left(operationFailed("guest-bootstrap", toCauseTag(bootstrap.left)))
  }

  const search = await searchProducts(bootstrap.right.session, {
    pageSize,
    query: harmlessQuery
  }, fetchTransport)

  if (Either.isLeft(search)) {
    return Either.left(operationFailed("catalog-search", toCauseTag(search.left)))
  }

  if (search.right.value.products.length === 0) {
    return Either.left({
      _tag: "EndpointDriftAuditNoProducts",
      operation: "catalog-search"
    })
  }

  const cart = await getCart(search.right.session, fetchTransport)

  if (Either.isLeft(cart)) {
    return Either.left(operationFailed("cart-read", toCauseTag(cart.left)))
  }

  return Either.right({
    cartItemCount: cart.right.value.itemCount,
    productCount: search.right.value.products.length
  })
}

if (process.env[driftAuditFlag] !== enabledValue) {
  process.stdout.write(`${driftAuditFlag}=1 is required; skipping endpoint drift audit.\n`)
  process.exit(successStatus)
} else {
  const result = await runAudit()

  if (Either.isRight(result)) {
    process.stdout.write(
      `Endpoint drift audit passed with ${String(result.right.productCount)} products and ${
        String(result.right.cartItemCount)
      } cart items.\n`
    )
    process.exit(successStatus)
  } else {
    process.stderr.write(`Endpoint drift audit returned typed failure: ${JSON.stringify(result.left)}\n`)
    process.exit(failureStatus)
  }
}
