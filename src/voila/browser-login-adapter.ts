import { Either, Schema } from "effect"

import { parseUnknown } from "../domain/parse.js"
import {
  type AuthAccountSummary,
  AuthAccountSummarySchema,
  type BrowserLoginBrowserCookie,
  BrowserLoginBrowserCookieArraySchema,
  type BrowserLoginCapture,
  type BrowserLoginPortError,
  type BrowserLoginRequest,
  InitialStateSchema
} from "../domain/schemas/index.js"
import { type CookieJarPort, makeSessionSnapshot, toughCookieJarPort } from "./session-snapshot.js"
import { VOILA_BASE_URL } from "./urls.js"

export interface InteractiveBrowserLoginPage {
  readonly close: () => Promise<unknown>
  readonly openLogin: (request: BrowserLoginRequest) => Promise<unknown>
  readonly readAccountSummary: () => Promise<unknown>
  readonly readAuthenticated: () => Promise<unknown>
  readonly readCookies: (url: string) => Promise<unknown>
  readonly readInitialState: () => Promise<unknown>
  readonly waitForLoginCompletion: (request: BrowserLoginRequest) => Promise<unknown>
}

export interface InteractiveBrowserLoginDriver {
  readonly openPage: () => Promise<InteractiveBrowserLoginPage>
}

const millisecondsPerSecond = 1000
const sessionCookieExpires = -1

const adapterFailure = (): BrowserLoginPortError => ({
  _tag: "BrowserLoginAdapterFailure",
  message: "Browser login adapter failed"
})

const normalizeWaitFailure = (error: unknown): BrowserLoginPortError => {
  const parsedError = parseUnknown(
    Schema.Union(
      Schema.Struct({ _tag: Schema.Literal("BrowserLoginTimedOut") }),
      Schema.Struct({ _tag: Schema.Literal("BrowserLoginUserCancelled") })
    ),
    error
  )

  if (Either.isLeft(parsedError)) {
    return adapterFailure()
  }

  return parsedError.right
}

const parseOptionalAccountSummary = (
  input: unknown
): Either.Either<AuthAccountSummary | undefined, BrowserLoginPortError> =>
  input === undefined
    ? Either.right(undefined)
    : Either.mapLeft(parseUnknown(AuthAccountSummarySchema, input), adapterFailure)

const makeCookieHeader = (cookie: BrowserLoginBrowserCookie): string => {
  const expires = cookie.expires === undefined || cookie.expires === sessionCookieExpires
    ? []
    : [`Expires=${new Date(cookie.expires * millisecondsPerSecond).toUTCString()}`]

  return [
    `${cookie.name}=${cookie.value}`,
    `Domain=${cookie.domain}`,
    `Path=${cookie.path}`,
    ...(cookie.secure === true ? ["Secure"] : []),
    ...(cookie.httpOnly === true ? ["HttpOnly"] : []),
    ...(cookie.sameSite === undefined ? [] : [`SameSite=${cookie.sameSite}`]),
    ...expires
  ].join("; ")
}

const storeBrowserCookies = (
  cookies: ReadonlyArray<BrowserLoginBrowserCookie>,
  cookieJarPort: CookieJarPort
): Either.Either<BrowserLoginCapture["session"]["cookieJar"], BrowserLoginPortError> => {
  const jar = cookieJarPort.create()

  for (const cookie of cookies) {
    try {
      jar.setCookieSync(makeCookieHeader(cookie), VOILA_BASE_URL)
    } catch {
      return Either.left(adapterFailure())
    }
  }

  return Either.mapLeft(cookieJarPort.serialize(jar), adapterFailure)
}

const closePage = async (
  page: InteractiveBrowserLoginPage
): Promise<Either.Either<undefined, BrowserLoginPortError>> => {
  try {
    await page.close()

    return Either.right(undefined)
  } catch {
    return Either.left(adapterFailure())
  }
}

const readBrowserCapture = async (
  page: InteractiveBrowserLoginPage,
  cookieJarPort: CookieJarPort
): Promise<Either.Either<BrowserLoginCapture, BrowserLoginPortError>> => {
  const initialState = Either.mapLeft(
    parseUnknown(InitialStateSchema, await page.readInitialState()),
    adapterFailure
  )
  const cookies = Either.mapLeft(
    parseUnknown(BrowserLoginBrowserCookieArraySchema, await page.readCookies(VOILA_BASE_URL)),
    adapterFailure
  )
  const authenticated = Either.mapLeft(
    parseUnknown(Schema.Boolean, await page.readAuthenticated()),
    adapterFailure
  )
  const account = parseOptionalAccountSummary(await page.readAccountSummary())

  if (Either.isLeft(initialState)) {
    return Either.left(initialState.left)
  }

  if (Either.isLeft(cookies)) {
    return Either.left(cookies.left)
  }

  if (Either.isLeft(authenticated)) {
    return Either.left(authenticated.left)
  }

  if (Either.isLeft(account)) {
    return Either.left(account.left)
  }

  const cookieJar = storeBrowserCookies(cookies.right, cookieJarPort)

  if (Either.isLeft(cookieJar)) {
    return Either.left(cookieJar.left)
  }

  return Either.map(
    Either.mapLeft(
      makeSessionSnapshot(initialState.right.session.metadata, initialState.right.csrf, cookieJar.right),
      adapterFailure
    ),
    (session) => ({
      ...(account.right === undefined ? {} : { account: account.right }),
      authenticated: authenticated.right,
      session
    })
  )
}

export const createInteractiveBrowserLoginPort = (
  driver: InteractiveBrowserLoginDriver,
  cookieJarPort: CookieJarPort = toughCookieJarPort
) => ({
  captureSession: async (request: BrowserLoginRequest) => {
    let page: InteractiveBrowserLoginPage

    try {
      page = await driver.openPage()
    } catch {
      return Either.left(adapterFailure())
    }

    try {
      await page.openLogin(request)
    } catch {
      const closeResult = await closePage(page)

      return Either.isLeft(closeResult) ? closeResult : Either.left(adapterFailure())
    }

    let waitResult: unknown

    try {
      waitResult = await page.waitForLoginCompletion(request)
    } catch {
      const closeResult = await closePage(page)

      return Either.isLeft(closeResult) ? closeResult : Either.left(adapterFailure())
    }

    if (waitResult === undefined || waitResult === null || !Either.isEither(waitResult)) {
      const closeResult = await closePage(page)

      return Either.isLeft(closeResult) ? closeResult : Either.left(adapterFailure())
    }

    if (Either.isLeft(waitResult)) {
      const closeResult = await closePage(page)

      return Either.isLeft(closeResult) ? closeResult : Either.left(normalizeWaitFailure(waitResult.left))
    }

    let capture: Either.Either<BrowserLoginCapture, BrowserLoginPortError>

    try {
      capture = await readBrowserCapture(page, cookieJarPort)
    } catch {
      const closeResult = await closePage(page)

      return Either.isLeft(closeResult) ? closeResult : Either.left(adapterFailure())
    }

    const closeResult = await closePage(page)

    return Either.isLeft(closeResult) ? closeResult : capture
  }
})
