import { Either } from "effect"

import { parseUnknown } from "../domain/parse.js"
import {
  type AuthenticatedSdkSessionSnapshot,
  BrowserLoginCaptureSchema,
  BrowserLoginOptionsSchema,
  BrowserLoginPortErrorSchema,
  type BrowserLoginRequest,
  BrowserLoginRequestSchema
} from "../domain/schemas/index.js"
import { makeAuthenticatedSdkSessionSnapshot } from "./session-snapshot.js"
import { VOILA_BASE_URL } from "./urls.js"

export interface BrowserLoginPort {
  readonly captureSession: (request: BrowserLoginRequest) => Promise<unknown>
}

export interface BrowserLoginResult {
  readonly session: AuthenticatedSdkSessionSnapshot
}

export type BrowserLoginError =
  | {
    readonly _tag: "BrowserLoginUserCancelled"
    readonly message: string
  }
  | {
    readonly _tag: "BrowserLoginTimedOut"
    readonly message: string
  }
  | {
    readonly _tag: "BrowserLoginOptionsInvalid"
    readonly message: string
  }
  | {
    readonly _tag: "BrowserLoginAdapterFailure"
    readonly message: string
  }
  | {
    readonly _tag: "BrowserLoginCaptureInvalid"
    readonly message: string
  }
  | {
    readonly _tag: "BrowserLoginMissingCookies"
    readonly message: string
  }
  | {
    readonly _tag: "BrowserLoginNotAuthenticated"
    readonly message: string
  }

const loginUrl = new URL("/", VOILA_BASE_URL).href
const emptyCookieCount = 0

const browserLoginOptionsInvalid = (): BrowserLoginError => ({
  _tag: "BrowserLoginOptionsInvalid",
  message: "Browser login options do not match the SDK schema"
})

const browserLoginAdapterFailure = (): BrowserLoginError => ({
  _tag: "BrowserLoginAdapterFailure",
  message: "Browser login adapter failed before returning a typed result"
})

const browserLoginUserCancelled = (): BrowserLoginError => ({
  _tag: "BrowserLoginUserCancelled",
  message: "User cancelled interactive browser login"
})

const browserLoginTimedOut = (): BrowserLoginError => ({
  _tag: "BrowserLoginTimedOut",
  message: "Interactive browser login timed out"
})

const browserLoginCaptureInvalid = (): BrowserLoginError => ({
  _tag: "BrowserLoginCaptureInvalid",
  message: "Browser login capture does not match the SDK schema"
})

const browserLoginMissingCookies = (): BrowserLoginError => ({
  _tag: "BrowserLoginMissingCookies",
  message: "Browser login completed without Voila session cookies"
})

const browserLoginNotAuthenticated = (): BrowserLoginError => ({
  _tag: "BrowserLoginNotAuthenticated",
  message: "Browser login completed without authenticated account evidence"
})

const normalizeBrowserLoginPortError = (error: unknown): BrowserLoginError => {
  const parsedError = parseUnknown(BrowserLoginPortErrorSchema, error)

  if (Either.isLeft(parsedError)) {
    return browserLoginAdapterFailure()
  }

  switch (parsedError.right._tag) {
    case "BrowserLoginAdapterFailure":
      return browserLoginAdapterFailure()
    case "BrowserLoginTimedOut":
      return browserLoginTimedOut()
    case "BrowserLoginUserCancelled":
      return browserLoginUserCancelled()
  }
}

const makeBrowserLoginRequest = (
  options?: unknown
): Either.Either<BrowserLoginRequest, BrowserLoginError> =>
  Either.flatMap(
    Either.mapLeft(parseUnknown(BrowserLoginOptionsSchema, options ?? {}), browserLoginOptionsInvalid),
    (parsedOptions) =>
      Either.mapLeft(
        parseUnknown(BrowserLoginRequestSchema, {
          ...parsedOptions,
          loginUrl
        }),
        browserLoginOptionsInvalid
      )
  )

export const loginWithBrowser = async (
  browser: BrowserLoginPort,
  options?: unknown
): Promise<Either.Either<BrowserLoginResult, BrowserLoginError>> => {
  const request = makeBrowserLoginRequest(options)

  if (Either.isLeft(request)) {
    return Either.left(request.left)
  }

  let captureResult: unknown

  try {
    captureResult = await browser.captureSession(request.right)
  } catch {
    return Either.left(browserLoginAdapterFailure())
  }

  if (captureResult === undefined || captureResult === null || !Either.isEither(captureResult)) {
    return Either.left(browserLoginAdapterFailure())
  }

  if (Either.isLeft(captureResult)) {
    return Either.left(normalizeBrowserLoginPortError(captureResult.left))
  }

  const capture = Either.mapLeft(
    parseUnknown(BrowserLoginCaptureSchema, captureResult.right),
    browserLoginCaptureInvalid
  )

  if (Either.isLeft(capture)) {
    return Either.left(capture.left)
  }

  if (capture.right.session.cookieJar.cookies.length === emptyCookieCount) {
    return Either.left(browserLoginMissingCookies())
  }

  if (!capture.right.authenticated) {
    return Either.left(browserLoginNotAuthenticated())
  }

  return Either.map(
    Either.mapLeft(
      makeAuthenticatedSdkSessionSnapshot(capture.right.session, "authenticated", capture.right.account),
      browserLoginCaptureInvalid
    ),
    (session) => ({
      session
    })
  )
}
