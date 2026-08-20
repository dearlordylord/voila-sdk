import type { OperationExecutionResult } from "@firfi/voila-mcp"
import {
  type CookieJarPort,
  type BrowserLoginBrowserCookie,
  BrowserLoginTimeoutMsSchema,
  type AuthSessionState,
  makeAuthenticatedSdkSessionSnapshot,
  makeSessionSnapshot,
  type SerializedCookieJarSnapshot,
  type SdkSessionSnapshot,
  toughCookieJarPort,
  VOILA_BASE_URL
} from "@firfi/voila-sdk"
import { type StateFilePath } from "@firfi/voila-session-store"
import { Result, Schema } from "effect"
import { randomUUID } from "node:crypto"

import {
  type CapturedBrowserSession,
  capturedSessionIsAuthenticated,
  observeVoilaBrowserTraffic,
  type SessionIdGenerator
} from "./auth-capture.js"
import {
  adapterTools,
  type AuthFailure,
  type BrowserContextPort,
  type BrowserPagePort,
  type BrowserPort,
  type SessionCapturePort,
  type SessionHealthPort,
  type SessionPersistencePort
} from "./auth-login-adapters.js"
import type { CliLoginOptions } from "./cli.js"

const defaultBrowserLoginTimeoutMs = 300_000
const defaultTimeoutMs = Schema.decodeUnknownSync(BrowserLoginTimeoutMsSchema)(defaultBrowserLoginTimeoutMs)
const millisecondsPerSecond = 1000
const sessionCookieExpires = -1
const readonlyCsrfFallback = "csrf-not-observed-readonly"

const failure = (tag: string, message = "Voila authentication failed"): AuthFailure => ({
  error: { _tag: tag, message },
  ok: false
})

const success = (value: unknown): Extract<OperationExecutionResult, { readonly ok: true }> => ({ ok: true, value })

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

const makeCapturedCookieJar = (
  capture: CapturedBrowserSession,
  cookieJarPort: CookieJarPort
): Result.Result<SerializedCookieJarSnapshot, AuthFailure> => {
  const jar = cookieJarPort.create()

  for (const cookie of capture.cookies) {
    try {
      jar.setCookieSync(makeCookieHeader(cookie), VOILA_BASE_URL)
    } catch {
      return Result.fail(failure("VoilaAuthCookieCaptureFailed", "Voila browser cookies could not be captured"))
    }
  }

  return Result.mapError(cookieJarPort.serialize(jar), () =>
    failure("VoilaAuthCookieCaptureFailed", "Voila browser cookies could not be captured")
  )
}

const makeCapturedCsrfState = (capture: CapturedBrowserSession): { readonly token: string } => ({
  token: capture.material.csrfToken ?? readonlyCsrfFallback
})

const makeCapturedAuthState = (capture: CapturedBrowserSession): AuthSessionState =>
  capture.material.csrfToken === undefined ? "unknown-expiry" : "authenticated"

const makeSessionFromBrowserCapture = (
  capture: CapturedBrowserSession,
  ports: SessionCapturePort
): Result.Result<SdkSessionSnapshot, AuthFailure> => {
  if (!capturedSessionIsAuthenticated(capture)) {
    return Result.fail(failure("VoilaAuthNotAuthenticated", "Voila authenticated cookie was not captured"))
  }

  return Result.flatMap(makeCapturedCookieJar(capture, ports.cookieJar), (cookieJar) =>
    Result.flatMap(
      Result.mapError(
        ports.constructors.makeSessionSnapshot(capture.material.metadata, makeCapturedCsrfState(capture), cookieJar),
        () =>
          failure("VoilaAuthSessionCaptureInvalid", "Voila browser session could not be converted to an SDK session")
      ),
      (session) =>
        Result.mapError(
          ports.constructors.makeAuthenticatedSdkSessionSnapshot(session, makeCapturedAuthState(capture)),
          () =>
            failure("VoilaAuthSessionCaptureInvalid", "Voila browser session could not be converted to an SDK session")
        )
    )
  )
}

/**
 * Validate and persist through one guarded file cycle. The health check may
 * rotate cookies; inactive captures leave the existing snapshot untouched,
 * and a concurrent newer write wins the cycle.
 */
const validateSavedSession = async (
  healthPort: SessionHealthPort,
  persistence: SessionPersistencePort,
  path: StateFilePath,
  session: SdkSessionSnapshot
): Promise<OperationExecutionResult> => {
  const health = await persistence.validateAndSave(path, () => healthPort.check(session))

  if (Result.isFailure(health)) {
    return health.failure
  }

  return health.success.status === "active"
    ? success({ sessionPath: path, status: health.success.status })
    : failure("VoilaAuthSessionInactive", "Saved browser session is not active")
}

export type LoginRuntime = {
  readonly browser: BrowserPort
  readonly health: SessionHealthPort
  readonly persistence: SessionPersistencePort
  readonly sessionCapture: SessionCapturePort
  readonly sessionIds: { readonly generate: SessionIdGenerator }
}

interface OpenedLoginPage {
  readonly observer: ReturnType<typeof observeVoilaBrowserTraffic>
  readonly page: BrowserPagePort
}

const openLoginPage = async (
  context: BrowserContextPort,
  generateSessionId: SessionIdGenerator
): Promise<Result.Result<OpenedLoginPage, AuthFailure>> => {
  const page = context.pages()[0] ?? (await context.newPage())
  const observer = observeVoilaBrowserTraffic(page, generateSessionId)

  try {
    await page.goto()
  } catch {
    return Result.fail(failure("VoilaAuthOpenFailed", "Voila could not be opened in Chromium"))
  }

  return Result.succeed({ observer, page })
}

const completeLogin = async (
  capture: Result.Result<CapturedBrowserSession, AuthFailure>,
  options: CliLoginOptions,
  runtime: LoginRuntime
): Promise<OperationExecutionResult> => {
  if (Result.isFailure(capture)) {
    return capture.failure
  }

  const session = makeSessionFromBrowserCapture(capture.success, runtime.sessionCapture)

  if (Result.isFailure(session)) {
    return session.failure
  }

  return validateSavedSession(runtime.health, runtime.persistence, options.sessionPath, session.success)
}

const runLoginInContext = async (
  context: BrowserContextPort,
  options: CliLoginOptions,
  runtime: LoginRuntime
): Promise<OperationExecutionResult> => {
  const opened = await openLoginPage(context, runtime.sessionIds.generate)

  if (Result.isFailure(opened)) {
    return opened.failure
  }

  options.progress.write(
    [
      "Opened Voila in Chromium.",
      "Log in manually, then close the browser window to save the authenticated session.",
      "The CLI validates captured session material with Voila, then saves only an active session.",
      ""
    ].join("\n")
  )

  const capture = await runtime.browser.capture(
    opened.success.page,
    options.timeoutMs ?? defaultTimeoutMs,
    opened.success.observer,
    options.progress.write,
    options.delay,
    runtime.sessionIds.generate
  )

  return completeLogin(capture, options, runtime)
}

const launchBrowserContext = async (
  browser: BrowserPort,
  profilePath: string
): Promise<Result.Result<BrowserContextPort, AuthFailure>> => {
  try {
    return Result.succeed(await browser.launchPersistentContext(profilePath))
  } catch {
    return Result.fail(failure("VoilaAuthBrowserLaunchFailed", "Playwright Chromium could not be launched"))
  }
}

export const loginWithPlaywrightWithRuntime = async (
  options: CliLoginOptions,
  runtime: LoginRuntime
): Promise<OperationExecutionResult> => {
  const context = await launchBrowserContext(runtime.browser, options.profilePath)

  if (Result.isFailure(context)) {
    return context.failure
  }

  return runLoginInContext(context.success, options, runtime).finally(() => context.success.close())
}

export const loginWithPlaywright = async (options: CliLoginOptions): Promise<OperationExecutionResult> =>
  loginWithPlaywrightWithRuntime(options, {
    browser: adapterTools.makeBrowserPort(adapterTools.makeDefaultPlaywrightLauncher()),
    health: adapterTools.makeHealthPort(adapterTools.defaultTransportLayer()),
    persistence: adapterTools.makeDefaultPersistencePort(),
    sessionCapture: {
      constructors: { makeAuthenticatedSdkSessionSnapshot, makeSessionSnapshot },
      cookieJar: toughCookieJarPort
    },
    sessionIds: { generate: randomUUID }
  })
