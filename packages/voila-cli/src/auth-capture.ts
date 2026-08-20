import { type OperationExecutionResult } from "@firfi/voila-mcp"
import {
  type BrowserLoginBrowserCookie,
  BrowserLoginBrowserCookieArraySchema,
  type BrowserLoginTimeoutMs,
  extractInitialStatePayload,
  SessionMetadataSchema,
  VOILA_BASE_URL
} from "@firfi/voila-sdk"
import { Result, Schema } from "effect"

import { BrowserPollDelayMsSchema, type BrowserPollDelayMs, type CliDelay, type CliStderrWriter } from "./cli-model.js"

const authenticatedCookieName = "userEmail"
const browserPollDelayMilliseconds = 2_000
const pollIntervalMs: BrowserPollDelayMs = BrowserPollDelayMsSchema.make(browserPollDelayMilliseconds)
const progressEveryAttempts = 5

const NonEmptyCaptureStringSchema = Schema.String.check(
  Schema.makeFilter((value) => value.trim().length > 0, { message: "Capture string must not be empty" })
)

const CapturedMetadataSourceSchema = Schema.Struct({
  assetVersion: NonEmptyCaptureStringSchema,
  clientRouteId: Schema.optionalKey(NonEmptyCaptureStringSchema),
  pageViewId: Schema.optionalKey(NonEmptyCaptureStringSchema),
  regionId: Schema.optionalKey(NonEmptyCaptureStringSchema)
})

const CapturedPayloadSchema = Schema.Struct({
  csrf: Schema.optionalKey(Schema.Struct({ token: NonEmptyCaptureStringSchema })),
  data: Schema.optionalKey(
    Schema.Struct({ basket: Schema.optionalKey(Schema.Struct({ regionId: NonEmptyCaptureStringSchema })) })
  ),
  session: Schema.Struct({
    csrf: Schema.optionalKey(Schema.Struct({ token: NonEmptyCaptureStringSchema })),
    metadata: CapturedMetadataSourceSchema
  })
})
type CapturedPayload = Schema.Schema.Type<typeof CapturedPayloadSchema>

const CapturedSessionMaterialSchema = Schema.Struct({
  csrfToken: Schema.optionalKey(NonEmptyCaptureStringSchema),
  metadata: SessionMetadataSchema
})

type CapturedSessionMaterial = Schema.Schema.Type<typeof CapturedSessionMaterialSchema>

const CapturedBrowserSessionSchema = Schema.Struct({
  cookies: BrowserLoginBrowserCookieArraySchema,
  material: CapturedSessionMaterialSchema
})

export type CapturedBrowserSession = Schema.Schema.Type<typeof CapturedBrowserSessionSchema>

interface BrowserCaptureObserver {
  readonly getMaterial: () => CapturedSessionMaterial | undefined
  readonly hasPayload: () => boolean
}

interface BrowserTrafficRequest {
  readonly headers: () => Readonly<Record<string, string>>
  readonly url: () => string
}

interface BrowserTrafficResponse {
  readonly headers: () => Readonly<Record<string, string>>
  readonly responseText: () => Promise<string>
  readonly url: () => string
}

interface BrowserTrafficPort {
  readonly onRequest: (listener: (request: BrowserTrafficRequest) => void) => void
  readonly onResponse: (listener: (response: BrowserTrafficResponse) => Promise<void>) => void
}

interface BrowserMaterialPort {
  readonly fetchedHtml: () => Promise<string>
  readonly html: () => Promise<string>
  readonly runtimeState: () => Promise<unknown>
}

interface BrowserSessionPort {
  readonly cookies: () => Promise<unknown>
  readonly isClosed: () => boolean
  readonly material: () => Promise<CapturedSessionMaterial | undefined>
}

interface BrowserSessionPagePort {
  readonly cookies: () => Promise<unknown>
  readonly fetchedHtml: () => Promise<string>
  readonly html: () => Promise<string>
  readonly isClosed: () => boolean
  readonly runtimeState: () => Promise<unknown>
}

export type SessionIdGenerator = () => string
type AuthFailure = Extract<OperationExecutionResult, { readonly ok: false }>

const failure = (tag: string, message: string): AuthFailure => ({ error: { _tag: tag, message }, ok: false })

const cookiesSayAuthenticated = (cookies: ReadonlyArray<BrowserLoginBrowserCookie>): boolean =>
  cookies.some((cookie) => cookie.name === authenticatedCookieName)

const pageIsClosed = (page: BrowserSessionPagePort): boolean => {
  try {
    return page.isClosed()
  } catch {
    return true
  }
}

const capturedId = (observed: string | undefined, generateSessionId: SessionIdGenerator): string =>
  observed ?? generateSessionId()

const makeCapturedSessionMaterial = (
  source: CapturedPayload,
  generateSessionId: SessionIdGenerator,
  regionId: string
): CapturedSessionMaterial | undefined => {
  const csrfToken = source.csrf?.token ?? source.session.csrf?.token
  const material = Schema.decodeUnknownResult(CapturedSessionMaterialSchema)({
    metadata: {
      assetVersion: source.session.metadata.assetVersion,
      clientRouteId: capturedId(source.session.metadata.clientRouteId, generateSessionId),
      pageViewId: capturedId(source.session.metadata.pageViewId, generateSessionId),
      regionId
    },
    ...(csrfToken === undefined ? {} : { csrfToken })
  })

  return Result.isSuccess(material) ? material.success : undefined
}

export const parseCapturedSessionMaterialWithIdGenerator = (
  payload: unknown,
  generateSessionId: SessionIdGenerator
): CapturedSessionMaterial | undefined => {
  const decoded = Schema.decodeUnknownResult(CapturedPayloadSchema)(payload)

  if (Result.isFailure(decoded)) {
    return undefined
  }

  const source = decoded.success
  const regionId = source.session.metadata.regionId ?? source.data?.basket?.regionId

  if (regionId === undefined) {
    return undefined
  }

  return makeCapturedSessionMaterial(source, generateSessionId, regionId)
}

export const parseCapturedSessionMaterial = parseCapturedSessionMaterialWithIdGenerator

export const parseCapturedSessionHtml = (
  html: string,
  generateSessionId: SessionIdGenerator
): CapturedSessionMaterial | undefined => {
  const payload = extractInitialStatePayload(html)

  return Result.isSuccess(payload) ? parseCapturedSessionMaterial(payload.success, generateSessionId) : undefined
}

export const readSessionMaterialFromPort = async (
  port: BrowserMaterialPort,
  generateSessionId: SessionIdGenerator
): Promise<CapturedSessionMaterial | undefined> => {
  const runtimeState = await port.runtimeState()

  if (runtimeState !== undefined && runtimeState !== null) {
    const runtimeMaterial = parseCapturedSessionMaterial(runtimeState, generateSessionId)

    if (runtimeMaterial !== undefined) {
      return runtimeMaterial
    }
  }

  const pageHtmlState = parseCapturedSessionHtml(await port.html(), generateSessionId)

  return pageHtmlState === undefined
    ? parseCapturedSessionHtml(await port.fetchedHtml(), generateSessionId)
    : pageHtmlState
}

export const captureBrowserSessionFromPort = async (
  port: BrowserSessionPort,
  observedMaterial?: CapturedSessionMaterial
): Promise<CapturedBrowserSession | undefined> => {
  if (port.isClosed()) {
    return undefined
  }

  const material = observedMaterial ?? (await port.material())

  if (material === undefined) {
    return undefined
  }

  const cookies = Result.mapError(
    Schema.decodeUnknownResult(BrowserLoginBrowserCookieArraySchema)(await port.cookies()),
    () => failure("VoilaAuthCookieCaptureFailed", "Voila browser cookies could not be captured")
  )

  if (Result.isFailure(cookies)) {
    return undefined
  }

  const captured = Schema.decodeUnknownResult(CapturedBrowserSessionSchema)({ cookies: cookies.success, material })

  return Result.isSuccess(captured) ? captured.success : undefined
}

const captureBrowserSession = async (
  page: BrowserSessionPagePort,
  generateSessionId: SessionIdGenerator,
  observedMaterial?: CapturedSessionMaterial
): Promise<CapturedBrowserSession | undefined> =>
  captureBrowserSessionFromPort(
    {
      cookies: page.cookies,
      isClosed: () => pageIsClosed(page),
      material: () => readSessionMaterialFromPort(page, generateSessionId)
    },
    observedMaterial
  )

export const observeBrowserTraffic = (
  port: BrowserTrafficPort,
  generateSessionId: SessionIdGenerator
): BrowserCaptureObserver => {
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

    const material = parseCapturedSessionMaterial(payload, generateSessionId)

    if (material !== undefined) {
      recordMaterial(material)
    }
  }

  port.onRequest((request) => {
    try {
      const url = new URL(request.url())

      if (url.origin !== voilaOrigin) {
        return
      }

      const csrfToken = request.headers()["x-csrf-token"]

      const decodedCsrfToken = Schema.decodeUnknownResult(NonEmptyCaptureStringSchema)(csrfToken)

      if (Result.isSuccess(decodedCsrfToken)) {
        latestCsrfToken = decodedCsrfToken.success

        if (latestMaterial !== undefined && latestMaterial.csrfToken === undefined) {
          latestMaterial = { ...latestMaterial, csrfToken: decodedCsrfToken.success }
        }
      }
    } catch {
      return
    }
  })

  port.onResponse(async (response) => {
    try {
      const url = new URL(response.url())
      const contentType = response.headers()["content-type"] ?? ""

      if (url.origin !== voilaOrigin || !contentType.includes("text/html")) {
        return
      }

      const payload = extractInitialStatePayload(await response.responseText())

      if (Result.isSuccess(payload)) {
        recordPayload(payload.success)
      }
    } catch {
      return
    }
  })

  return { getMaterial: () => latestMaterial, hasPayload: () => payloadObserved }
}

export const observeVoilaBrowserTraffic = observeBrowserTraffic

interface AuthenticatedCapturePollPort {
  readonly capture: () => Promise<CapturedBrowserSession | undefined>
  readonly isClosed: () => boolean
}

export const pollAuthenticatedCapture = async (
  port: AuthenticatedCapturePollPort,
  timeoutMs: BrowserLoginTimeoutMs,
  observer: BrowserCaptureObserver,
  writeProgress: CliStderrWriter,
  delay: CliDelay
): Promise<CapturedBrowserSession | AuthFailure> => {
  const attempts = Math.max(1, Math.ceil(timeoutMs / pollIntervalMs))
  let latestCapture: CapturedBrowserSession | undefined

  for (let remaining = attempts; remaining > 0; remaining -= 1) {
    if (port.isClosed()) {
      return latestCapture === undefined
        ? failure("VoilaAuthInitialStateCaptureFailed", "Voila authenticated homepage state could not be captured")
        : latestCapture
    }

    const capture = await port.capture()

    if (capture !== undefined) {
      latestCapture = capture
    }

    if ((attempts - remaining) % progressEveryAttempts === 0) {
      if (latestCapture !== undefined) {
        const authStatus = cookiesSayAuthenticated(latestCapture.cookies)
          ? "Authenticated cookie observed."
          : "Authenticated cookie not observed; saved session will be verified after close."
        const csrfStatus =
          latestCapture.material.csrfToken === undefined ? "CSRF token not observed." : "CSRF token observed."

        writeProgress(
          `Voila session material observed. ${authStatus} ${csrfStatus} Close the browser window to save.\n`
        )
      } else if (observer.hasPayload()) {
        writeProgress("Voila page state observed; waiting for session metadata and cookies.\n")
      } else {
        writeProgress("Waiting for Voila page state. Finish login in the browser, then close it to save.\n")
      }
    }

    await delay(pollIntervalMs)
  }

  return failure("VoilaAuthTimedOut", "Interactive browser login timed out")
}

export const waitForAuthenticatedCapture = async (
  page: BrowserSessionPagePort,
  timeoutMs: BrowserLoginTimeoutMs,
  observer: BrowserCaptureObserver,
  writeProgress: CliStderrWriter,
  delay: CliDelay,
  generateSessionId: SessionIdGenerator
): Promise<CapturedBrowserSession | AuthFailure> =>
  pollAuthenticatedCapture(
    {
      capture: () => captureBrowserSession(page, generateSessionId, observer.getMaterial()),
      isClosed: () => pageIsClosed(page)
    },
    timeoutMs,
    observer,
    writeProgress,
    delay
  )
