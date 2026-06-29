import { Either } from "effect"

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
import type { VoilaTransport, VoilaTransportResponse } from "./http-client.js"
import { extractInitialState, extractInitialStatePayload } from "./initial-state.js"
import { type CookieJarPort, makeSessionSnapshot, toughCookieJarPort } from "./session-snapshot.js"
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
  | {
    readonly _tag: "GuestBootstrapNetworkFailure"
    readonly message: string
  }
  | {
    readonly _tag: "GuestBootstrapNon2xxResponse"
    readonly message: string
    readonly status: number
  }
  | {
    readonly _tag: "GuestBootstrapMissingCookies"
    readonly message: string
  }
  | {
    readonly _tag: "GuestBootstrapCookiePersistenceFailure"
    readonly message: string
  }
  | {
    readonly _tag: "GuestBootstrapMissingCsrf"
    readonly message: string
  }
  | {
    readonly _tag: "GuestBootstrapInitialStateMalformed"
    readonly message: string
  }

const homepageUrl = new URL("/", VOILA_BASE_URL)
const emptyStringLength = 0
const successStatusMin = 200
const successStatusMax = 300
const setCookieHeader = "set-cookie"

const networkFailure = (): GuestBootstrapError => ({
  _tag: "GuestBootstrapNetworkFailure",
  message: "Voila homepage request failed"
})

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
  if (!isRecord(payload) || !isRecord(payload.csrf)) {
    return false
  }

  return typeof payload.csrf.token === "string"
}

const makeGuestCartSummary = (
  basket: SessionSnapshotBasket
): GuestCartSummary => {
  const itemCount = (basket.itemGroups ?? []).reduce(
    (total, group) => total + group.items.reduce((groupTotal, item) => groupTotal + item.quantity, 0),
    0
  )

  return {
    basketId: basket.basketId,
    itemCount,
    regionId: basket.regionId,
    totals: basket.totals
  }
}

type SessionSnapshotBasket = InitialState["data"]["basket"]

const storeHomepageCookies = (
  cookieJarPort: CookieJarPort,
  response: VoilaTransportResponse
): Either.Either<SessionSnapshot["cookieJar"], GuestBootstrapError> => {
  const cookies = getHeaderValues(response.headers, setCookieHeader)

  if (cookies.length === emptyStringLength) {
    return Either.left(missingCookies())
  }

  const jar = cookieJarPort.create()

  for (const cookie of cookies) {
    try {
      jar.setCookieSync(cookie, homepageUrl.href)
    } catch {
      return Either.left(cookiePersistenceFailure())
    }
  }

  return Either.mapLeft(cookieJarPort.serialize(jar), cookiePersistenceFailure)
}

const decodeInitialState = (html: string): Either.Either<InitialState, GuestBootstrapError> =>
  Either.flatMap(
    Either.mapLeft(extractInitialStatePayload(html), initialStateMalformed),
    (payload) => {
      if (!hasCsrfToken(payload)) {
        return Either.left(missingCsrf())
      }

      return Either.mapLeft(extractInitialState(html), initialStateMalformed)
    }
  )

export const bootstrapGuestSession = async (
  transport: VoilaTransport,
  cookieJarPort: CookieJarPort = toughCookieJarPort
): Promise<Either.Either<GuestBootstrapResult, GuestBootstrapError>> => {
  let response: Either.Either<VoilaTransportResponse, unknown>

  try {
    response = await transport.request({
      headers: {},
      method: "GET",
      url: homepageUrl
    })
  } catch {
    return Either.left(networkFailure())
  }

  if (Either.isLeft(response)) {
    return Either.left(networkFailure())
  }

  if (!isSuccessStatus(response.right.status)) {
    return Either.left(non2xxResponse(response.right.status))
  }

  return Either.flatMap(
    storeHomepageCookies(cookieJarPort, response.right),
    (cookieJar) =>
      Either.flatMap(decodeInitialState(response.right.body), (initialState) => {
        if (initialState.csrf.token.trim().length === emptyStringLength) {
          return Either.left(missingCsrf())
        }

        return Either.mapLeft(
          makeSessionSnapshot(initialState.session.metadata, initialState.csrf, cookieJar),
          cookiePersistenceFailure
        ).pipe(
          Either.map((session) => ({
            categories: getInitialStateCategories(initialState),
            cart: makeGuestCartSummary(initialState.data.basket),
            csrf: initialState.csrf,
            metadata: initialState.session.metadata,
            regionId: initialState.data.basket.regionId,
            session
          }))
        )
      })
  )
}
