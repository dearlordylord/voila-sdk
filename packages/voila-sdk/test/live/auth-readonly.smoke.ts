import { readFile } from "node:fs/promises"

import { Effect, Result } from "effect"

import type { SessionStoragePort } from "../../src/index.js"
import {
  checkSessionHealth,
  getCart,
  loadSdkSessionSnapshot,
  searchProducts,
  sessionStorageReadFailure
} from "../../src/index.js"
import { runLive } from "./live-transport.js"

const authSmokeFlag = "VOILA_AUTH_SMOKE"
const enabledValue = "1"
const harmlessQuery = "milk"
const liveSessionPathVariable = "VOILA_AUTH_SESSION_PATH"
const pageSize = 24
const successStatus = 0
const failureStatus = 1

type AuthReadOnlySmokeFailure =
  | { readonly _tag: "AuthReadOnlySmokeOptInMissing" }
  | { readonly _tag: "AuthReadOnlySmokeSessionPathMissing" }
  | { readonly _tag: "AuthReadOnlySmokeSessionLoadFailed"; readonly causeTag: string }
  | { readonly _tag: "AuthReadOnlySmokeSessionNotAuthenticated" }
  | { readonly _tag: "AuthReadOnlySmokeSessionHealthFailed"; readonly causeTag: string }
  | { readonly _tag: "AuthReadOnlySmokeSessionNotActive"; readonly status: string }
  | { readonly _tag: "AuthReadOnlySmokeSearchFailed"; readonly causeTag: string }
  | { readonly _tag: "AuthReadOnlySmokeCartReadFailed"; readonly causeTag: string }
  | { readonly _tag: "AuthReadOnlySmokeNoProducts" }

interface AuthReadOnlySmokeSuccess {
  readonly cartItemCount: number
  readonly productCount: number
}

const toCauseTag = (error: { readonly _tag: string }): string => error._tag

const makeFileSessionStorage = (path: string): SessionStoragePort => ({
  read: () => Effect.tryPromise({ catch: sessionStorageReadFailure, try: () => readFile(path, "utf8") })
})

const runSmoke = async (): Promise<Result.Result<AuthReadOnlySmokeSuccess, AuthReadOnlySmokeFailure>> => {
  if (process.env[authSmokeFlag] !== enabledValue) {
    return Result.fail({ _tag: "AuthReadOnlySmokeOptInMissing" })
  }

  const sessionPath = process.env[liveSessionPathVariable]

  if (sessionPath === undefined || sessionPath.trim().length === 0) {
    return Result.fail({ _tag: "AuthReadOnlySmokeSessionPathMissing" })
  }

  const snapshot = await Effect.runPromise(Effect.result(loadSdkSessionSnapshot(makeFileSessionStorage(sessionPath))))

  if (Result.isFailure(snapshot)) {
    return Result.fail({ _tag: "AuthReadOnlySmokeSessionLoadFailed", causeTag: toCauseTag(snapshot.failure) })
  }

  if (snapshot.success.kind !== "authenticated") {
    return Result.fail({ _tag: "AuthReadOnlySmokeSessionNotAuthenticated" })
  }

  const health = await runLive(checkSessionHealth(snapshot.success))

  if (Result.isFailure(health)) {
    return Result.fail({ _tag: "AuthReadOnlySmokeSessionHealthFailed", causeTag: toCauseTag(health.failure) })
  }

  if (health.success.status !== "active") {
    return Result.fail({ _tag: "AuthReadOnlySmokeSessionNotActive", status: health.success.status })
  }

  const session = health.success.session.session
  const search = await runLive(searchProducts(session, { pageSize, query: harmlessQuery }))

  if (Result.isFailure(search)) {
    return Result.fail({ _tag: "AuthReadOnlySmokeSearchFailed", causeTag: toCauseTag(search.failure) })
  }

  if (search.success.value.products.length === 0) {
    return Result.fail({ _tag: "AuthReadOnlySmokeNoProducts" })
  }

  const cart = await runLive(getCart(search.success.session))

  if (Result.isFailure(cart)) {
    return Result.fail({ _tag: "AuthReadOnlySmokeCartReadFailed", causeTag: toCauseTag(cart.failure) })
  }

  return Result.succeed({
    cartItemCount: cart.success.value.itemCount,
    productCount: search.success.value.products.length
  })
}

const result = await runSmoke()

if (Result.isFailure(result) && result.failure._tag === "AuthReadOnlySmokeOptInMissing") {
  process.stdout.write(`${authSmokeFlag}=1 is required; skipping authenticated read-only smoke test.\n`)
  process.exit(successStatus)
}

if (Result.isFailure(result) && result.failure._tag === "AuthReadOnlySmokeSessionPathMissing") {
  process.stdout.write(`${liveSessionPathVariable} is required; skipping authenticated read-only smoke test.\n`)
  process.exit(successStatus)
}

if (Result.isSuccess(result)) {
  process.stdout.write(
    `Authenticated read-only smoke passed with ${String(result.success.productCount)} products and ${String(
      result.success.cartItemCount
    )} cart items.\n`
  )
  process.exit(successStatus)
}

process.stderr.write(`Authenticated read-only smoke returned typed failure: ${JSON.stringify(result.failure)}\n`)
process.exit(failureStatus)
