import { fetchVoilaTransport, type OperationExecutionResult } from "@firfi/voila-mcp"
import {
  type BrowserLoginBrowserCookie,
  BrowserLoginBrowserCookieArraySchema,
  checkSessionHealth,
  extractInitialStatePayload,
  makeAuthenticatedSdkSessionSnapshot,
  makeSessionSnapshot,
  parseUnknown,
  saveSdkSessionSnapshot,
  type SdkSessionSnapshot,
  type SessionMetadata,
  type SessionStoragePort,
  toughCookieJarPort,
  VOILA_BASE_URL
} from "@firfi/voila-sdk"
import { Either } from "effect"
import { randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { chromium, type Page } from "playwright"

import type { CliLoginOptions } from "./cli.js"

const defaultTimeoutMs = 300_000
const pollIntervalMs = 2_000
const millisecondsPerSecond = 1000
const sessionCookieExpires = -1
const readonlyCsrfFallback = "csrf-not-observed-readonly"

interface CapturedSessionMaterial {
  readonly csrfToken?: string
  readonly metadata: SessionMetadata
}

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

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null

const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0

const responseSaysAuthenticated = (response: unknown): boolean => {
  if (!isRecord(response)) {
    return false
  }

  if (response.authenticated === true || response.isAuthenticated === true) {
    return true
  }

  if (isRecord(response.customer) && response.customer.authenticated === true) {
    return true
  }

  return typeof response.cartId === "string" && typeof response.regionId === "string"
}

const readActiveCustomerSession = async (page: Page): Promise<unknown> =>
  page.evaluate(async () => {
    const response = await fetch("/api/customersessions/v2/sessions/active", {
      credentials: "include"
    })

    return response.json()
  })

const refreshVoilaHomepage = async (page: Page): Promise<void> => {
  await page.goto(VOILA_BASE_URL, { waitUntil: "domcontentloaded" })
}

const waitForAuthenticatedSession = async (
  page: Page,
  timeoutMs: number
): Promise<boolean> => {
  const attempts = Math.max(1, Math.ceil(timeoutMs / pollIntervalMs))

  for (let remaining = attempts; remaining > 0; remaining -= 1) {
    try {
      if (responseSaysAuthenticated(await readActiveCustomerSession(page))) {
        return true
      }
    } catch {
      // Keep polling until timeout; transient fetch failures are expected while the page navigates.
    }

    await delay(pollIntervalMs)
  }

  return false
}

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

const readNested = (
  value: unknown,
  path: ReadonlyArray<string>
): unknown => {
  let current = value

  for (const key of path) {
    if (!isRecord(current)) {
      return undefined
    }

    current = current[key]
  }

  return current
}

const pickString = (...values: ReadonlyArray<unknown>): string | undefined => {
  for (const value of values) {
    if (typeof value === "string") {
      return value
    }
  }

  return undefined
}

const normalizeMetadata = (payload: unknown): SessionMetadata | undefined => {
  const rawMetadata = readNested(payload, ["session", "metadata"])
  const basketRegionId = readNested(payload, ["data", "basket", "regionId"])

  if (!isRecord(rawMetadata)) {
    return undefined
  }

  const assetVersion = pickString(rawMetadata.assetVersion)
  const regionId = pickString(rawMetadata.regionId, basketRegionId)

  if (!isNonEmptyString(assetVersion) || !isNonEmptyString(regionId)) {
    return undefined
  }

  return {
    assetVersion,
    clientRouteId: pickString(rawMetadata.clientRouteId) ?? randomUUID(),
    pageViewId: pickString(rawMetadata.pageViewId) ?? randomUUID(),
    regionId
  }
}

const readCsrfToken = (payload: unknown): string | undefined =>
  pickString(
    readNested(payload, ["csrf", "token"]),
    readNested(payload, ["session", "csrf", "token"])
  )

const captureSessionMaterial = (payload: unknown): CapturedSessionMaterial | undefined => {
  const metadata = normalizeMetadata(payload)

  if (metadata === undefined) {
    return undefined
  }

  const csrfToken = readCsrfToken(payload)

  return {
    ...(isNonEmptyString(csrfToken) ? { csrfToken } : {}),
    metadata
  }
}

const readMaterialFromRuntime = async (
  page: Page
): Promise<CapturedSessionMaterial | undefined> => {
  const runtimeState: unknown = await page.evaluate("window.__INITIAL_STATE__")

  if (runtimeState === undefined || runtimeState === null) {
    return undefined
  }

  return captureSessionMaterial(runtimeState)
}

const readMaterialFromHtml = (html: string): CapturedSessionMaterial | undefined => {
  const payload = extractInitialStatePayload(html)

  return Either.isRight(payload) ? captureSessionMaterial(payload.right) : undefined
}

const readMaterialFromFetchedHtml = async (
  page: Page
): Promise<CapturedSessionMaterial | undefined> => {
  const html = await page.evaluate(async () => {
    const response = await fetch("/", {
      credentials: "include"
    })

    return response.text()
  })

  return readMaterialFromHtml(html)
}

const readSessionMaterialFromBrowser = async (
  page: Page
): Promise<CapturedSessionMaterial | undefined> => {
  const runtimeState = await readMaterialFromRuntime(page)

  if (runtimeState !== undefined) {
    return runtimeState
  }

  const pageHtmlState = readMaterialFromHtml(await page.content())

  if (pageHtmlState !== undefined) {
    return pageHtmlState
  }

  return readMaterialFromFetchedHtml(page)
}

const makeSessionFromBrowser = async (
  page: Page
): Promise<OperationExecutionResult | SdkSessionSnapshot> => {
  const material = await readSessionMaterialFromBrowser(page)

  if (material === undefined) {
    return failure("VoilaAuthInitialStateCaptureFailed", "Voila authenticated homepage state could not be captured")
  }

  const cookies = Either.mapLeft(
    parseUnknown(BrowserLoginBrowserCookieArraySchema, await page.context().cookies(VOILA_BASE_URL)),
    () => failure("VoilaAuthCookieCaptureFailed", "Voila browser cookies could not be captured")
  )

  if (Either.isLeft(cookies)) {
    return cookies.left
  }

  const jar = toughCookieJarPort.create()

  for (const cookie of cookies.right) {
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
    material.metadata,
    { token: material.csrfToken ?? readonlyCsrfFallback },
    cookieJar.right
  )

  if (Either.isLeft(session)) {
    return failure("VoilaAuthSessionCaptureInvalid", "Voila browser session could not be converted to an SDK session")
  }

  const sdkSession = makeAuthenticatedSdkSessionSnapshot(
    session.right,
    material.csrfToken === undefined ? "unknown-expiry" : "authenticated"
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

    try {
      await page.goto(VOILA_BASE_URL, { waitUntil: "domcontentloaded" })
    } catch {
      return failure("VoilaAuthOpenFailed", "Voila could not be opened in Chromium")
    }

    const authenticated = await waitForAuthenticatedSession(page, options.timeoutMs ?? defaultTimeoutMs)

    if (!authenticated) {
      return failure("VoilaAuthTimedOut", "Interactive browser login timed out")
    }

    try {
      await refreshVoilaHomepage(page)
    } catch {
      return failure("VoilaAuthHomepageRefreshFailed", "Voila authenticated homepage could not be refreshed")
    }

    const session = await makeSessionFromBrowser(page)

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
