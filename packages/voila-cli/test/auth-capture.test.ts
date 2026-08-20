import { BrowserLoginTimeoutMsSchema, VOILA_BASE_URL } from "@firfi/voila-sdk"
import { describe, expect, it } from "vitest"

import {
  captureBrowserSessionFromPort,
  observeBrowserTraffic as observeBrowserTrafficWithIdGenerator,
  observeVoilaBrowserTraffic as observeVoilaBrowserTrafficWithIdGenerator,
  parseCapturedSessionHtml as parseCapturedSessionHtmlWithIdGenerator,
  parseCapturedSessionMaterial as parseCapturedSessionMaterialWithGenerator,
  parseCapturedSessionMaterialWithIdGenerator,
  pollAuthenticatedCapture,
  readSessionMaterialFromPort as readSessionMaterialFromPortWithIdGenerator,
  waitForAuthenticatedCapture
} from "../src/auth-capture.js"

const generateSessionId = () => "generated-session-id"
const parseCapturedSessionMaterial = (payload: unknown) =>
  parseCapturedSessionMaterialWithGenerator(payload, generateSessionId)
const parseCapturedSessionHtml = (html: string) => parseCapturedSessionHtmlWithIdGenerator(html, generateSessionId)
const readSessionMaterialFromPort = (port: Parameters<typeof readSessionMaterialFromPortWithIdGenerator>[0]) =>
  readSessionMaterialFromPortWithIdGenerator(port, generateSessionId)
const observeBrowserTraffic = (port: Parameters<typeof observeBrowserTrafficWithIdGenerator>[0]) =>
  observeBrowserTrafficWithIdGenerator(port, generateSessionId)
const observeVoilaBrowserTraffic = (port: Parameters<typeof observeVoilaBrowserTrafficWithIdGenerator>[0]) =>
  observeVoilaBrowserTrafficWithIdGenerator(port, generateSessionId)

const sessionPayload = (csrfToken?: string): Readonly<Record<string, unknown>> => ({
  ...(csrfToken === undefined ? {} : { csrf: { token: csrfToken } }),
  session: {
    metadata: { assetVersion: "asset-v1", clientRouteId: "route-1", pageViewId: "view-1", regionId: "region-1" }
  }
})

const sessionHtml = (payload: Readonly<Record<string, unknown>>): string =>
  `<script>window.__INITIAL_STATE__ = ${JSON.stringify(payload)};</script>`

const validCookie = { domain: ".voila.ca", name: "userEmail", path: "/", value: "account@example.test" }

const getMaterial = (payload: Readonly<Record<string, unknown>>) => {
  const material = parseCapturedSessionMaterial(payload)

  if (material === undefined) {
    throw new Error("test payload should produce session material")
  }

  return material
}

describe("authenticated browser capture parsing", () => {
  it("parses session metadata, CSRF state, and fallback region metadata", () => {
    const payload = {
      data: { basket: { regionId: "basket-region" } },
      session: { csrf: { token: "nested-csrf" }, metadata: { assetVersion: "asset-v1" } }
    }
    const material = parseCapturedSessionMaterial(payload)

    expect(material?.metadata.assetVersion).toBe("asset-v1")
    expect(material?.metadata.regionId).toBe("basket-region")
    expect(material?.metadata.clientRouteId).toMatch(/^[-\w]+$/)
    expect(material?.metadata.pageViewId).toMatch(/^[-\w]+$/)
    expect(material?.csrfToken).toBe("nested-csrf")
  })

  it("uses the injected ID generator for missing browser metadata identifiers", () => {
    let nextId = 0
    const material = parseCapturedSessionMaterialWithIdGenerator(
      { data: { basket: { regionId: "basket-region" } }, session: { metadata: { assetVersion: "asset-v1" } } },
      () => `generated-${++nextId}`
    )

    expect(material?.metadata).toEqual({
      assetVersion: "asset-v1",
      clientRouteId: "generated-1",
      pageViewId: "generated-2",
      regionId: "basket-region"
    })
  })

  it("rejects incomplete payloads and malformed initial-state HTML", () => {
    expect(parseCapturedSessionMaterial(undefined)).toBeUndefined()
    expect(parseCapturedSessionMaterial({ session: { metadata: {} } })).toBeUndefined()
    expect(parseCapturedSessionHtml("<html>without initial state</html>")).toBeUndefined()
    expect(parseCapturedSessionHtml(sessionHtml(sessionPayload("csrf-1")))?.csrfToken).toBe("csrf-1")
  })

  it("falls back from runtime state to page HTML and fetched HTML", async () => {
    const material = getMaterial(sessionPayload("runtime-csrf"))
    const fromRuntime = await readSessionMaterialFromPort({
      fetchedHtml: async () => sessionHtml(sessionPayload("fetched-csrf")),
      html: async () => sessionHtml(sessionPayload("html-csrf")),
      runtimeState: async () => sessionPayload("runtime-csrf")
    })
    const fromInvalidRuntime = await readSessionMaterialFromPort({
      fetchedHtml: async () => sessionHtml(sessionPayload("fetched-after-invalid-runtime-csrf")),
      html: async () => sessionHtml(sessionPayload("html-after-invalid-runtime-csrf")),
      runtimeState: async () => ({ session: { metadata: {} } })
    })
    const fromHtml = await readSessionMaterialFromPort({
      fetchedHtml: async () => sessionHtml(sessionPayload("fetched-csrf")),
      html: async () => sessionHtml(sessionPayload("html-csrf")),
      runtimeState: async () => null
    })
    const fromFetched = await readSessionMaterialFromPort({
      fetchedHtml: async () => sessionHtml(sessionPayload("fetched-csrf")),
      html: async () => "<html>not initialized</html>",
      runtimeState: async () => undefined
    })
    const absent = await readSessionMaterialFromPort({
      fetchedHtml: async () => "<html>not initialized</html>",
      html: async () => "<html>not initialized</html>",
      runtimeState: async () => undefined
    })

    expect(fromRuntime).toEqual(material)
    expect(fromInvalidRuntime?.csrfToken).toBe("html-after-invalid-runtime-csrf")
    expect(fromHtml?.csrfToken).toBe("html-csrf")
    expect(fromFetched?.csrfToken).toBe("fetched-csrf")
    expect(absent).toBeUndefined()
  })

  it("captures valid cookies and rejects closed, absent-material, and invalid-cookie ports", async () => {
    const material = getMaterial(sessionPayload("csrf-1"))
    const captured = await captureBrowserSessionFromPort({
      cookies: async () => [validCookie],
      isClosed: () => false,
      material: async () => material
    })
    const observed = await captureBrowserSessionFromPort(
      { cookies: async () => [validCookie], isClosed: () => false, material: async () => undefined },
      material
    )
    const absent = await captureBrowserSessionFromPort({
      cookies: async () => [validCookie],
      isClosed: () => false,
      material: async () => undefined
    })
    const invalidCookies = await captureBrowserSessionFromPort({
      cookies: async () => [{ name: "missing-required-fields" }],
      isClosed: () => false,
      material: async () => material
    })
    const closed = await captureBrowserSessionFromPort({
      cookies: async () => [validCookie],
      isClosed: () => true,
      material: async () => material
    })

    expect(captured).toEqual({ cookies: [validCookie], material })
    expect(observed).toEqual({ cookies: [validCookie], material })
    expect(absent).toBeUndefined()
    expect(invalidCookies).toBeUndefined()
    expect(closed).toBeUndefined()
  })
})

describe("browser traffic observation", () => {
  it("records same-origin session payloads and request CSRF headers while ignoring foreign traffic", async () => {
    type Request = { readonly headers: () => Readonly<Record<string, string>>; readonly url: () => string }
    type Response = {
      readonly headers: () => Readonly<Record<string, string>>
      readonly responseText: () => Promise<string>
      readonly url: () => string
    }
    let requestListener: ((request: Request) => void) | undefined
    let responseListener: ((response: Response) => Promise<void>) | undefined
    const observer = observeBrowserTraffic({
      onRequest: (listener) => {
        requestListener = listener
      },
      onResponse: (listener) => {
        responseListener = listener
      }
    })

    if (requestListener === undefined || responseListener === undefined) {
      throw new Error("observer should install both traffic listeners")
    }

    requestListener({ headers: () => ({ "x-csrf-token": "csrf-header" }), url: () => "not-a-url" })
    requestListener({ headers: () => ({}), url: () => "https://other.example/request" })
    requestListener({ headers: () => ({}), url: () => VOILA_BASE_URL })
    await responseListener({
      headers: () => ({ "content-type": "text/html" }),
      responseText: async () => sessionHtml(sessionPayload()),
      url: () => "https://other.example/response"
    })
    await responseListener({
      headers: () => ({ "content-type": "application/json" }),
      responseText: async () => sessionHtml(sessionPayload()),
      url: () => VOILA_BASE_URL
    })
    await responseListener({
      headers: () => ({ "content-type": "text/html" }),
      responseText: async () => "<html>invalid</html>",
      url: () => VOILA_BASE_URL
    })
    await responseListener({
      headers: () => ({ "content-type": "text/html" }),
      responseText: async () => sessionHtml(sessionPayload()),
      url: () => VOILA_BASE_URL
    })
    await responseListener({
      headers: () => ({ "content-type": "text/html" }),
      responseText: async () => {
        throw new Error("response body unavailable")
      },
      url: () => VOILA_BASE_URL
    })
    requestListener({ headers: () => ({ "x-csrf-token": "csrf-header" }), url: () => VOILA_BASE_URL })

    expect(observer.hasPayload()).toBe(true)
    expect(observer.getMaterial()).toMatchObject({ csrfToken: "csrf-header", metadata: { regionId: "region-1" } })

    const delegatedObserver = observeVoilaBrowserTraffic({
      onRequest: (listener) => {
        requestListener = listener
      },
      onResponse: (listener) => {
        responseListener = listener
      }
    })

    expect(delegatedObserver.getMaterial()).toBeUndefined()
  })

  it("covers payloads without material, missing content type, and CSRF carry-forward", async () => {
    let requestListener:
      | ((request: { readonly headers: () => Readonly<Record<string, string>>; readonly url: () => string }) => void)
      | undefined
    let responseListener:
      | ((response: {
          readonly headers: () => Readonly<Record<string, string>>
          readonly responseText: () => Promise<string>
          readonly url: () => string
        }) => Promise<void>)
      | undefined
    const observer = observeBrowserTraffic({
      onRequest: (listener) => {
        requestListener = listener
      },
      onResponse: (listener) => {
        responseListener = listener
      }
    })

    if (requestListener === undefined || responseListener === undefined) {
      throw new Error("observer should install both traffic listeners")
    }

    await responseListener({
      headers: () => ({}),
      responseText: async () => sessionHtml({ session: { metadata: {} } }),
      url: () => VOILA_BASE_URL
    })
    await responseListener({
      headers: () => ({ "content-type": "text/html" }),
      responseText: async () => sessionHtml(sessionPayload()),
      url: () => VOILA_BASE_URL
    })
    requestListener({ headers: () => ({ "x-csrf-token": "csrf-after-material" }), url: () => VOILA_BASE_URL })

    let carryRequestListener:
      | ((request: { readonly headers: () => Readonly<Record<string, string>>; readonly url: () => string }) => void)
      | undefined
    let carryResponseListener:
      | ((response: {
          readonly headers: () => Readonly<Record<string, string>>
          readonly responseText: () => Promise<string>
          readonly url: () => string
        }) => Promise<void>)
      | undefined
    observeBrowserTraffic({
      onRequest: (listener) => {
        carryRequestListener = listener
      },
      onResponse: (listener) => {
        carryResponseListener = listener
      }
    })

    if (carryRequestListener === undefined || carryResponseListener === undefined) {
      throw new Error("carry observer should install both traffic listeners")
    }

    carryRequestListener({ headers: () => ({ "x-csrf-token": "csrf-before-material" }), url: () => VOILA_BASE_URL })
    await carryResponseListener({
      headers: () => ({ "content-type": "text/html" }),
      responseText: async () => sessionHtml(sessionPayload()),
      url: () => VOILA_BASE_URL
    })

    expect(observer.getMaterial()).toMatchObject({ csrfToken: "csrf-after-material" })
  })
})

describe("authenticated browser capture polling", () => {
  it("uses the injected delay deterministically while waiting for session material", async () => {
    let delays: ReadonlyArray<number> = []
    const result = await pollAuthenticatedCapture(
      { capture: async () => undefined, isClosed: () => false },
      BrowserLoginTimeoutMsSchema.make(4_000),
      { getMaterial: () => undefined, hasPayload: () => false },
      () => undefined,
      async (milliseconds) => {
        delays = [...delays, milliseconds]
      }
    )

    expect(result).toEqual({
      error: { _tag: "VoilaAuthTimedOut", message: "Interactive browser login timed out" },
      ok: false
    })
    expect(delays).toEqual([2_000, 2_000])
  })

  it("reports closed pages and emits progress for observed payloads and captures", async () => {
    const material = getMaterial(sessionPayload("csrf-1"))
    const captured = { cookies: [validCookie], material }
    let closedChecks = 0
    let progress: ReadonlyArray<string> = []
    const closedAfterCapture = await pollAuthenticatedCapture(
      {
        capture: async () => captured,
        isClosed: () => {
          closedChecks += 1
          return closedChecks > 1
        }
      },
      BrowserLoginTimeoutMsSchema.make(4_000),
      { getMaterial: () => undefined, hasPayload: () => false },
      (message) => {
        progress = [...progress, message]
      },
      async () => undefined
    )
    const observedPayload = await pollAuthenticatedCapture(
      { capture: async () => undefined, isClosed: () => false },
      BrowserLoginTimeoutMsSchema.make(4_000),
      { getMaterial: () => undefined, hasPayload: () => true },
      (message) => {
        progress = [...progress, message]
      },
      async () => undefined
    )
    const immediatelyClosed = await pollAuthenticatedCapture(
      { capture: async () => undefined, isClosed: () => true },
      BrowserLoginTimeoutMsSchema.make(2_000),
      { getMaterial: () => undefined, hasPayload: () => false },
      () => undefined,
      async () => undefined
    )
    const unauthenticatedCapture = await pollAuthenticatedCapture(
      {
        capture: async () => ({
          cookies: [{ ...validCookie, name: "visitor" }],
          material: getMaterial(sessionPayload())
        }),
        isClosed: () => false
      },
      BrowserLoginTimeoutMsSchema.make(2_000),
      { getMaterial: () => undefined, hasPayload: () => false },
      (message) => {
        progress = [...progress, message]
      },
      async () => undefined
    )
    let unauthenticatedClosedChecks = 0
    const unauthenticatedClosed = await pollAuthenticatedCapture(
      {
        capture: async () => ({
          cookies: [{ ...validCookie, name: "visitor" }],
          material: getMaterial(sessionPayload("guest-csrf"))
        }),
        isClosed: () => {
          unauthenticatedClosedChecks += 1
          return unauthenticatedClosedChecks > 1
        }
      },
      BrowserLoginTimeoutMsSchema.make(4_000),
      { getMaterial: () => undefined, hasPayload: () => false },
      () => undefined,
      async () => undefined
    )

    expect(closedAfterCapture).toEqual(captured)
    expect(observedPayload).toMatchObject({ error: { _tag: "VoilaAuthTimedOut" }, ok: false })
    expect(immediatelyClosed).toMatchObject({ error: { _tag: "VoilaAuthInitialStateCaptureFailed" }, ok: false })
    expect(unauthenticatedCapture).toMatchObject({ error: { _tag: "VoilaAuthTimedOut" }, ok: false })
    expect(unauthenticatedClosed).toMatchObject({ error: { _tag: "VoilaAuthNotAuthenticated" }, ok: false })
    expect(progress.some((message) => message.includes("Authenticated cookie observed. CSRF token observed."))).toBe(
      true
    )
    expect(
      progress.some((message) =>
        message.includes("Voila page state observed; waiting for session metadata and cookies.")
      )
    ).toBe(true)
    expect(progress.some((message) => message.includes("Authenticated cookie not observed;"))).toBe(true)
    expect(progress.some((message) => message.includes("CSRF token not observed."))).toBe(true)
  })

  it("captures through the browser page port and treats a throwing closed check as closed", async () => {
    const material = getMaterial(sessionPayload("runtime-csrf"))
    let closedChecks = 0
    const captured = await waitForAuthenticatedCapture(
      {
        cookies: async () => [validCookie],
        fetchedHtml: async () => sessionHtml(sessionPayload()),
        html: async () => sessionHtml(sessionPayload()),
        isClosed: () => {
          closedChecks += 1
          return closedChecks > 2
        },
        runtimeState: async () => sessionPayload("runtime-csrf")
      },
      BrowserLoginTimeoutMsSchema.make(4_000),
      { getMaterial: () => undefined, hasPayload: () => true },
      () => undefined,
      async () => undefined,
      generateSessionId
    )
    const closed = await waitForAuthenticatedCapture(
      {
        cookies: async () => [validCookie],
        fetchedHtml: async () => sessionHtml(sessionPayload()),
        html: async () => sessionHtml(sessionPayload()),
        isClosed: () => {
          throw new Error("closed page")
        },
        runtimeState: async () => sessionPayload()
      },
      BrowserLoginTimeoutMsSchema.make(2_000),
      { getMaterial: () => undefined, hasPayload: () => false },
      () => undefined,
      async () => undefined,
      generateSessionId
    )

    expect(captured).toEqual({ cookies: [validCookie], material })
    expect(closed).toMatchObject({ error: { _tag: "VoilaAuthInitialStateCaptureFailed" }, ok: false })
  })
})
