import { readFile } from "node:fs/promises"

import { Either } from "effect"

import type {
  ResponseHeaders,
  SessionStoragePort,
  VoilaTransport,
  VoilaTransportRequest,
  VoilaTransportResponse
} from "../../src/index.js"
import { checkSessionHealth, getCart, loadSdkSessionSnapshot, searchProducts } from "../../src/index.js"

const authSmokeFlag = "VOILA_AUTH_SMOKE"
const enabledValue = "1"
const harmlessQuery = "milk"
const liveSessionPathVariable = "VOILA_AUTH_SESSION_PATH"
const pageSize = 24
const successStatus = 0
const failureStatus = 1

type AuthReadOnlySmokeFailure =
  | {
    readonly _tag: "AuthReadOnlySmokeOptInMissing"
  }
  | {
    readonly _tag: "AuthReadOnlySmokeSessionPathMissing"
  }
  | {
    readonly _tag: "AuthReadOnlySmokeSessionLoadFailed"
    readonly causeTag: string
  }
  | {
    readonly _tag: "AuthReadOnlySmokeSessionNotAuthenticated"
  }
  | {
    readonly _tag: "AuthReadOnlySmokeSessionHealthFailed"
    readonly causeTag: string
  }
  | {
    readonly _tag: "AuthReadOnlySmokeSessionNotActive"
    readonly status: string
  }
  | {
    readonly _tag: "AuthReadOnlySmokeSearchFailed"
    readonly causeTag: string
  }
  | {
    readonly _tag: "AuthReadOnlySmokeCartReadFailed"
    readonly causeTag: string
  }
  | {
    readonly _tag: "AuthReadOnlySmokeNoProducts"
  }

interface AuthReadOnlySmokeSuccess {
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

const makeFileSessionStorage = (path: string): SessionStoragePort => ({
  read: async () => readFile(path, "utf8"),
  write: async () => {
    throw new Error("Auth readonly smoke never writes session snapshots")
  }
})

const runSmoke = async (): Promise<Either.Either<AuthReadOnlySmokeSuccess, AuthReadOnlySmokeFailure>> => {
  if (process.env[authSmokeFlag] !== enabledValue) {
    return Either.left({
      _tag: "AuthReadOnlySmokeOptInMissing"
    })
  }

  const sessionPath = process.env[liveSessionPathVariable]

  if (sessionPath === undefined || sessionPath.trim().length === 0) {
    return Either.left({
      _tag: "AuthReadOnlySmokeSessionPathMissing"
    })
  }

  const snapshot = await loadSdkSessionSnapshot(makeFileSessionStorage(sessionPath))

  if (Either.isLeft(snapshot)) {
    return Either.left({
      _tag: "AuthReadOnlySmokeSessionLoadFailed",
      causeTag: toCauseTag(snapshot.left)
    })
  }

  if (snapshot.right.kind !== "authenticated") {
    return Either.left({
      _tag: "AuthReadOnlySmokeSessionNotAuthenticated"
    })
  }

  const health = await checkSessionHealth(snapshot.right, fetchTransport)

  if (Either.isLeft(health)) {
    return Either.left({
      _tag: "AuthReadOnlySmokeSessionHealthFailed",
      causeTag: toCauseTag(health.left)
    })
  }

  if (health.right.status !== "active") {
    return Either.left({
      _tag: "AuthReadOnlySmokeSessionNotActive",
      status: health.right.status
    })
  }

  const session = health.right.session.session
  const search = await searchProducts(session, {
    pageSize,
    query: harmlessQuery
  }, fetchTransport)

  if (Either.isLeft(search)) {
    return Either.left({
      _tag: "AuthReadOnlySmokeSearchFailed",
      causeTag: toCauseTag(search.left)
    })
  }

  if (search.right.value.products.length === 0) {
    return Either.left({
      _tag: "AuthReadOnlySmokeNoProducts"
    })
  }

  const cart = await getCart(search.right.session, fetchTransport)

  if (Either.isLeft(cart)) {
    return Either.left({
      _tag: "AuthReadOnlySmokeCartReadFailed",
      causeTag: toCauseTag(cart.left)
    })
  }

  return Either.right({
    cartItemCount: cart.right.value.itemCount,
    productCount: search.right.value.products.length
  })
}

const result = await runSmoke()

if (Either.isLeft(result) && result.left._tag === "AuthReadOnlySmokeOptInMissing") {
  process.stdout.write(`${authSmokeFlag}=1 is required; skipping authenticated read-only smoke test.\n`)
  process.exit(successStatus)
}

if (Either.isLeft(result) && result.left._tag === "AuthReadOnlySmokeSessionPathMissing") {
  process.stdout.write(`${liveSessionPathVariable} is required; skipping authenticated read-only smoke test.\n`)
  process.exit(successStatus)
}

if (Either.isRight(result)) {
  process.stdout.write(
    `Authenticated read-only smoke passed with ${String(result.right.productCount)} products and ${
      String(result.right.cartItemCount)
    } cart items.\n`
  )
  process.exit(successStatus)
}

process.stderr.write(`Authenticated read-only smoke returned typed failure: ${JSON.stringify(result.left)}\n`)
process.exit(failureStatus)
