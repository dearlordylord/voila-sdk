import { Either } from "effect"

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

const runSmoke = async (): Promise<Either.Either<string, LiveCartSmokeFailure>> => {
  const bootstrap = await runLive(bootstrapGuestSession())

  if (Either.isLeft(bootstrap)) {
    return Either.left({ _tag: "LiveCartSmokeBootstrapFailed", causeTag: toCauseTag(bootstrap.left) })
  }

  const search = await runLive(searchProducts(bootstrap.right.session, { pageSize, query: harmlessQuery }))

  if (Either.isLeft(search)) {
    return Either.left({ _tag: "LiveCartSmokeSearchFailed", causeTag: toCauseTag(search.left) })
  }

  const product = search.right.value.products.find(isCartProductCandidate)

  if (product === undefined) {
    return Either.left({ _tag: "LiveCartSmokeNoAvailableProduct" })
  }

  const add = await runLive(addCartItems(search.right.session, [{ productId: product.productId, quantity: 1 }]))

  if (Either.isLeft(add)) {
    return Either.left({ _tag: "LiveCartSmokeAddFailed", causeTag: toCauseTag(add.left) })
  }

  const read = await runLive(getCart(add.right.session))

  if (Either.isLeft(read)) {
    const cleanupAfterReadFailure = await runLive(
      removeCartItems(add.right.session, [{ productId: product.productId, quantity: 1 }])
    )

    if (Either.isLeft(cleanupAfterReadFailure)) {
      return Either.left({ _tag: "LiveCartSmokeCleanupFailed", causeTag: toCauseTag(cleanupAfterReadFailure.left) })
    }

    return Either.left({ _tag: "LiveCartSmokeReadFailed", causeTag: toCauseTag(read.left) })
  }

  if (
    cartQuantityForProduct(read.right.value, product.productId) < 1 ||
    read.right.value.totals.itemPriceAfterPromos.amount.length === 0
  ) {
    const cleanupAfterVerificationFailure = await runLive(
      removeCartItems(read.right.session, [{ productId: product.productId, quantity: 1 }])
    )

    if (Either.isLeft(cleanupAfterVerificationFailure)) {
      return Either.left({
        _tag: "LiveCartSmokeCleanupFailed",
        causeTag: toCauseTag(cleanupAfterVerificationFailure.left)
      })
    }

    return Either.left({ _tag: "LiveCartSmokeVerificationFailed" })
  }

  const cleanup = await runLive(removeCartItems(read.right.session, [{ productId: product.productId, quantity: 1 }]))

  if (Either.isLeft(cleanup)) {
    return Either.left({ _tag: "LiveCartSmokeCleanupFailed", causeTag: toCauseTag(cleanup.left) })
  }

  const cleanedCart = await runLive(getCart(cleanup.right.session))

  if (Either.isLeft(cleanedCart)) {
    return Either.left({ _tag: "LiveCartSmokeReadFailed", causeTag: toCauseTag(cleanedCart.left) })
  }

  if (cartQuantityForProduct(cleanedCart.right.value, product.productId) > 0) {
    return Either.left({ _tag: "LiveCartSmokeVerificationFailed" })
  }

  return Either.right(product.name)
}

if (process.env[liveSmokeFlag] !== enabledValue) {
  process.stdout.write(`${liveSmokeFlag}=1 is required; skipping live cart smoke test.\n`)
  process.exit(successStatus)
} else {
  const result = await runSmoke()

  if (Either.isRight(result)) {
    process.stdout.write(`Live cart smoke passed for product "${result.right}".\n`)
    process.exit(successStatus)
  } else {
    process.stderr.write(`Live cart smoke returned typed failure: ${JSON.stringify(result.left)}\n`)
    process.exit(failureStatus)
  }
}
