import { Result, Schema } from "effect"

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
    Schema.Union([
      Schema.Struct({ _tag: Schema.Literal("BrowserLoginTimedOut") }),
      Schema.Struct({ _tag: Schema.Literal("BrowserLoginUserCancelled") })
    ]),
    error
  )

  if (Result.isFailure(parsedError)) {
    return adapterFailure()
  }

  return parsedError.success
}

const parseOptionalAccountSummary = (
  input: unknown
): Result.Result<AuthAccountSummary | undefined, BrowserLoginPortError> =>
  input === undefined
    ? Result.succeed(undefined)
    : Result.mapError(parseUnknown(AuthAccountSummarySchema, input), adapterFailure)

const makeCookieHeader = (cookie: BrowserLoginBrowserCookie): string => {
  const expires =
    cookie.expires === undefined || cookie.expires === sessionCookieExpires
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
): Result.Result<BrowserLoginCapture["session"]["cookieJar"], BrowserLoginPortError> => {
  const jar = cookieJarPort.create()

  for (const cookie of cookies) {
    try {
      jar.setCookieSync(makeCookieHeader(cookie), VOILA_BASE_URL)
    } catch {
      return Result.fail(adapterFailure())
    }
  }

  return Result.mapError(cookieJarPort.serialize(jar), adapterFailure)
}

const closePage = async (
  page: InteractiveBrowserLoginPage
): Promise<Result.Result<undefined, BrowserLoginPortError>> => {
  try {
    await page.close()

    return Result.succeed(undefined)
  } catch {
    return Result.fail(adapterFailure())
  }
}

const readBrowserCapture = async (
  page: InteractiveBrowserLoginPage,
  cookieJarPort: CookieJarPort
): Promise<Result.Result<BrowserLoginCapture, BrowserLoginPortError>> => {
  const initialState = Result.mapError(parseUnknown(InitialStateSchema, await page.readInitialState()), adapterFailure)
  const cookies = Result.mapError(
    parseUnknown(BrowserLoginBrowserCookieArraySchema, await page.readCookies(VOILA_BASE_URL)),
    adapterFailure
  )
  const authenticated = Result.mapError(parseUnknown(Schema.Boolean, await page.readAuthenticated()), adapterFailure)
  const account = parseOptionalAccountSummary(await page.readAccountSummary())

  if (Result.isFailure(initialState)) {
    return Result.fail(initialState.failure)
  }

  if (Result.isFailure(cookies)) {
    return Result.fail(cookies.failure)
  }

  if (Result.isFailure(authenticated)) {
    return Result.fail(authenticated.failure)
  }

  if (Result.isFailure(account)) {
    return Result.fail(account.failure)
  }

  const cookieJar = storeBrowserCookies(cookies.success, cookieJarPort)

  if (Result.isFailure(cookieJar)) {
    return Result.fail(cookieJar.failure)
  }

  return Result.map(
    Result.mapError(
      makeSessionSnapshot(initialState.success.session.metadata, initialState.success.session.csrf, cookieJar.success),
      adapterFailure
    ),
    (session) => ({
      ...(account.success === undefined ? {} : { account: account.success }),
      authenticated: authenticated.success,
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
      return Result.fail(adapterFailure())
    }

    try {
      await page.openLogin(request)
    } catch {
      const closeResult = await closePage(page)

      return Result.isFailure(closeResult) ? closeResult : Result.fail(adapterFailure())
    }

    let waitResult: unknown

    try {
      waitResult = await page.waitForLoginCompletion(request)
    } catch {
      const closeResult = await closePage(page)

      return Result.isFailure(closeResult) ? closeResult : Result.fail(adapterFailure())
    }

    if (waitResult === undefined || waitResult === null || !Result.isResult(waitResult)) {
      const closeResult = await closePage(page)

      return Result.isFailure(closeResult) ? closeResult : Result.fail(adapterFailure())
    }

    if (Result.isFailure(waitResult)) {
      const closeResult = await closePage(page)

      return Result.isFailure(closeResult) ? closeResult : Result.fail(normalizeWaitFailure(waitResult.failure))
    }

    let capture: Result.Result<BrowserLoginCapture, BrowserLoginPortError>

    try {
      capture = await readBrowserCapture(page, cookieJarPort)
    } catch {
      const closeResult = await closePage(page)

      return Result.isFailure(closeResult) ? closeResult : Result.fail(adapterFailure())
    }

    const closeResult = await closePage(page)

    return Result.isFailure(closeResult) ? closeResult : capture
  }
})
