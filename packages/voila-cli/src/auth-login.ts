import { fetchVoilaTransport, type OperationExecutionResult } from "@firfi/voila-mcp"
import {
  type BrowserLoginBrowserCookie,
  checkSessionHealth,
  makeAuthenticatedSdkSessionSnapshot,
  makeSessionSnapshot,
  saveSdkSessionSnapshot,
  type SdkSessionSnapshot,
  type SessionStoragePort,
  toughCookieJarPort,
  VOILA_BASE_URL
} from "@firfi/voila-sdk"
import { Either } from "effect"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { chromium } from "playwright"

import { type CapturedBrowserSession, observeVoilaBrowserTraffic, waitForAuthenticatedCapture } from "./auth-capture.js"
import type { CliLoginOptions } from "./cli.js"

const defaultTimeoutMs = 300_000
const millisecondsPerSecond = 1000
const sessionCookieExpires = -1
const readonlyCsrfFallback = "csrf-not-observed-readonly"

const failure = (tag: string, message: string): OperationExecutionResult => ({
  error: {
    _tag: tag,
    message
  },
  ok: false
})

const success = (value: unknown): OperationExecutionResult => ({
  ok: true,
  value
})

const makeFileStorage = (path: string): SessionStoragePort => ({
  read: () => readFile(path, "utf8"),
  write: async (contents) => {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, contents, { mode: 0o600 })
  }
})

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

  if (Either.isLeft(cookieJar)) {
    return failure("VoilaAuthCookieCaptureFailed", "Voila browser cookies could not be captured")
  }

  const session = makeSessionSnapshot(
    capture.material.metadata,
    { token: capture.material.csrfToken ?? readonlyCsrfFallback },
    cookieJar.right
  )

  if (Either.isLeft(session)) {
    return failure("VoilaAuthSessionCaptureInvalid", "Voila browser session could not be converted to an SDK session")
  }

  const sdkSession = makeAuthenticatedSdkSessionSnapshot(
    session.right,
    capture.material.csrfToken === undefined ? "unknown-expiry" : "authenticated"
  )

  return Either.isLeft(sdkSession)
    ? failure("VoilaAuthSessionCaptureInvalid", "Voila browser session could not be converted to an SDK session")
    : sdkSession.right
}

const saveSession = async (
  path: string,
  snapshot: SdkSessionSnapshot
): Promise<OperationExecutionResult | undefined> => {
  const saved = await saveSdkSessionSnapshot(makeFileStorage(path), snapshot)

  return Either.isLeft(saved)
    ? failure(saved.left._tag, saved.left.message)
    : undefined
}

export const loginWithPlaywright = async (
  options: CliLoginOptions
): Promise<OperationExecutionResult> => {
  let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>>

  try {
    context = await chromium.launchPersistentContext(options.profilePath, {
      headless: false
    })
  } catch {
    return failure("VoilaAuthBrowserLaunchFailed", "Playwright Chromium could not be launched")
  }

  try {
    const page = context.pages()[0] ?? await context.newPage()
    const observer = observeVoilaBrowserTraffic(page)

    try {
      await page.goto(VOILA_BASE_URL, { waitUntil: "domcontentloaded" })
    } catch {
      return failure("VoilaAuthOpenFailed", "Voila could not be opened in Chromium")
    }

    process.stdout.write([
      "Opened Voila in Chromium.",
      "Log in manually, then close the browser window to save the authenticated session.",
      "The CLI saves after Voila session material and cookies are captured, then validates the saved session.",
      ""
    ].join("\n"))

    const capture = await waitForAuthenticatedCapture(page, options.timeoutMs ?? defaultTimeoutMs, observer)

    if ("ok" in capture) {
      return capture
    }

    const session = await makeSessionFromBrowserCapture(capture)

    if ("ok" in session) {
      return session
    }

    const saved = await saveSession(options.sessionPath, session)

    if (saved !== undefined) {
      return saved
    }

    const health = await checkSessionHealth(session, fetchVoilaTransport)

    if (Either.isLeft(health)) {
      return failure(health.left._tag, health.left.message)
    }

    const validated = await saveSession(options.sessionPath, health.right.session)

    if (validated !== undefined) {
      return validated
    }

    if (health.right.status !== "active") {
      return failure("VoilaAuthSessionInactive", "Saved browser session is not active")
    }

    return success({
      sessionPath: options.sessionPath,
      status: health.right.status
    })
  } finally {
    await context.close()
  }
}
