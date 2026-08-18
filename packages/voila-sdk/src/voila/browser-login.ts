import { Effect, Result } from "effect"

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

/**
 * Playwright is promise-shaped and stays that way: this port is the one place
 * an external promise library meets the SDK, and it is wrapped exactly once,
 * here, rather than at every call site.
 */
export interface BrowserLoginPort {
  readonly captureSession: (request: BrowserLoginRequest) => Promise<unknown>
}

export interface BrowserLoginResult {
  readonly session: AuthenticatedSdkSessionSnapshot
}

export type BrowserLoginError =
  | { readonly _tag: "BrowserLoginUserCancelled"; readonly message: string }
  | { readonly _tag: "BrowserLoginTimedOut"; readonly message: string }
  | { readonly _tag: "BrowserLoginOptionsInvalid"; readonly message: string }
  | { readonly _tag: "BrowserLoginAdapterFailure"; readonly message: string }
  | { readonly _tag: "BrowserLoginCaptureInvalid"; readonly message: string }
  | { readonly _tag: "BrowserLoginMissingCookies"; readonly message: string }
  | { readonly _tag: "BrowserLoginNotAuthenticated"; readonly message: string }

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

  if (Result.isFailure(parsedError)) {
    return browserLoginAdapterFailure()
  }

  switch (parsedError.success._tag) {
    case "BrowserLoginAdapterFailure":
      return browserLoginAdapterFailure()
    case "BrowserLoginTimedOut":
      return browserLoginTimedOut()
    case "BrowserLoginUserCancelled":
      return browserLoginUserCancelled()
  }
}

const makeBrowserLoginRequest = (options?: unknown): Result.Result<BrowserLoginRequest, BrowserLoginError> =>
  Result.flatMap(
    Result.mapError(parseUnknown(BrowserLoginOptionsSchema, options ?? {}), browserLoginOptionsInvalid),
    (parsedOptions) =>
      Result.mapError(
        parseUnknown(BrowserLoginRequestSchema, { ...parsedOptions, loginUrl }),
        browserLoginOptionsInvalid
      )
  )

const makeBrowserLoginResult = (captureResult: unknown): Result.Result<BrowserLoginResult, BrowserLoginError> => {
  if (captureResult === undefined || captureResult === null || !Result.isResult(captureResult)) {
    return Result.fail(browserLoginAdapterFailure())
  }

  if (Result.isFailure(captureResult)) {
    return Result.fail(normalizeBrowserLoginPortError(captureResult.failure))
  }

  return Result.flatMap(
    Result.mapError(parseUnknown(BrowserLoginCaptureSchema, captureResult.success), browserLoginCaptureInvalid),
    (capture) => {
      if (capture.session.cookieJar.cookies.length === emptyCookieCount) {
        return Result.fail(browserLoginMissingCookies())
      }

      if (!capture.authenticated) {
        return Result.fail(browserLoginNotAuthenticated())
      }

      return Result.map(
        Result.mapError(
          makeAuthenticatedSdkSessionSnapshot(capture.session, "authenticated", capture.account),
          browserLoginCaptureInvalid
        ),
        (session) => ({ session })
      )
    }
  )
}

export const loginWithBrowser = (
  browser: BrowserLoginPort,
  options?: unknown
): Effect.Effect<BrowserLoginResult, BrowserLoginError> =>
  Effect.flatMap(Effect.fromResult(makeBrowserLoginRequest(options)), (request) =>
    Effect.flatMap(
      Effect.tryPromise({ catch: browserLoginAdapterFailure, try: () => browser.captureSession(request) }),
      (captureResult) => Effect.fromResult(makeBrowserLoginResult(captureResult))
    )
  )
