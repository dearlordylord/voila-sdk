import { Result } from "effect"

import type { NormalizedCartView, NormalizedSearchProduct } from "../../src/index.js"
import { addCartItems, bootstrapGuestSession, getCart, removeCartItems, searchProducts } from "../../src/index.js"
import { runLive } from "./live-transport.js"

const enabledValue = "1"
const liveSmokeFlag = "VOILA_LIVE_SMOKE"
const harmlessQuery = "milk"
const pageSize = 24
const successStatus = 0
const failureStatus = 1
const productUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type LiveCartSmokeFailure =
  | { readonly _tag: "LiveCartSmokeBootstrapFailed"; readonly causeTag: string }
  | { readonly _tag: "LiveCartSmokeSearchFailed"; readonly causeTag: string }
  | { readonly _tag: "LiveCartSmokeNoAvailableProduct" }
  | { readonly _tag: "LiveCartSmokeAddFailed"; readonly causeTag: string }
  | { readonly _tag: "LiveCartSmokeReadFailed"; readonly causeTag: string }
  | { readonly _tag: "LiveCartSmokeCleanupFailed"; readonly causeTag: string }
  | { readonly _tag: "LiveCartSmokeVerificationFailed" }

const toCauseTag = (error: { readonly _tag: string }): string => error._tag

const isCartProductCandidate = (product: NormalizedSearchProduct): boolean =>
  product.available && productUuidPattern.test(product.productId)

const cartQuantityForProduct = (cart: NormalizedCartView, productId: string): number =>
  cart.items.filter((item) => item.productId === productId).reduce((total, item) => total + item.quantity, 0)

const runSmoke = async (): Promise<Result.Result<string, LiveCartSmokeFailure>> => {
  const bootstrap = await runLive(bootstrapGuestSession())

  if (Result.isFailure(bootstrap)) {
    return Result.fail({ _tag: "LiveCartSmokeBootstrapFailed", causeTag: toCauseTag(bootstrap.failure) })
  }

  const search = await runLive(searchProducts(bootstrap.success.session, { pageSize, query: harmlessQuery }))

  if (Result.isFailure(search)) {
    return Result.fail({ _tag: "LiveCartSmokeSearchFailed", causeTag: toCauseTag(search.failure) })
  }

  const product = search.success.value.products.find(isCartProductCandidate)

  if (product === undefined) {
    return Result.fail({ _tag: "LiveCartSmokeNoAvailableProduct" })
  }

  const add = await runLive(addCartItems(search.success.session, [{ productId: product.productId, quantity: 1 }]))

  if (Result.isFailure(add)) {
    return Result.fail({ _tag: "LiveCartSmokeAddFailed", causeTag: toCauseTag(add.failure) })
  }

  const read = await runLive(getCart(add.success.session))

  if (Result.isFailure(read)) {
    const cleanupAfterReadFailure = await runLive(
      removeCartItems(add.success.session, [{ productId: product.productId, quantity: 1 }])
    )

    if (Result.isFailure(cleanupAfterReadFailure)) {
      return Result.fail({ _tag: "LiveCartSmokeCleanupFailed", causeTag: toCauseTag(cleanupAfterReadFailure.failure) })
    }

    return Result.fail({ _tag: "LiveCartSmokeReadFailed", causeTag: toCauseTag(read.failure) })
  }

  if (
    cartQuantityForProduct(read.success.value, product.productId) < 1 ||
    read.success.value.totals.itemPriceAfterPromos.amount.length === 0
  ) {
    const cleanupAfterVerificationFailure = await runLive(
      removeCartItems(read.success.session, [{ productId: product.productId, quantity: 1 }])
    )

    if (Result.isFailure(cleanupAfterVerificationFailure)) {
      return Result.fail({
        _tag: "LiveCartSmokeCleanupFailed",
        causeTag: toCauseTag(cleanupAfterVerificationFailure.failure)
      })
    }

    return Result.fail({ _tag: "LiveCartSmokeVerificationFailed" })
  }

  const cleanup = await runLive(removeCartItems(read.success.session, [{ productId: product.productId, quantity: 1 }]))

  if (Result.isFailure(cleanup)) {
    return Result.fail({ _tag: "LiveCartSmokeCleanupFailed", causeTag: toCauseTag(cleanup.failure) })
  }

  const cleanedCart = await runLive(getCart(cleanup.success.session))

  if (Result.isFailure(cleanedCart)) {
    return Result.fail({ _tag: "LiveCartSmokeReadFailed", causeTag: toCauseTag(cleanedCart.failure) })
  }

  if (cartQuantityForProduct(cleanedCart.success.value, product.productId) > 0) {
    return Result.fail({ _tag: "LiveCartSmokeVerificationFailed" })
  }

  return Result.succeed(product.name)
}

if (process.env[liveSmokeFlag] !== enabledValue) {
  process.stdout.write(`${liveSmokeFlag}=1 is required; skipping live cart smoke test.\n`)
  process.exit(successStatus)
} else {
  const result = await runSmoke()

  if (Result.isSuccess(result)) {
    process.stdout.write(`Live cart smoke passed for product "${result.success}".\n`)
    process.exit(successStatus)
  } else {
    process.stderr.write(`Live cart smoke returned typed failure: ${JSON.stringify(result.failure)}\n`)
    process.exit(failureStatus)
  }
}
