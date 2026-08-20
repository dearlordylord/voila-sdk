import {
  type BrowserLoginBrowserCookie,
  BrowserLoginTimeoutMsSchema,
  ActiveAuthenticatedSdkSessionSnapshotSchema,
  type ActiveAuthenticatedSdkSessionSnapshot,
  makeAuthenticatedSdkSessionSnapshot,
  makeSessionSnapshot,
  type CookieJarPort,
  type SessionMetadata,
  type SessionHealth,
  type SdkSessionSnapshot,
  SdkSessionSnapshotSchema,
  toughCookieJarPort,
  connectionFailure,
  VoilaTransport
} from "@firfi/voila-sdk"
import { StateFilePathSchema } from "@firfi/voila-session-store"
import { Effect, Layer, Result, Schema } from "effect"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import type { observeVoilaBrowserTraffic } from "../src/auth-capture.js"
import { loginWithPlaywrightWithRuntime, type LoginRuntime } from "../src/auth-login.js"
import { loginWithPlaywright } from "../src/index.js"
import {
  adapterTools,
  type AuthFailure,
  type BrowserPort,
  type SessionCapturePort,
  type SessionHealthPort,
  type SessionPersistencePort
} from "../src/auth-login-adapters.js"
import type { CliDelay, CliLoginOptions, CliStderrWriter } from "../src/cli.js"

const sessionMetadata: SessionMetadata = {
  assetVersion: "asset-v1",
  clientRouteId: "route-1",
  pageViewId: "view-1",
  regionId: "region-1"
}

const validCookie: BrowserLoginBrowserCookie = {
  domain: ".voila.ca",
  name: "userEmail",
  path: "/",
  value: "account@example.test"
}

const capture = (csrfToken?: string) => ({
  cookies: [validCookie],
  material: { ...(csrfToken === undefined ? {} : { csrfToken }), metadata: sessionMetadata }
})

const encodeSession = (session: SdkSessionSnapshot): string =>
  JSON.stringify(Schema.encodeSync(SdkSessionSnapshotSchema)(session))

const failure = (tag: string): AuthFailure => ({ error: { _tag: tag, message: "failure" }, ok: false })

const makeOptions = (name: string): CliLoginOptions => {
  const write: CliStderrWriter = () => undefined
  const delay: CliDelay = async () => undefined

  return {
    delay,
    profilePath: `/tmp/voila-profile-${name}`,
    progress: { write },
    sessionPath: StateFilePathSchema.make(`/tmp/voila-session-${name}.json`),
    timeoutMs: BrowserLoginTimeoutMsSchema.make(1)
  }
}

interface TestPage {
  readonly cookies: () => Promise<ReadonlyArray<BrowserLoginBrowserCookie>>
  readonly fetchedHtml: () => Promise<string>
  readonly goto: () => Promise<void>
  readonly html: () => Promise<string>
  readonly isClosed: () => boolean
  readonly onRequest: Parameters<typeof observeVoilaBrowserTraffic>[0]["onRequest"]
  readonly onResponse: Parameters<typeof observeVoilaBrowserTraffic>[0]["onResponse"]
  readonly runtimeState: () => Promise<unknown>
}

const makePage = (goto: () => Promise<void> = async () => undefined): TestPage => ({
  cookies: async () => [validCookie],
  fetchedHtml: async () => "",
  goto,
  html: async () => "",
  isClosed: () => false,
  onRequest: () => undefined,
  onResponse: () => undefined,
  runtimeState: async () => undefined
})

const makeBrowser = (
  page: TestPage,
  result: AuthFailure | ReturnType<typeof capture>,
  close: () => Promise<void> = async () => undefined
): BrowserPort => ({
  capture: async () => ("ok" in result ? Result.fail(result) : Result.succeed(result)),
  launchPersistentContext: async () => ({ close, newPage: async () => page, pages: () => [page] })
})

const defaultHealth: SessionHealthPort = {
  check: async () => Result.fail({ _tag: "TestHealthNotConfigured", message: "health was not configured" })
}

const defaultPersistence: SessionPersistencePort = {
  validateAndSave: async (_path, validation) => {
    const validated = await validation()
    return Result.isFailure(validated)
      ? Result.fail(failure(validated.failure._tag))
      : Result.succeed(validated.success)
  }
}

const defaultSessionCapture: SessionCapturePort = {
  constructors: { makeAuthenticatedSdkSessionSnapshot, makeSessionSnapshot },
  cookieJar: toughCookieJarPort
}

const makeRuntime = (
  browser: BrowserPort,
  health: SessionHealthPort = defaultHealth,
  persistence: SessionPersistencePort = defaultPersistence,
  sessionCapture: SessionCapturePort = defaultSessionCapture
): LoginRuntime => ({ browser, health, persistence, sessionCapture, sessionIds: { generate: () => "test-session-id" } })

const makeSdkSession = (): ActiveAuthenticatedSdkSessionSnapshot => {
  const jar = toughCookieJarPort.create()
  jar.setCookieSync("voila-session=health-cookie; Path=/; Secure; HttpOnly", "https://voila.ca/")
  const serialized = toughCookieJarPort.serialize(jar)

  if (Result.isFailure(serialized)) {
    throw new Error("Expected serialized cookie jar")
  }

  const session = makeSessionSnapshot(sessionMetadata, { token: "health-csrf" }, serialized.success)

  if (Result.isFailure(session)) {
    throw new Error("Expected session snapshot")
  }

  const sdkSession = makeAuthenticatedSdkSessionSnapshot(session.success, "authenticated")

  if (Result.isFailure(sdkSession)) {
    throw new Error("Expected authenticated session snapshot")
  }

  return Schema.decodeUnknownSync(ActiveAuthenticatedSdkSessionSnapshotSchema)(sdkSession.success)
}

describe("interactive CLI login boundary", () => {
  it("publishes only the production login entry point through the package boundary", () => {
    expect(loginWithPlaywright).toBeTypeOf("function")
  })

  it("exercises the injected Playwright page and context adapters", async () => {
    let evaluateExpression = ""
    let navigatedUrl = ""
    let requestListeners = 0
    let responseListeners = 0
    let pageClosed = false
    const rawPage: Parameters<typeof adapterTools.makePlaywrightRawPage>[0] = {
      context: () => ({ cookies: async () => [validCookie] }),
      content: async () => "<html />",
      evaluateFetchedHtml: async () => "<fetched />",
      evaluateRuntimeState: async () => {
        evaluateExpression = "window.__INITIAL_STATE__"
        return undefined
      },
      goto: async (url) => {
        navigatedUrl = url
        return undefined
      },
      isClosed: () => pageClosed,
      onRequest: (listener) => {
        requestListeners += 1
        listener({ headers: () => ({}), url: () => "https://voila.ca/" })
      },
      onResponse: (listener) => {
        responseListeners += 1
        void listener({
          headers: () => ({ "content-type": "text/html" }),
          responseText: async () => "<html />",
          url: () => "https://voila.ca/"
        })
      }
    }
    const source = rawPage
    const sourcedRawPage = adapterTools.makePlaywrightRawPage(source)

    await expect(sourcedRawPage.context().cookies("https://voila.ca/")).resolves.toEqual([validCookie])
    await expect(sourcedRawPage.content()).resolves.toBe("<html />")
    await expect(sourcedRawPage.evaluateFetchedHtml()).resolves.toBe("<fetched />")
    await expect(sourcedRawPage.evaluateRuntimeState()).resolves.toBeUndefined()
    await expect(sourcedRawPage.goto("https://voila.ca/", { waitUntil: "domcontentloaded" })).resolves.toBeUndefined()
    sourcedRawPage.onRequest(() => undefined)
    sourcedRawPage.onResponse(async () => undefined)
    expect(sourcedRawPage.isClosed()).toBe(false)

    const sourcePage = adapterTools.makePlaywrightPageSource(rawPage)
    await expect(sourcePage.context().cookies("https://voila.ca/")).resolves.toEqual([validCookie])
    await expect(sourcePage.content()).resolves.toBe("<html />")
    await expect(sourcePage.evaluateFetchedHtml()).resolves.toBe("<fetched />")
    await expect(sourcePage.evaluateRuntimeState()).resolves.toBeUndefined()
    await expect(sourcePage.goto("https://voila.ca/", { waitUntil: "domcontentloaded" })).resolves.toBeUndefined()
    sourcePage.onRequest(() => undefined)
    sourcePage.onResponse(async () => undefined)
    expect(sourcePage.isClosed()).toBe(false)

    let nativeRequests = 0
    let nativeResponses = 0
    const nativeSourcePage = adapterTools.makePlaywrightPageSource({
      content: async () => "<native />",
      context: () => ({ cookies: async () => [validCookie] }),
      evaluate: async () => {
        throw new Error("native evaluation stopped")
      },
      goto: async () => undefined,
      isClosed: () => false,
      onRequestSource: (listener) =>
        listener({ headers: () => ({ accept: "text/html" }), url: () => "https://voila.ca/request" }),
      onResponseSource: (listener) =>
        listener({
          headers: () => ({ "content-type": "text/html" }),
          text: async () => "<response />",
          url: () => "https://voila.ca/response"
        })
    })
    await expect(nativeSourcePage.evaluateFetchedHtml()).rejects.toThrow("native evaluation stopped")
    await expect(nativeSourcePage.evaluateRuntimeState()).rejects.toThrow("native evaluation stopped")
    nativeSourcePage.onRequest((request) => {
      nativeRequests += 1
      expect(request.headers()).toEqual({ accept: "text/html" })
      expect(request.url()).toBe("https://voila.ca/request")
    })
    nativeSourcePage.onResponse(async (response) => {
      nativeResponses += 1
      expect(response.headers()).toEqual({ "content-type": "text/html" })
      await expect(response.responseText()).resolves.toBe("<response />")
      expect(response.url()).toBe("https://voila.ca/response")
    })
    expect(nativeRequests).toBe(1)
    expect(nativeResponses).toBe(1)

    const actions = adapterTools.makePlaywrightPageActions(sourcedRawPage)
    const page = adapterTools.makePlaywrightPage(actions)

    await expect(page.context().cookies("https://voila.ca/")).resolves.toEqual([validCookie])
    await expect(page.content()).resolves.toBe("<html />")
    await expect(page.evaluateFetchedHtml()).resolves.toBe("<fetched />")
    await expect(page.evaluateRuntimeState()).resolves.toBeUndefined()
    await expect(page.goto("https://voila.ca/", { waitUntil: "domcontentloaded" })).resolves.toBeUndefined()
    page.onRequest(() => undefined)
    page.onResponse(async () => undefined)
    expect(page.isClosed()).toBe(false)
    expect(evaluateExpression).toBe("window.__INITIAL_STATE__")
    expect(navigatedUrl).toBe("https://voila.ca/")
    expect(requestListeners).toBe(3)
    expect(responseListeners).toBe(3)

    let defaultContextClosed = false
    const defaultLauncher = adapterTools.makeDefaultPlaywrightLauncher({
      launchPersistentContext: async (profilePath, options) => {
        expect(profilePath).toBe("/tmp/default-profile")
        expect(options).toEqual({ headless: false })

        return {
          close: async () => {
            defaultContextClosed = true
          },
          newPage: async () => rawPage,
          pages: () => [rawPage]
        }
      }
    })
    const defaultContext = await defaultLauncher.launchPersistentContext("/tmp/default-profile")
    expect(defaultContext.pages()).toHaveLength(1)
    await defaultContext.newPage()
    await defaultContext.close()
    expect(defaultContextClosed).toBe(true)

    const launcher = adapterTools.makePlaywrightLauncher(async () => ({
      close: async () => undefined,
      newPage: async () => actions,
      pages: () => [actions]
    }))
    const context = await launcher.launchPersistentContext("/tmp/profile")
    expect(context.pages()).toHaveLength(1)
    await context.newPage()
    await context.close()

    pageClosed = true
    const browser = adapterTools.makeBrowserPort(launcher)
    const browserContext = await browser.launchPersistentContext("/tmp/profile")
    const browserPage = browserContext.pages().at(0)

    if (browserPage === undefined) {
      throw new Error("Expected a browser page")
    }

    const captureResult = await browser.capture(
      browserPage,
      BrowserLoginTimeoutMsSchema.make(1),
      { getMaterial: () => undefined, hasPayload: () => false },
      () => undefined,
      async () => undefined,
      () => "test-session-id"
    )

    expect(captureResult).toMatchObject({
      _tag: "Failure",
      failure: { error: { _tag: "VoilaAuthInitialStateCaptureFailed" }, ok: false }
    })
  })

  it("uses the injected default launcher seam without starting Chromium", async () => {
    const page = {
      content: async () => "",
      context: () => ({ cookies: async () => [validCookie] }),
      evaluateFetchedHtml: async () => "",
      evaluateRuntimeState: async () => undefined,
      goto: async (_url: string, _options: { readonly waitUntil: "domcontentloaded" }) => undefined,
      isClosed: () => false,
      onRequest: () => undefined,
      onResponse: () => undefined
    }
    const browser = adapterTools.makeBrowserPort(
      {
        launchPersistentContext: async () => ({
          close: async () => undefined,
          newPage: async () => page,
          pages: () => []
        })
      },
      async () => Result.fail(failure("VoilaAuthTimedOut"))
    )
    const result = await loginWithPlaywrightWithRuntime(makeOptions("default-launcher-seam"), makeRuntime(browser))

    expect(result).toMatchObject({ error: { _tag: "VoilaAuthTimedOut" }, ok: false })
  })

  it("reports browser launch failure without opening or closing a context", async () => {
    const options = makeOptions("launch-failure")
    let closeCalls = 0
    const result = await loginWithPlaywrightWithRuntime(
      options,
      makeRuntime({
        capture: async () => Result.fail(failure("capture-not-reached")),
        launchPersistentContext: async () => {
          throw new Error("Chromium unavailable")
        }
      })
    )

    closeCalls += 0
    expect(result).toEqual({
      error: { _tag: "VoilaAuthBrowserLaunchFailed", message: "Playwright Chromium could not be launched" },
      ok: false
    })
    expect(closeCalls).toBe(0)
  })

  it("reports page navigation failure and always closes an opened context", async () => {
    const options = makeOptions("open-failure")
    let closeCalls = 0
    const page = makePage(async () => {
      throw new Error("Voila unavailable")
    })
    const result = await loginWithPlaywrightWithRuntime(
      options,
      makeRuntime(
        makeBrowser(page, failure("capture-not-reached"), async () => {
          closeCalls += 1
        })
      )
    )

    expect(result).toMatchObject({ error: { _tag: "VoilaAuthOpenFailed" }, ok: false })
    expect(closeCalls).toBe(1)
  })

  it("returns capture failures and closes the browser", async () => {
    const options = makeOptions("capture-failure")
    let closeCalls = 0
    const page = makePage()
    const result = await loginWithPlaywrightWithRuntime(
      options,
      makeRuntime(
        makeBrowser(page, failure("VoilaAuthTimedOut"), async () => {
          closeCalls += 1
        })
      )
    )

    expect(result).toMatchObject({ error: { _tag: "VoilaAuthTimedOut" }, ok: false })
    expect(closeCalls).toBe(1)
  })

  it("opens a new page when a persistent context has no existing page", async () => {
    const options = makeOptions("new-page")
    let newPageCalls = 0
    const page = makePage()
    const result = await loginWithPlaywrightWithRuntime(
      options,
      makeRuntime({
        capture: async () => Result.fail(failure("VoilaAuthTimedOut")),
        launchPersistentContext: async () => ({
          close: async () => undefined,
          newPage: async () => {
            newPageCalls += 1
            return page
          },
          pages: () => []
        })
      })
    )

    expect(result).toMatchObject({ error: { _tag: "VoilaAuthTimedOut" }, ok: false })
    expect(newPageCalls).toBe(1)
  })

  it("rejects a malformed browser cookie before persistence", async () => {
    const options = makeOptions("cookie-failure")
    let saveCalls = 0
    const result = await loginWithPlaywrightWithRuntime(
      options,
      makeRuntime(
        makeBrowser(makePage(), {
          cookies: [{ ...validCookie, domain: "invalid domain" }],
          material: capture("csrf").material
        }),
        defaultHealth,
        {
          validateAndSave: async () => {
            saveCalls += 1
            return Result.fail(failure("UnexpectedPersistence"))
          }
        }
      )
    )

    expect(result).toMatchObject({ error: { _tag: "VoilaAuthCookieCaptureFailed" }, ok: false })
    expect(saveCalls).toBe(0)
  })

  it("does not persist a browser capture without authenticated cookie evidence", async () => {
    const options = makeOptions("guest-capture")
    let saveCalls = 0
    const result = await loginWithPlaywrightWithRuntime(
      options,
      makeRuntime(
        makeBrowser(makePage(), {
          cookies: [{ ...validCookie, name: "visitor" }],
          material: capture("guest-csrf").material
        }),
        defaultHealth,
        {
          validateAndSave: async () => {
            saveCalls += 1
            return Result.fail(failure("UnexpectedPersistence"))
          }
        }
      )
    )

    expect(result).toMatchObject({ error: { _tag: "VoilaAuthNotAuthenticated" }, ok: false })
    expect(saveCalls).toBe(0)
  })

  it("reports cookie serialization and session conversion failures", async () => {
    const failingCookieJar: CookieJarPort = {
      ...toughCookieJarPort,
      serialize: () => Result.fail({ _tag: "CookieJarSerializationFailed", message: "serialization failed" })
    }
    const serialized = await loginWithPlaywrightWithRuntime(
      makeOptions("serialize-failure"),
      makeRuntime(makeBrowser(makePage(), capture("csrf")), defaultHealth, defaultPersistence, {
        ...defaultSessionCapture,
        cookieJar: failingCookieJar
      })
    )
    const sessionFailure = await loginWithPlaywrightWithRuntime(
      makeOptions("session-failure"),
      makeRuntime(makeBrowser(makePage(), capture("csrf")), defaultHealth, defaultPersistence, {
        constructors: {
          ...defaultSessionCapture.constructors,
          makeSessionSnapshot: () => Result.fail({ _tag: "SessionSnapshotSchemaMismatch", message: "session invalid" })
        },
        cookieJar: defaultSessionCapture.cookieJar
      })
    )
    const sdkFailure = await loginWithPlaywrightWithRuntime(
      makeOptions("sdk-session-failure"),
      makeRuntime(makeBrowser(makePage(), capture("csrf")), defaultHealth, defaultPersistence, {
        constructors: {
          ...defaultSessionCapture.constructors,
          makeAuthenticatedSdkSessionSnapshot: () =>
            Result.fail({ _tag: "SessionSnapshotSchemaMismatch", message: "sdk session invalid" })
        },
        cookieJar: defaultSessionCapture.cookieJar
      })
    )

    expect(serialized).toMatchObject({ error: { _tag: "VoilaAuthCookieCaptureFailed" }, ok: false })
    expect(sessionFailure).toMatchObject({ error: { _tag: "VoilaAuthSessionCaptureInvalid" }, ok: false })
    expect(sdkFailure).toMatchObject({ error: { _tag: "VoilaAuthSessionCaptureInvalid" }, ok: false })
  })

  it("reports persistence and health failures without hiding their typed errors", async () => {
    const persistenceFailure = await loginWithPlaywrightWithRuntime(
      makeOptions("persist-failure"),
      makeRuntime(makeBrowser(makePage(), capture("csrf")), defaultHealth, {
        validateAndSave: async () => Result.fail(failure("VoilaAuthSessionWriteFailed"))
      })
    )
    const healthFailure = await loginWithPlaywrightWithRuntime(
      makeOptions("health-failure"),
      makeRuntime(
        makeBrowser(makePage(), capture("csrf")),
        { check: async () => Result.fail({ _tag: "VoilaAuthHealthFailed", message: "health failed" }) },
        defaultPersistence
      )
    )

    expect(persistenceFailure).toMatchObject({ error: { _tag: "VoilaAuthSessionWriteFailed" }, ok: false })
    expect(healthFailure).toMatchObject({ error: { _tag: "VoilaAuthHealthFailed" }, ok: false })
  })

  it("serializes browser cookie attributes and falls back to the default timeout", async () => {
    const options = makeOptions("cookie-attributes")
    const { timeoutMs: _timeoutMs, ...withoutTimeout } = options
    const result = await loginWithPlaywrightWithRuntime(
      withoutTimeout,
      makeRuntime(
        makeBrowser(makePage(), {
          cookies: [{ ...validCookie, expires: 2_000_000_000, httpOnly: true, sameSite: "Lax", secure: true }],
          material: capture().material
        }),
        defaultHealth,
        { validateAndSave: async () => Result.fail(failure("VoilaAuthSessionWriteFailed")) }
      )
    )

    expect(result).toMatchObject({ error: { _tag: "VoilaAuthSessionWriteFailed" }, ok: false })
  })

  it("reports inactive health and succeeds after an active health check", async () => {
    const healthSession = makeSdkSession()
    const inactive = await loginWithPlaywrightWithRuntime(
      makeOptions("inactive"),
      makeRuntime(makeBrowser(makePage(), capture("csrf")), {
        check: async () => Result.succeed<SessionHealth>({ reason: "server", session: healthSession, status: "retry" })
      })
    )
    const successOptions = makeOptions("success")
    const successful = await loginWithPlaywrightWithRuntime(
      successOptions,
      makeRuntime(makeBrowser(makePage(), capture("csrf")), {
        check: async () => Result.succeed<SessionHealth>({ session: healthSession, status: "active" })
      })
    )
    let saveCalls = 0
    const validationPersistenceFailure = await loginWithPlaywrightWithRuntime(
      makeOptions("validation-persist-failure"),
      makeRuntime(
        makeBrowser(makePage(), capture("csrf")),
        { check: async () => Result.succeed<SessionHealth>({ session: healthSession, status: "active" }) },
        {
          validateAndSave: async () => {
            saveCalls += 1
            return Result.fail(failure("VoilaAuthSessionWriteFailed"))
          }
        }
      )
    )

    expect(inactive).toMatchObject({ error: { _tag: "VoilaAuthSessionInactive" }, ok: false })
    expect(successful).toEqual({ ok: true, value: { sessionPath: successOptions.sessionPath, status: "active" } })
    expect(validationPersistenceFailure).toMatchObject({ error: { _tag: "VoilaAuthSessionWriteFailed" }, ok: false })
    expect(saveCalls).toBe(1)
  })

  it("does not overwrite a session written while health validation is in flight", async () => {
    const options = makeOptions("health-session-superseded")
    const newerBase = makeSdkSession()
    const newerSession = { ...newerBase, session: { ...newerBase.session, csrf: { token: "newer-csrf" } } }
    let currentSession: SdkSessionSnapshot = makeSdkSession()
    const persistence: SessionPersistencePort = {
      validateAndSave: async (_path, validation) => {
        const expected = currentSession
        const validated = await validation()

        if (Result.isFailure(validated)) {
          return Result.fail(failure(validated.failure._tag))
        }

        if (encodeSession(currentSession) !== encodeSession(expected)) {
          return Result.fail(failure("VoilaAuthSessionSuperseded"))
        }

        currentSession = validated.success.session
        return Result.succeed(validated.success)
      }
    }
    const health: SessionHealthPort = {
      check: async () => {
        currentSession = newerSession
        return Result.succeed<SessionHealth>({ session: newerSession, status: "active" })
      }
    }

    const result = await loginWithPlaywrightWithRuntime(
      options,
      makeRuntime(makeBrowser(makePage(), capture("csrf")), health, persistence)
    )

    expect(result).toMatchObject({ error: { _tag: "VoilaAuthSessionSuperseded" }, ok: false })
    expect(currentSession).toEqual(newerSession)
  })

  it("uses the Playwright adapter and deterministic transport default for health", async () => {
    const page = makePage()
    const playwrightPage = {
      ...page,
      content: page.html,
      context: () => ({ cookies: async () => [validCookie] }),
      evaluateFetchedHtml: async () => "",
      evaluateRuntimeState: async () => undefined,
      goto: async (_url: string, _options: { readonly waitUntil: "domcontentloaded" }) => undefined
    }
    const healthTransport = Layer.succeed(VoilaTransport, { request: () => Effect.fail(connectionFailure()) })
    const options = makeOptions("adapter")
    const launcher = adapterTools.makePlaywrightLauncher(async () => ({
      close: async () => undefined,
      newPage: async () => playwrightPage,
      pages: () => []
    }))
    const browser = adapterTools.makeBrowserPort(launcher, async (browserPage) => {
      await browserPage.cookies()
      await browserPage.fetchedHtml()
      await browserPage.html()
      browserPage.isClosed()
      await browserPage.runtimeState()
      browserPage.onRequest(() => undefined)
      browserPage.onResponse(async () => undefined)
      await browserPage.goto()

      return Result.succeed(capture("csrf"))
    })
    const result = await loginWithPlaywrightWithRuntime(
      options,
      makeRuntime(browser, adapterTools.makeHealthPort(healthTransport))
    )

    expect(result).toMatchObject({ error: { _tag: "VoilaAuthSessionInactive" }, ok: false })
  })

  it("persists through the default session adapter and constructs the default transport layer", async () => {
    const directory = await mkdtemp(join(tmpdir(), "voila-auth-persistence-"))
    const sessionPath = StateFilePathSchema.make(join(directory, "session.json"))

    try {
      const persistence = adapterTools.makeDefaultPersistencePort()
      const saved = makeSdkSession()
      await expect(
        persistence.validateAndSave(sessionPath, async () =>
          Result.succeed<SessionHealth>({ session: saved, status: "active" })
        )
      ).resolves.toEqual(Result.succeed({ session: saved, status: "active" }))
      expect(Layer.isLayer(adapterTools.defaultTransportLayer())).toBe(true)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })
})
