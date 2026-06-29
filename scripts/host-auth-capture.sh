#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "${script_dir}/.." && pwd)"
dist_index="${repo_root}/dist/src/index.js"

session_dir="${VOILA_SESSION_DIR:-${repo_root}/local-session-snapshots}"
session_file="${VOILA_AUTH_SESSION_PATH:-${session_dir}/voila-auth-session.json}"
profile_dir="${VOILA_BROWSER_PROFILE_DIR:-${session_dir}/browser-profile}"
timeout_ms="${VOILA_AUTH_CAPTURE_TIMEOUT_MS:-300000}"
browser_path="${PLAYWRIGHT_BROWSERS_PATH:-${HOME}/.cache/ms-playwright-voila}"

if [[ ! -f "${dist_index}" ]]; then
  cat >&2 <<EOF
Built SDK output is missing at:
${dist_index}

Run this inside Docker first:
pnpm build
EOF
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  cat >&2 <<EOF
pnpm is required on the host for isolated auth capture.
Install or enable pnpm on the host, then rerun:
pnpm auth:capture
EOF
  exit 1
fi

mkdir -p "${session_dir}"

if [[ "${VOILA_AUTH_CAPTURE_DRY_RUN:-0}" == "1" ]]; then
  cat <<EOF
Auth capture dry run passed.
Repo root: ${repo_root}
Session output: ${session_file}
Browser profile: ${profile_dir}
Playwright browsers: ${browser_path}
EOF
  exit 0
fi

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/voila-auth-capture.XXXXXX")"
cleanup() {
  rm -rf "${tmp_dir}"
}
trap cleanup EXIT

mkdir -p "${tmp_dir}/pkg/dist"
cp -R "${repo_root}/dist/src" "${tmp_dir}/pkg/dist/src"

cat > "${tmp_dir}/package.json" <<'EOF'
{
  "private": true,
  "type": "module",
  "dependencies": {
    "@effect/platform": "^0.94.2",
    "@effect/platform-node": "^0.104.1",
    "effect": "^3.19.15",
    "playwright": "^1.61.1",
    "tough-cookie": "^6.0.0"
  }
}
EOF

cat > "${tmp_dir}/capture.mjs" <<'EOF'
import { randomUUID } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import process from "node:process"

import { Either } from "effect"
import { chromium } from "playwright"

import {
  extractInitialStatePayload,
  makeAuthenticatedSdkSessionSnapshot,
  makeSessionSnapshot,
  saveSdkSessionSnapshot,
  toughCookieJarPort
} from "./pkg/dist/src/index.js"

const voilaBaseUrl = "https://voila.ca/"
const voilaOrigin = "https://voila.ca"
const pollIntervalMs = 1_000
const sessionCookieExpires = -1
const readonlyCsrfFallback = "csrf-not-observed-readonly"

const sessionFile = process.env.VOILA_AUTH_SESSION_PATH
const sessionDirectory = process.env.VOILA_SESSION_DIR
const profileDirectory = process.env.VOILA_BROWSER_PROFILE_DIR
const timeoutMs = Number.parseInt(process.env.VOILA_AUTH_CAPTURE_TIMEOUT_MS ?? "300000", 10)

if (sessionFile === undefined || sessionDirectory === undefined || profileDirectory === undefined) {
  throw new Error("Missing auth capture path environment")
}

let latestCapture
let latestCaptureAt = 0
let latestCsrfToken
let latestMetadata
let latestPayloadObserved = false

const isPageClosed = (page) => {
  try {
    return page.isClosed()
  } catch {
    return true
  }
}

const isRecord = (value) => typeof value === "object" && value !== null
const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0

const readNested = (value, path) => {
  let current = value

  for (const key of path) {
    if (!isRecord(current)) {
      return undefined
    }

    current = current[key]
  }

  return current
}

const pickString = (...values) => {
  for (const value of values) {
    if (typeof value === "string") {
      return value
    }
  }

  return undefined
}

const normalizeMetadata = (payload) => {
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

const readCsrfToken = (payload) =>
  pickString(
    readNested(payload, ["csrf", "token"]),
    readNested(payload, ["session", "csrf", "token"])
  )

const recordPayload = (payload, source) => {
  latestPayloadObserved = true

  const metadata = normalizeMetadata(payload)
  const csrfToken = readCsrfToken(payload)

  if (metadata !== undefined) {
    latestMetadata = metadata
  }

  if (isNonEmptyString(csrfToken)) {
    latestCsrfToken = csrfToken
  }

  if (metadata !== undefined) {
    process.stdout.write(
      `Voila session metadata observed from ${source}. Close the browser window after login to save.\n`
    )
  }
}

const parseInitialStatePayloadFromHtml = (html, source) => {
  const payload = extractInitialStatePayload(html)

  if (Either.isRight(payload)) {
    recordPayload(payload.right, source)
    return
  }

  if (process.env.VOILA_AUTH_CAPTURE_DEBUG === "1") {
    process.stdout.write(`Initial state extraction from ${source} failed: ${payload.left._tag}\n`)
  }
}

const observeVoilaHtmlResponses = (page) => {
  page.on("request", (request) => {
    try {
      const url = new URL(request.url())

      if (url.origin !== voilaOrigin) {
        return
      }

      const csrfToken = request.headers()["x-csrf-token"]

      if (isNonEmptyString(csrfToken)) {
        latestCsrfToken = csrfToken
      }
    } catch {
      return
    }
  })

  page.on("response", async (response) => {
    try {
      const url = new URL(response.url())
      const contentType = response.headers()["content-type"] ?? ""

      if (url.origin !== voilaOrigin || !contentType.includes("text/html")) {
        return
      }

      parseInitialStatePayloadFromHtml(await response.text(), "HTML response")
    } catch {
      return
    }
  })
}

const readRuntimePayload = async (page) => page.evaluate(() => globalThis.window?.__INITIAL_STATE__).catch(() => undefined)

const tryRefreshCapture = async (context, loginPage) => {
  if (latestMetadata === undefined && !isPageClosed(loginPage)) {
    const html = await loginPage.content().catch(() => undefined)

    if (html !== undefined) {
      parseInitialStatePayloadFromHtml(html, "current page")
    }

    const runtimePayload = await readRuntimePayload(loginPage)

    if (runtimePayload !== undefined) {
      recordPayload(runtimePayload, "browser runtime")
    }
  }

  const cookies = await context.cookies([voilaBaseUrl])

  if (cookies.length > 0 && latestMetadata !== undefined) {
    latestCapture = {
      cookies,
      csrfToken: latestCsrfToken,
      metadata: latestMetadata
    }
    latestCaptureAt = Date.now()
  }

  if (isPageClosed(loginPage)) {
    return latestCapture === undefined
      ? Either.left({ _tag: "BrowserLoginCaptureInvalid" })
      : Either.right(undefined)
  }

  return Either.right(undefined)
}

const waitForCapture = async (context, loginPage, deadlineMs) => {
  const deadline = Date.now() + deadlineMs
  let lastStatusAt = 0

  while (Date.now() < deadline) {
    const refresh = await tryRefreshCapture(context, loginPage)

    if (Either.isLeft(refresh)) {
      return refresh
    }

    if (isPageClosed(loginPage) && latestCapture !== undefined) {
      return Either.right(undefined)
    }

    if (Date.now() - lastStatusAt > 10_000) {
      if (latestCapture !== undefined) {
        const csrfStatus = latestCapture.csrfToken === undefined
          ? "CSRF token not observed; readonly smoke will verify the saved session."
          : "CSRF token observed."

        process.stdout.write(`Session material observed. ${csrfStatus} Close the browser window after login to save.\n`)
      } else if (latestPayloadObserved) {
        process.stdout.write("Voila state observed, waiting for required session metadata and cookies.\n")
      } else {
        process.stdout.write("Waiting for Voila homepage state. Finish login in the browser; no terminal action is needed.\n")
      }
      lastStatusAt = Date.now()
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }

  await context.close().catch(() => undefined)

  return Either.left({ _tag: "BrowserLoginTimedOut" })
}

const makeCookieHeader = (cookie) => {
  const expires = cookie.expires === undefined || cookie.expires === sessionCookieExpires
    ? []
    : [`Expires=${new Date(cookie.expires * 1000).toUTCString()}`]

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

const serializeBrowserCookies = (cookies) => {
  const jar = toughCookieJarPort.create()

  for (const cookie of cookies) {
    jar.setCookieSync(makeCookieHeader(cookie), voilaBaseUrl)
  }

  return toughCookieJarPort.serialize(jar)
}

const makeSdkSession = () => {
  const cookieJar = serializeBrowserCookies(latestCapture.cookies)

  if (Either.isLeft(cookieJar)) {
    return Either.left(cookieJar.left)
  }

  const session = makeSessionSnapshot(
    latestCapture.metadata,
    { token: latestCapture.csrfToken ?? readonlyCsrfFallback },
    cookieJar.right
  )

  if (Either.isLeft(session)) {
    return session
  }

  return makeAuthenticatedSdkSessionSnapshot(
    session.right,
    latestCapture.csrfToken === undefined ? "unknown-expiry" : "authenticated"
  )
}

const storage = {
  read: async () => "",
  write: async (contents) => {
    await mkdir(sessionDirectory, { recursive: true })
    await writeFile(sessionFile, contents, { mode: 0o600 })
  }
}

await mkdir(sessionDirectory, { recursive: true })

process.stdout.write([
  "Opening Chromium for Voila login.",
  "Log in manually in the browser window.",
  "After login, close the browser window to save the observed session.",
  `Session output: ${sessionFile}`,
  `Browser profile: ${profileDirectory}`,
  ""
].join("\n"))

const context = await chromium.launchPersistentContext(profileDirectory, {
  headless: false
})
const loginPage = await context.newPage()
observeVoilaHtmlResponses(loginPage)
await loginPage.goto(voilaBaseUrl, { waitUntil: "domcontentloaded" })

const captureResult = await waitForCapture(context, loginPage, timeoutMs)

if (Either.isLeft(captureResult)) {
  await context.close().catch(() => undefined)
  process.stderr.write(`Authentication capture failed: ${captureResult.left._tag}\n`)
  process.exit(1)
}

process.stdout.write(`Saving observed Voila session from ${new Date(latestCaptureAt).toISOString()}.\n`)

const sdkSession = makeSdkSession()

if (Either.isLeft(sdkSession)) {
  await context.close().catch(() => undefined)
  process.stderr.write(`Authentication capture failed: ${sdkSession.left._tag}\n`)
  process.exit(1)
}

const saved = await saveSdkSessionSnapshot(storage, sdkSession.right)

if (Either.isLeft(saved)) {
  await context.close().catch(() => undefined)
  process.stderr.write(`Authentication session save failed: ${saved.left._tag}\n`)
  process.exit(1)
}

await context.close().catch(() => undefined)

process.stdout.write([
  "Authenticated Voila session saved.",
  "",
  "Docker verification command:",
  "VOILA_AUTH_SMOKE=1 \\",
  "VOILA_AUTH_SESSION_PATH=/workspace/typescript/voila/local-session-snapshots/voila-auth-session.json \\",
  "pnpm smoke:auth-readonly",
  ""
].join("\n"))
EOF

(
  cd "${tmp_dir}"
  pnpm install --silent
  PLAYWRIGHT_BROWSERS_PATH="${browser_path}" pnpm exec playwright install chromium
  VOILA_SESSION_DIR="${session_dir}" \
    VOILA_AUTH_SESSION_PATH="${session_file}" \
    VOILA_BROWSER_PROFILE_DIR="${profile_dir}" \
    VOILA_AUTH_CAPTURE_TIMEOUT_MS="${timeout_ms}" \
    PLAYWRIGHT_BROWSERS_PATH="${browser_path}" \
    node capture.mjs
)
