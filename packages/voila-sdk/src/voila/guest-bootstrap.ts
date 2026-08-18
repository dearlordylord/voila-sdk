import { Effect, Result } from "effect"

import type {
  CartTotals,
  CsrfState,
  InitialState,
  NormalizedCategoryTree,
  SessionMetadata,
  SessionSnapshot
} from "../domain/schemas/index.js"
import { getInitialStateCategories } from "./categories.js"
import { getHeaderValues } from "./headers.js"
import { extractInitialState, extractInitialStatePayload } from "./initial-state.js"
import { type CookieJarPort, makeSessionSnapshot, toughCookieJarPort } from "./session-snapshot.js"
import { VoilaTransport, type VoilaTransportResponse } from "./transport.js"
import type { VoilaTransportError } from "./transport-error.js"
import { VOILA_BASE_URL } from "./urls.js"

export interface GuestCartSummary {
  readonly basketId: string
  readonly itemCount: number
  readonly regionId: string
  readonly totals: CartTotals
}

export interface GuestBootstrapResult {
  readonly categories: NormalizedCategoryTree
  readonly cart: GuestCartSummary
  readonly csrf: CsrfState
  readonly metadata: SessionMetadata
  readonly regionId: string
  readonly session: SessionSnapshot
}

export type GuestBootstrapError =
  | VoilaTransportError
  | { readonly _tag: "GuestBootstrapNon2xxResponse"; readonly message: string; readonly status: number }
  | { readonly _tag: "GuestBootstrapMissingCookies"; readonly message: string }
  | { readonly _tag: "GuestBootstrapCookiePersistenceFailure"; readonly message: string }
  | { readonly _tag: "GuestBootstrapMissingCsrf"; readonly message: string }
  | { readonly _tag: "GuestBootstrapInitialStateMalformed"; readonly message: string }

const homepageUrl = new URL("/", VOILA_BASE_URL)
const emptyStringLength = 0
const successStatusMin = 200
const successStatusMax = 300
const setCookieHeader = "set-cookie"

const non2xxResponse = (status: number): GuestBootstrapError => ({
  _tag: "GuestBootstrapNon2xxResponse",
  message: "Voila homepage returned a non-success response",
  status
})

const missingCookies = (): GuestBootstrapError => ({
  _tag: "GuestBootstrapMissingCookies",
  message: "Voila homepage response did not include guest session cookies"
})

const cookiePersistenceFailure = (): GuestBootstrapError => ({
  _tag: "GuestBootstrapCookiePersistenceFailure",
  message: "Guest session cookies could not be stored"
})

const missingCsrf = (): GuestBootstrapError => ({
  _tag: "GuestBootstrapMissingCsrf",
  message: "Voila homepage initial state did not include a CSRF token"
})

const initialStateMalformed = (): GuestBootstrapError => ({
  _tag: "GuestBootstrapInitialStateMalformed",
  message: "Voila homepage initial state could not be decoded"
})

const isSuccessStatus = (status: number): boolean => status >= successStatusMin && status < successStatusMax

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null

const hasCsrfToken = (payload: unknown): boolean => {
  if (!isRecord(payload) || !isRecord(payload.session) || !isRecord(payload.session.csrf)) {
    return false
  }

  return typeof payload.session.csrf.token === "string"
}

const makeGuestCartSummary = (basket: SessionSnapshotBasket): GuestCartSummary => {
  const itemCount = (basket.itemGroups ?? []).reduce(
    (total, group) => total + group.items.reduce((groupTotal, item) => groupTotal + item.quantity, 0),
    0
  )

  return { basketId: basket.basketId, itemCount, regionId: basket.regionId, totals: basket.totals }
}

type SessionSnapshotBasket = InitialState["data"]["basket"]

const storeHomepageCookies = (
  cookieJarPort: CookieJarPort,
  response: VoilaTransportResponse
): Result.Result<SessionSnapshot["cookieJar"], GuestBootstrapError> => {
  const cookies = getHeaderValues(response.headers, setCookieHeader)

  if (cookies.length === emptyStringLength) {
    return Result.fail(missingCookies())
  }

  const jar = cookieJarPort.create()

  for (const cookie of cookies) {
    try {
      jar.setCookieSync(cookie, homepageUrl.href)
    } catch {
      return Result.fail(cookiePersistenceFailure())
    }
  }

  return Result.mapError(cookieJarPort.serialize(jar), cookiePersistenceFailure)
}

const decodeInitialState = (html: string): Result.Result<InitialState, GuestBootstrapError> =>
  Result.flatMap(Result.mapError(extractInitialStatePayload(html), initialStateMalformed), (payload) => {
    if (!hasCsrfToken(payload)) {
      return Result.fail(missingCsrf())
    }

    return Result.mapError(extractInitialState(html), initialStateMalformed)
  })

const makeGuestBootstrapResult = (
  response: VoilaTransportResponse,
  cookieJarPort: CookieJarPort
): Result.Result<GuestBootstrapResult, GuestBootstrapError> => {
  if (!isSuccessStatus(response.status)) {
    return Result.fail(non2xxResponse(response.status))
  }

  return Result.flatMap(storeHomepageCookies(cookieJarPort, response), (cookieJar) =>
    Result.flatMap(decodeInitialState(response.body), (initialState) => {
      if (initialState.session.csrf.token.trim().length === emptyStringLength) {
        return Result.fail(missingCsrf())
      }

      return Result.mapError(
        makeSessionSnapshot(initialState.session.metadata, initialState.session.csrf, cookieJar),
        cookiePersistenceFailure
      ).pipe(
        Result.map((session) => ({
          categories: getInitialStateCategories(initialState),
          cart: makeGuestCartSummary(initialState.data.basket),
          csrf: initialState.session.csrf,
          metadata: initialState.session.metadata,
          regionId: initialState.data.basket.regionId,
          session
        }))
      )
    })
  )
}

export const bootstrapGuestSession = (
  cookieJarPort: CookieJarPort = toughCookieJarPort
): Effect.Effect<GuestBootstrapResult, GuestBootstrapError, VoilaTransport> =>
  Effect.gen(function* () {
    const transport = yield* VoilaTransport
    const response = yield* transport.request({ headers: {}, method: "GET", url: homepageUrl })
    return yield* Effect.fromResult(makeGuestBootstrapResult(response, cookieJarPort))
  })
