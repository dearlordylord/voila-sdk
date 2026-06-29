import { fetchVoilaTransport, type OperationExecutionResult } from "@firfi/voila-mcp"
import {
  type BrowserLoginRequest,
  checkSessionHealth,
  createInteractiveBrowserLoginPort,
  extractInitialState,
  type InteractiveBrowserLoginPage,
  loginWithBrowser,
  saveSdkSessionSnapshot,
  type SdkSessionSnapshot,
  type SessionStoragePort
} from "@firfi/voila-sdk"
import { Either } from "effect"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { type BrowserContext, chromium, type Page } from "playwright"

import type { CliLoginOptions } from "./cli.js"

const defaultTimeoutMs = 300_000
const pollIntervalMs = 2_000

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

const waitForAuthenticatedSession = async (
  page: Page,
  request: BrowserLoginRequest
) => {
  const timeoutMs = request.timeoutMs ?? defaultTimeoutMs
  const attempts = Math.max(1, Math.ceil(timeoutMs / pollIntervalMs))

  for (let remaining = attempts; remaining > 0; remaining -= 1) {
    try {
      if (responseSaysAuthenticated(await readActiveCustomerSession(page))) {
        return Either.right(undefined)
      }
    } catch {
      // Keep polling until timeout; transient fetch failures are expected while the page navigates.
    }

    await delay(pollIntervalMs)
  }

  return Either.left({
    _tag: "BrowserLoginTimedOut" as const
  })
}

const createPlaywrightPage = (
  context: BrowserContext,
  page: Page
): InteractiveBrowserLoginPage => ({
  close: () => context.close(),
  openLogin: async (request) => {
    await page.goto(request.loginUrl, { waitUntil: "domcontentloaded" })
  },
  readAccountSummary: async () => undefined,
  readAuthenticated: async () => responseSaysAuthenticated(await readActiveCustomerSession(page)),
  readCookies: (url) => context.cookies(url),
  readInitialState: async () => {
    const initialState = extractInitialState(await page.content())

    if (Either.isLeft(initialState)) {
      throw new Error("Voila initial state could not be captured")
    }

    return initialState.right
  },
  waitForLoginCompletion: (request) => waitForAuthenticatedSession(page, request)
})

const createPlaywrightLoginPort = (profilePath: string) =>
  createInteractiveBrowserLoginPort({
    openPage: async () => {
      const context = await chromium.launchPersistentContext(profilePath, {
        headless: false
      })
      const existingPage = context.pages()[0]
      const page = existingPage ?? await context.newPage()

      return createPlaywrightPage(context, page)
    }
  })

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
  const login = await loginWithBrowser(createPlaywrightLoginPort(options.profilePath), {
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs })
  })

  if (Either.isLeft(login)) {
    return failure(login.left._tag, login.left.message)
  }

  const saved = await saveSession(options.sessionPath, login.right.session)

  if (saved !== undefined) {
    return saved
  }

  const health = await checkSessionHealth(login.right.session, fetchVoilaTransport)

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
}
