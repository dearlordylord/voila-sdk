import { nodeVoilaTransportLayer, type OperationExecutionResult } from "@firfi/voila-mcp"
import {
  type BrowserLoginBrowserCookie,
  checkSessionHealth,
  makeAuthenticatedSdkSessionSnapshot,
  makeSessionSnapshot,
  type SdkSessionSnapshot,
  toughCookieJarPort,
  VOILA_BASE_URL
} from "@firfi/voila-sdk"
import {
  makeStateFileLocks,
  StateFileLocks,
  type StateFileLocksService,
  type StateFilePath
} from "@firfi/voila-session-store"
import { Effect, Result } from "effect"
import { chromium } from "playwright"

import { type CapturedBrowserSession, observeVoilaBrowserTraffic, waitForAuthenticatedCapture } from "./auth-capture.js"
import { persistLoginSession } from "./auth-session-file.js"
import type { CliLoginOptions } from "./cli.js"

const defaultTimeoutMs = 300_000
const millisecondsPerSecond = 1000
const sessionCookieExpires = -1
const readonlyCsrfFallback = "csrf-not-observed-readonly"

const failure = (tag: string, message: string): OperationExecutionResult => ({
  error: { _tag: tag, message },
  ok: false
})

const success = (value: unknown): OperationExecutionResult => ({ ok: true, value })

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

const makeSessionFromBrowserCapture = (
  capture: CapturedBrowserSession
): OperationExecutionResult | SdkSessionSnapshot => {
  const jar = toughCookieJarPort.create()

  for (const cookie of capture.cookies) {
    try {
      jar.setCookieSync(makeCookieHeader(cookie), VOILA_BASE_URL)
    } catch {
      return failure("VoilaAuthCookieCaptureFailed", "Voila browser cookies could not be captured")
    }
  }

  const cookieJar = toughCookieJarPort.serialize(jar)

  if (Result.isFailure(cookieJar)) {
    return failure("VoilaAuthCookieCaptureFailed", "Voila browser cookies could not be captured")
  }

  const session = makeSessionSnapshot(
    capture.material.metadata,
    { token: capture.material.csrfToken ?? readonlyCsrfFallback },
    cookieJar.success
  )

  if (Result.isFailure(session)) {
    return failure("VoilaAuthSessionCaptureInvalid", "Voila browser session could not be converted to an SDK session")
  }

  const sdkSession = makeAuthenticatedSdkSessionSnapshot(
    session.success,
    capture.material.csrfToken === undefined ? "unknown-expiry" : "authenticated"
  )

  return Result.isFailure(sdkSession)
    ? failure("VoilaAuthSessionCaptureInvalid", "Voila browser session could not be converted to an SDK session")
    : sdkSession.success
}

const saveSession = async (
  locks: StateFileLocksService,
  path: StateFilePath,
  snapshot: SdkSessionSnapshot
): Promise<OperationExecutionResult | undefined> => {
  const saved = await Effect.runPromise(
    Effect.result(persistLoginSession(path, snapshot).pipe(Effect.provideService(StateFileLocks, locks)))
  )

  return Result.isFailure(saved) ? failure(saved.failure._tag, saved.failure.message) : undefined
}

/**
 * The saved session is validated against Voila before the login reports
 * success, and the validated snapshot is saved through the same cycle: the
 * health check can rotate cookies, and a login that reports success while the
 * file holds a session Voila rejects is worse than a login that failed.
 */
const validateSavedSession = async (
  locks: StateFileLocksService,
  path: StateFilePath,
  session: SdkSessionSnapshot
): Promise<OperationExecutionResult> => {
  const health = await Effect.runPromise(
    Effect.result(Effect.provide(checkSessionHealth(session), nodeVoilaTransportLayer()))
  )

  if (Result.isFailure(health)) {
    return failure(health.failure._tag, health.failure.message)
  }

  const validated = await saveSession(locks, path, health.success.session)

  if (validated !== undefined) {
    return validated
  }

  return health.success.status === "active"
    ? success({ sessionPath: path, status: health.success.status })
    : failure("VoilaAuthSessionInactive", "Saved browser session is not active")
}

export const loginWithPlaywright = async (options: CliLoginOptions): Promise<OperationExecutionResult> => {
  let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>>
  // one lock table for both saves of this login flow
  const sessionLocks = Effect.runSync(makeStateFileLocks())

  try {
    context = await chromium.launchPersistentContext(options.profilePath, { headless: false })
  } catch {
    return failure("VoilaAuthBrowserLaunchFailed", "Playwright Chromium could not be launched")
  }

  try {
    const page = context.pages()[0] ?? (await context.newPage())
    const observer = observeVoilaBrowserTraffic(page)

    try {
      await page.goto(VOILA_BASE_URL, { waitUntil: "domcontentloaded" })
    } catch {
      return failure("VoilaAuthOpenFailed", "Voila could not be opened in Chromium")
    }

    process.stdout.write(
      [
        "Opened Voila in Chromium.",
        "Log in manually, then close the browser window to save the authenticated session.",
        "The CLI saves after Voila session material and cookies are captured, then validates the saved session.",
        ""
      ].join("\n")
    )

    const capture = await waitForAuthenticatedCapture(page, options.timeoutMs ?? defaultTimeoutMs, observer)

    if ("ok" in capture) {
      return capture
    }

    const session = makeSessionFromBrowserCapture(capture)

    if ("ok" in session) {
      return session
    }

    const saved = await saveSession(sessionLocks, options.sessionPath, session)

    if (saved !== undefined) {
      return saved
    }

    return await validateSavedSession(sessionLocks, options.sessionPath, session)
  } finally {
    await context.close()
  }
}
