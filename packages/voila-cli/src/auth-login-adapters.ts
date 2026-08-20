import { nodeVoilaTransportLayer, type OperationExecutionResult } from "@firfi/voila-mcp"
import {
  checkSessionHealth,
  type CookieJarPort,
  type makeAuthenticatedSdkSessionSnapshot,
  type makeSessionSnapshot,
  type SdkSessionSnapshot,
  type SessionHealth,
  type VoilaTransport,
  VOILA_BASE_URL
} from "@firfi/voila-sdk"
import {
  makeStateFileLocks,
  StateFileLocks,
  type StateFileLocksService,
  type StateFilePath
} from "@firfi/voila-session-store"
import { Effect, type Layer, Result } from "effect"
import { chromium, type Page } from "playwright"

import { waitForAuthenticatedCapture } from "./auth-capture.js"
import type { CapturedBrowserSession, observeVoilaBrowserTraffic } from "./auth-capture.js"
import { persistValidatedLoginSession } from "./auth-session-file.js"

type BrowserTrafficPagePort = Parameters<typeof observeVoilaBrowserTraffic>[0]
type BrowserSessionPagePort = Parameters<typeof waitForAuthenticatedCapture>[0]
type BrowserCaptureObserverPort = ReturnType<typeof observeVoilaBrowserTraffic>
export type BrowserPagePort = BrowserTrafficPagePort & BrowserSessionPagePort & { readonly goto: () => Promise<void> }

export type AuthFailure = Extract<OperationExecutionResult, { readonly ok: false }>

type BrowserCapturePort = (
  page: BrowserPagePort,
  timeoutMs: Parameters<typeof waitForAuthenticatedCapture>[1],
  observer: BrowserCaptureObserverPort,
  writeProgress: Parameters<typeof waitForAuthenticatedCapture>[3],
  delay: Parameters<typeof waitForAuthenticatedCapture>[4],
  generateSessionId: Parameters<typeof waitForAuthenticatedCapture>[5]
) => Promise<Result.Result<CapturedBrowserSession, AuthFailure>>

export interface BrowserContextPort {
  readonly close: () => Promise<void>
  readonly newPage: () => Promise<BrowserPagePort>
  readonly pages: () => ReadonlyArray<BrowserPagePort>
}

export interface BrowserPort {
  readonly capture: BrowserCapturePort
  readonly launchPersistentContext: (profilePath: string) => Promise<BrowserContextPort>
}

/** Operations supplied by the Playwright boundary, kept narrow for deterministic tests. */
interface PlaywrightPageActions {
  readonly cookies: (url: string) => Promise<unknown>
  readonly content: () => Promise<string>
  readonly evaluateFetchedHtml: () => Promise<string>
  readonly evaluateRuntimeState: () => Promise<unknown>
  readonly goto: (url: string, options: { readonly waitUntil: "domcontentloaded" }) => Promise<unknown>
  readonly isClosed: () => boolean
  readonly onRequest: BrowserTrafficPagePort["onRequest"]
  readonly onResponse: BrowserTrafficPagePort["onResponse"]
}

interface PlaywrightPagePort {
  readonly context: () => { readonly cookies: (url: string) => Promise<unknown> }
  readonly content: () => Promise<string>
  readonly evaluateFetchedHtml: () => Promise<string>
  readonly evaluateRuntimeState: () => Promise<unknown>
  readonly goto: (url: string, options: { readonly waitUntil: "domcontentloaded" }) => Promise<unknown>
  readonly isClosed: () => boolean
  readonly onRequest: BrowserTrafficPagePort["onRequest"]
  readonly onResponse: BrowserTrafficPagePort["onResponse"]
}

interface PlaywrightContextPort {
  readonly close: () => Promise<void>
  readonly newPage: () => Promise<PlaywrightPagePort>
  readonly pages: () => ReadonlyArray<PlaywrightPagePort>
}

interface PlaywrightContextActions {
  readonly close: () => Promise<void>
  readonly newPage: () => Promise<PlaywrightPageActions>
  readonly pages: () => ReadonlyArray<PlaywrightPageActions>
}

interface PlaywrightLauncherPort {
  readonly launchPersistentContext: (profilePath: string) => Promise<PlaywrightContextPort>
}

interface PlaywrightLaunchContext {
  readonly close: () => Promise<void>
  readonly newPage: () => Promise<Page | PlaywrightPageSource>
  readonly pages: () => ReadonlyArray<Page | PlaywrightPageSource>
}

interface PlaywrightLaunchRuntime {
  readonly launchPersistentContext: (
    profilePath: string,
    options: { readonly headless: false }
  ) => Promise<PlaywrightLaunchContext>
}

type SessionHealthResult = Result.Result<SessionHealth, { readonly _tag: string; readonly message: string }>

export interface SessionHealthPort {
  readonly check: (session: SdkSessionSnapshot) => Promise<SessionHealthResult>
}

export interface SessionPersistencePort {
  readonly validateAndSave: (
    path: StateFilePath,
    validation: () => Promise<SessionHealthResult>
  ) => Promise<Result.Result<SessionHealth, AuthFailure>>
}

interface SessionSnapshotConstructors {
  readonly makeAuthenticatedSdkSessionSnapshot: typeof makeAuthenticatedSdkSessionSnapshot
  readonly makeSessionSnapshot: typeof makeSessionSnapshot
}

export interface SessionCapturePort {
  readonly constructors: SessionSnapshotConstructors
  readonly cookieJar: CookieJarPort
}

const makePlaywrightPage = (actions: PlaywrightPageActions): PlaywrightPagePort => ({
  content: actions.content,
  context: () => ({ cookies: actions.cookies }),
  evaluateFetchedHtml: actions.evaluateFetchedHtml,
  evaluateRuntimeState: actions.evaluateRuntimeState,
  goto: actions.goto,
  isClosed: actions.isClosed,
  onRequest: actions.onRequest,
  onResponse: actions.onResponse
})

const makeBrowserPage = (page: PlaywrightPagePort): BrowserPagePort => ({
  cookies: () => page.context().cookies(VOILA_BASE_URL),
  fetchedHtml: page.evaluateFetchedHtml,
  goto: async () => {
    await page.goto(VOILA_BASE_URL, { waitUntil: "domcontentloaded" })
  },
  html: page.content,
  isClosed: page.isClosed,
  onRequest: page.onRequest,
  onResponse: page.onResponse,
  runtimeState: page.evaluateRuntimeState
})

const makeBrowserContext = (context: PlaywrightContextPort): BrowserContextPort => ({
  close: context.close,
  newPage: async () => makeBrowserPage(await context.newPage()),
  pages: () => context.pages().map(makeBrowserPage)
})

const makePlaywrightContext = (context: PlaywrightContextActions): PlaywrightContextPort => ({
  close: context.close,
  newPage: async () => makePlaywrightPage(await context.newPage()),
  pages: () => context.pages().map(makePlaywrightPage)
})

const makePlaywrightLauncher = (
  launch: (profilePath: string) => Promise<PlaywrightContextActions>
): PlaywrightLauncherPort => ({
  launchPersistentContext: async (profilePath) => makePlaywrightContext(await launch(profilePath))
})

const defaultBrowserCapture: BrowserCapturePort = async (...args) => {
  const captured = await waitForAuthenticatedCapture(...args)

  return "ok" in captured ? Result.fail(captured) : Result.succeed(captured)
}

const makeBrowserPort = (
  launcher: PlaywrightLauncherPort,
  capture: BrowserCapturePort = defaultBrowserCapture
): BrowserPort => ({
  capture,
  launchPersistentContext: async (profilePath) =>
    makeBrowserContext(await launcher.launchPersistentContext(profilePath))
})

const makeHealthPort = (transport: Layer.Layer<VoilaTransport>): SessionHealthPort => ({
  check: (session) => Effect.runPromise(Effect.result(Effect.provide(checkSessionHealth(session), transport)))
})

const makePersistencePort = (locks: StateFileLocksService): SessionPersistencePort => ({
  validateAndSave: async (path, validation) => {
    const saved = await Effect.runPromise(
      Effect.result(
        persistValidatedLoginSession(
          path,
          Effect.flatMap(
            Effect.tryPromise({
              catch: () => ({ _tag: "VoilaAuthHealthFailed", message: "Session health check failed" }),
              try: validation
            }),
            Effect.fromResult
          )
        ).pipe(Effect.provideService(StateFileLocks, locks))
      )
    )

    return Result.isFailure(saved)
      ? Result.fail({ error: { _tag: saved.failure._tag, message: saved.failure.message }, ok: false })
      : Result.succeed(saved.success)
  }
})

const makeDefaultPlaywrightLauncher = (runtime: PlaywrightLaunchRuntime = chromium): PlaywrightLauncherPort =>
  makePlaywrightLauncher(async (profilePath) => {
    const context = await runtime.launchPersistentContext(profilePath, { headless: false })

    return {
      close: () => context.close(),
      newPage: async () =>
        makePlaywrightPageActions(makePlaywrightRawPage(makePlaywrightPageSource(await context.newPage()))),
      pages: () =>
        context.pages().map((page) => makePlaywrightPageActions(makePlaywrightRawPage(makePlaywrightPageSource(page))))
    }
  })

interface PlaywrightPageSource {
  readonly context: () => { readonly cookies: (url: string) => Promise<unknown> }
  readonly content: () => Promise<string>
  readonly evaluateFetchedHtml: () => Promise<string>
  readonly evaluateRuntimeState: () => Promise<unknown>
  readonly goto: (url: string, options: { readonly waitUntil: "domcontentloaded" }) => Promise<unknown>
  readonly isClosed: () => boolean
  readonly onRequest: BrowserTrafficPagePort["onRequest"]
  readonly onResponse: BrowserTrafficPagePort["onResponse"]
}

interface PlaywrightNativeRequestSource {
  readonly headers: () => Readonly<Record<string, string>>
  readonly url: () => string
}

interface PlaywrightNativeResponseSource extends PlaywrightNativeRequestSource {
  readonly text: () => Promise<string>
}

interface PlaywrightNativePageSource {
  readonly content: () => Promise<string>
  readonly context: PlaywrightPageSource["context"]
  readonly evaluate: <A>(expression: string) => Promise<A>
  readonly goto: PlaywrightPageSource["goto"]
  readonly isClosed: () => boolean
  readonly onRequestSource: (listener: (request: PlaywrightNativeRequestSource) => void) => void
  readonly onResponseSource: (listener: (response: PlaywrightNativeResponseSource) => void) => void
}

type PlaywrightRawPage = PlaywrightPageSource

const makePlaywrightRawPage = (page: PlaywrightPageSource): PlaywrightRawPage => ({
  context: () => page.context(),
  content: () => page.content(),
  evaluateFetchedHtml: () => page.evaluateFetchedHtml(),
  evaluateRuntimeState: () => page.evaluateRuntimeState(),
  goto: (url, options) => page.goto(url, options),
  isClosed: () => page.isClosed(),
  onRequest: (listener) => page.onRequest(listener),
  onResponse: (listener) => page.onResponse(listener)
})

const makePlaywrightPageActions = (page: PlaywrightRawPage): PlaywrightPageActions => ({
  cookies: (url) => page.context().cookies(url),
  content: () => page.content(),
  evaluateFetchedHtml: page.evaluateFetchedHtml,
  evaluateRuntimeState: page.evaluateRuntimeState,
  goto: (url, options) => page.goto(url, options),
  isClosed: () => page.isClosed(),
  onRequest: page.onRequest,
  onResponse: page.onResponse
})

const makePlaywrightPageSource = (
  page: Page | PlaywrightNativePageSource | PlaywrightPageSource
): PlaywrightPageSource => {
  const source: PlaywrightPageSource =
    "evaluateFetchedHtml" in page
      ? page
      : (() => {
          const native: PlaywrightNativePageSource =
            "onRequestSource" in page
              ? page
              : {
                  context: page.context.bind(page),
                  content: page.content.bind(page),
                  evaluate: page.evaluate.bind(page),
                  goto: page.goto.bind(page),
                  isClosed: page.isClosed.bind(page),
                  onRequestSource: (listener) => page.on("request", listener),
                  onResponseSource: (listener) => page.on("response", listener)
                }

          return {
            context: native.context,
            content: native.content,
            evaluateFetchedHtml: () =>
              native.evaluate<string>("fetch('/', { credentials: 'include' }).then((response) => response.text())"),
            evaluateRuntimeState: () => native.evaluate("window.__INITIAL_STATE__"),
            goto: native.goto,
            isClosed: native.isClosed,
            onRequest: (listener) =>
              native.onRequestSource((request) =>
                listener({ headers: () => request.headers(), url: () => request.url() })
              ),
            onResponse: (listener) =>
              native.onResponseSource(
                (response) =>
                  void listener({
                    headers: () => response.headers(),
                    responseText: () => response.text(),
                    url: () => response.url()
                  })
              )
          }
        })()

  return {
    context: () => source.context(),
    content: () => source.content(),
    evaluateFetchedHtml: () => source.evaluateFetchedHtml(),
    evaluateRuntimeState: () => source.evaluateRuntimeState(),
    goto: (url, options) => source.goto(url, options),
    isClosed: () => source.isClosed(),
    onRequest: (listener) => source.onRequest(listener),
    onResponse: (listener) => source.onResponse(listener)
  }
}

const makeDefaultPersistencePort = (): SessionPersistencePort =>
  makePersistencePort(Effect.runSync(makeStateFileLocks()))

const defaultTransportLayer = (): Layer.Layer<VoilaTransport> => nodeVoilaTransportLayer()

export const adapterTools = {
  makeBrowserPort,
  makeDefaultPersistencePort,
  makeDefaultPlaywrightLauncher,
  defaultTransportLayer,
  makeHealthPort,
  makePersistencePort,
  makePlaywrightLauncher,
  makePlaywrightPage,
  makePlaywrightPageActions,
  makePlaywrightPageSource,
  makePlaywrightRawPage
}
