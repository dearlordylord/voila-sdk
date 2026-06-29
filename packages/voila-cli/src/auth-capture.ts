import { type OperationExecutionResult } from "@firfi/voila-mcp"
import {
  type BrowserLoginBrowserCookie,
  BrowserLoginBrowserCookieArraySchema,
  extractInitialStatePayload,
  parseUnknown,
  type SessionMetadata,
  VOILA_BASE_URL
} from "@firfi/voila-sdk"
import { Either } from "effect"
import { randomUUID } from "node:crypto"
import { type Page } from "playwright"

const authenticatedCookieName = "userEmail"
const pollIntervalMs = 2_000
const progressEveryAttempts = 5

interface CapturedSessionMaterial {
  readonly csrfToken?: string
  readonly metadata: SessionMetadata
}

export interface CapturedBrowserSession {
  readonly cookies: ReadonlyArray<BrowserLoginBrowserCookie>
  readonly material: CapturedSessionMaterial
}

interface BrowserCaptureObserver {
  readonly getMaterial: () => CapturedSessionMaterial | undefined
  readonly hasPayload: () => boolean
}

const failure = (tag: string, message: string): OperationExecutionResult => ({
  error: {
    _tag: tag,
    message
  },
  ok: false
})

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null

const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0

const cookiesSayAuthenticated = (cookies: ReadonlyArray<BrowserLoginBrowserCookie>): boolean =>
  cookies.some((cookie) => cookie.name === authenticatedCookieName)

const pageIsClosed = (page: Page): boolean => {
  try {
    return page.isClosed()
  } catch {
    return true
  }
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

const captureBrowserSession = async (
  page: Page,
  observedMaterial?: CapturedSessionMaterial
): Promise<CapturedBrowserSession | undefined> => {
  if (pageIsClosed(page)) {
    return undefined
  }

  const material = observedMaterial ?? await readSessionMaterialFromBrowser(page)

  if (material === undefined) {
    return undefined
  }

  const cookies = Either.mapLeft(
    parseUnknown(BrowserLoginBrowserCookieArraySchema, await page.context().cookies(VOILA_BASE_URL)),
    () => failure("VoilaAuthCookieCaptureFailed", "Voila browser cookies could not be captured")
  )

  if (Either.isLeft(cookies)) {
    return undefined
  }

  return {
    cookies: cookies.right,
    material
  }
}

export const observeVoilaBrowserTraffic = (page: Page): BrowserCaptureObserver => {
  let latestCsrfToken: string | undefined
  let latestMaterial: CapturedSessionMaterial | undefined
  let payloadObserved = false
  const voilaOrigin = new URL(VOILA_BASE_URL).origin

  const recordMaterial = (material: CapturedSessionMaterial): void => {
    latestMaterial = {
      ...(material.csrfToken === undefined && latestCsrfToken !== undefined ? { csrfToken: latestCsrfToken } : {}),
      ...material
    }
  }

  const recordPayload = (payload: unknown): void => {
    payloadObserved = true

    const material = captureSessionMaterial(payload)

    if (material !== undefined) {
      recordMaterial(material)
    }
  }

  page.on("request", (request) => {
    try {
      const url = new URL(request.url())

      if (url.origin !== voilaOrigin) {
        return
      }

      const csrfToken = request.headers()["x-csrf-token"]

      if (isNonEmptyString(csrfToken)) {
        latestCsrfToken = csrfToken

        if (latestMaterial !== undefined && latestMaterial.csrfToken === undefined) {
          latestMaterial = {
            ...latestMaterial,
            csrfToken
          }
        }
      }
    } catch {
      return
    }
  })

  page.on("response", (response) => {
    void (async () => {
      try {
        const url = new URL(response.url())
        const contentType = response.headers()["content-type"] ?? ""

        if (url.origin !== voilaOrigin || !contentType.includes("text/html")) {
          return
        }

        const payload = extractInitialStatePayload(await response.text())

        if (Either.isRight(payload)) {
          recordPayload(payload.right)
        }
      } catch {
        return
      }
    })()
  })

  return {
    getMaterial: () => latestMaterial,
    hasPayload: () => payloadObserved
  }
}

export const waitForAuthenticatedCapture = async (
  page: Page,
  timeoutMs: number,
  observer: BrowserCaptureObserver
): Promise<CapturedBrowserSession | OperationExecutionResult> => {
  const attempts = Math.max(1, Math.ceil(timeoutMs / pollIntervalMs))
  let latestCapture: CapturedBrowserSession | undefined

  for (let remaining = attempts; remaining > 0; remaining -= 1) {
    if (pageIsClosed(page)) {
      return latestCapture === undefined
        ? failure("VoilaAuthInitialStateCaptureFailed", "Voila authenticated homepage state could not be captured")
        : latestCapture
    }

    const capture = await captureBrowserSession(page, observer.getMaterial())

    if (capture !== undefined) {
      latestCapture = capture
    }

    if ((attempts - remaining) % progressEveryAttempts === 0) {
      if (latestCapture !== undefined) {
        const authStatus = cookiesSayAuthenticated(latestCapture.cookies)
          ? "Authenticated cookie observed."
          : "Authenticated cookie not observed; saved session will be verified after close."
        const csrfStatus = latestCapture.material.csrfToken === undefined
          ? "CSRF token not observed."
          : "CSRF token observed."

        process.stdout.write(
          `Voila session material observed. ${authStatus} ${csrfStatus} Close the browser window to save.\n`
        )
      } else if (observer.hasPayload()) {
        process.stdout.write("Voila page state observed; waiting for session metadata and cookies.\n")
      } else {
        process.stdout.write("Waiting for Voila page state. Finish login in the browser, then close it to save.\n")
      }
    }

    await delay(pollIntervalMs)
  }

  return failure("VoilaAuthTimedOut", "Interactive browser login timed out")
}
