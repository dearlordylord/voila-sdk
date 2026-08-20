import { Result } from "effect"

import type { CookieJarPort, NormalizedCartView, NormalizedSearchProduct, SessionSnapshot } from "../../src/index.js"
import {
  addCartItems,
  bootstrapGuestSession,
  getCart,
  removeCartItems,
  searchProducts,
  toughCookieJarPort
} from "../../src/index.js"
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
  | { readonly _tag: "LiveCartSmokeCleanupUnverified"; readonly causeTag: string }
  | { readonly _tag: "LiveCartSmokeDefect" }
  | { readonly _tag: "LiveCartSmokeVerificationFailed" }

const toCauseTag = (error: { readonly _tag: string }): string => error._tag

const isCartProductCandidate = (product: NormalizedSearchProduct): boolean =>
  product.available && productUuidPattern.test(product.productId)

const cartQuantityForProduct = (cart: NormalizedCartView, productId: string): number =>
  cart.items.filter((item) => item.productId === productId).reduce((total, item) => total + item.quantity, 0)

const makeSharedCookieJarPort = (session: SessionSnapshot): Result.Result<CookieJarPort, LiveCartSmokeFailure> =>
  Result.mapError(
    Result.map(toughCookieJarPort.deserialize(session.cookieJar), (sharedJar) => ({
      create: () => sharedJar,
      deserialize: () => Result.succeed(sharedJar),
      serialize: toughCookieJarPort.serialize
    })),
    (error) => ({ _tag: "LiveCartSmokeCleanupUnverified", causeTag: error._tag })
  )

interface MutationObservation {
  readonly failure: LiveCartSmokeFailure | undefined
  readonly session: SessionSnapshot
}

const observeAdd = async (
  session: SessionSnapshot,
  productId: string,
  cookieJarPort: CookieJarPort
): Promise<MutationObservation> => {
  const add = await runLive(addCartItems(session, [{ productId, quantity: 1 }], cookieJarPort))

  if (Result.isFailure(add)) {
    return { failure: { _tag: "LiveCartSmokeAddFailed", causeTag: toCauseTag(add.failure) }, session }
  }

  const read = await runLive(getCart(add.success.session, cookieJarPort))

  if (Result.isFailure(read)) {
    return {
      failure: { _tag: "LiveCartSmokeReadFailed", causeTag: toCauseTag(read.failure) },
      session: add.success.session
    }
  }

  const addedExactlyOne = cartQuantityForProduct(read.success.value, productId) === 1
  const hasServerTotal = read.success.value.totals.itemPriceAfterPromos.amount.length > 0

  return {
    failure: addedExactlyOne && hasServerTotal ? undefined : { _tag: "LiveCartSmokeVerificationFailed" },
    session: read.success.session
  }
}

const cleanupAndVerify = async (
  session: SessionSnapshot,
  productId: string,
  cookieJarPort: CookieJarPort
): Promise<Result.Result<void, LiveCartSmokeFailure>> => {
  const cleanup = await runLive(removeCartItems(session, [{ productId, quantity: 1 }], cookieJarPort))
  const verificationSession = Result.isSuccess(cleanup) ? cleanup.success.session : session
  const verification = await runLive(getCart(verificationSession, cookieJarPort))

  if (Result.isFailure(verification)) {
    const causeTag = Result.isFailure(cleanup) ? toCauseTag(cleanup.failure) : toCauseTag(verification.failure)
    return Result.fail({ _tag: "LiveCartSmokeCleanupUnverified", causeTag })
  }

  if (cartQuantityForProduct(verification.success.value, productId) === 0) {
    return Result.succeed(undefined)
  }

  const retry = await runLive(
    removeCartItems(verification.success.session, [{ productId, quantity: 1 }], cookieJarPort)
  )
  const retryVerificationSession = Result.isSuccess(retry) ? retry.success.session : verification.success.session
  const retryVerification = await runLive(getCart(retryVerificationSession, cookieJarPort))

  if (Result.isFailure(retryVerification)) {
    const causeTag = Result.isFailure(retry) ? toCauseTag(retry.failure) : toCauseTag(retryVerification.failure)
    return Result.fail({ _tag: "LiveCartSmokeCleanupUnverified", causeTag })
  }

  return cartQuantityForProduct(retryVerification.success.value, productId) === 0
    ? Result.succeed(undefined)
    : Result.fail({ _tag: "LiveCartSmokeVerificationFailed" })
}

const runSmoke = async (): Promise<Result.Result<string, LiveCartSmokeFailure>> => {
  const bootstrap = await runLive(bootstrapGuestSession())

  if (Result.isFailure(bootstrap)) {
    return Result.fail({ _tag: "LiveCartSmokeBootstrapFailed", causeTag: toCauseTag(bootstrap.failure) })
  }

  const cookieJarPort = makeSharedCookieJarPort(bootstrap.success.session)

  if (Result.isFailure(cookieJarPort)) {
    return Result.fail(cookieJarPort.failure)
  }

  const baseline = await runLive(getCart(bootstrap.success.session, cookieJarPort.success))

  if (Result.isFailure(baseline)) {
    return Result.fail({ _tag: "LiveCartSmokeReadFailed", causeTag: toCauseTag(baseline.failure) })
  }

  const search = await runLive(
    searchProducts(baseline.success.session, { pageSize, query: harmlessQuery }, cookieJarPort.success)
  )

  if (Result.isFailure(search)) {
    return Result.fail({ _tag: "LiveCartSmokeSearchFailed", causeTag: toCauseTag(search.failure) })
  }

  const product = search.success.value.products.find(
    (candidate) =>
      isCartProductCandidate(candidate) && cartQuantityForProduct(baseline.success.value, candidate.productId) === 0
  )

  if (product === undefined) {
    return Result.fail({ _tag: "LiveCartSmokeNoAvailableProduct" })
  }

  let observation: MutationObservation = { failure: { _tag: "LiveCartSmokeDefect" }, session: search.success.session }
  let cleanup: Result.Result<void, LiveCartSmokeFailure> = Result.fail({
    _tag: "LiveCartSmokeCleanupUnverified",
    causeTag: "CleanupNotAttempted"
  })

  try {
    observation = await observeAdd(search.success.session, product.productId, cookieJarPort.success)
  } catch {
    observation = { failure: { _tag: "LiveCartSmokeDefect" }, session: search.success.session }
  } finally {
    try {
      cleanup = await cleanupAndVerify(observation.session, product.productId, cookieJarPort.success)
    } catch {
      cleanup = Result.fail({ _tag: "LiveCartSmokeCleanupUnverified", causeTag: "CleanupDefect" })
    }
  }

  if (Result.isFailure(cleanup)) {
    return Result.fail(cleanup.failure)
  }

  return observation.failure === undefined ? Result.succeed(product.name) : Result.fail(observation.failure)
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
