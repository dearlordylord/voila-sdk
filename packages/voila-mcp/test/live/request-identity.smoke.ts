import { bootstrapGuestSession, searchProducts, type VoilaRequestBlocked, type VoilaTransport } from "@firfi/voila-sdk"
import { Either } from "effect"
import { readFile } from "node:fs/promises"
import topDesktopUserAgents from "top-user-agents/desktop"

import { makeNodeOperationEnvironment, type NodeFetchPort } from "../../src/node-env.js"

const blockedBody =
  "<HTML><HEAD><TITLE>ERROR: The request could not be satisfied</TITLE></HEAD><BODY>Request blocked.</BODY></HTML>"
const blockedStatus = 503
const enabledValue = "1"
const failureStatus = 1
const harmlessQuery = "milk"
const liveSmokeFlag = "VOILA_WAF_SMOKE"
const pageSize = 24
const successStatus = 0
const voilaHomepage = new URL("https://voila.ca/")

type LiveIdentitySmokeFailure =
  | { readonly _tag: "LiveIdentityEnvironmentInvalid" }
  | { readonly _tag: "LiveIdentityHomepageFailed"; readonly status?: number }
  | { readonly _tag: "LiveIdentityUserAgentMismatch"; readonly requestCount: number }
  | { readonly _tag: "LiveIdentityFixtureBootstrapFailed"; readonly causeTag: string }
  | { readonly _tag: "LiveIdentityBlockedDiagnosticMismatch" }

const firstDesktopUserAgent = (): string => {
  const userAgent = topDesktopUserAgents.at(0)

  if (userAgent === undefined) throw new Error("Expected the desktop user-agent dataset to be non-empty")

  return userAgent
}

const makeRecordingFetch = (): {
  readonly fetchPort: NodeFetchPort
  readonly observed: () => { readonly requestCount: number; readonly userAgent: string | null }
} => {
  let userAgent: string | null = null
  let requestCount = 0

  return {
    fetchPort: async (input, init) => {
      userAgent = new Headers(init.headers).get("user-agent")
      requestCount += 1

      return fetch(input, init)
    },
    observed: () => ({ requestCount, userAgent })
  }
}

const makeFixtureBootstrapTransport = (homepage: string): VoilaTransport => ({
  request: async () =>
    Either.right({
      body: homepage,
      headers: { "set-cookie": "voila-session=sanitized-cookie; Path=/; Secure; HttpOnly" },
      status: 200
    })
})

const blockedTransport: VoilaTransport = {
  request: async () =>
    Either.right({
      body: blockedBody,
      headers: { "set-cookie": "secret-cookie=must-not-leak", "x-amz-cf-id": "safe-edge-request-id" },
      status: blockedStatus
    })
}

const hasSafeBlockedDiagnostic = (error: VoilaRequestBlocked): boolean =>
  error.edgeRequestId === "safe-edge-request-id" &&
  error.method === "GET" &&
  error.status === blockedStatus &&
  !JSON.stringify(error).includes("secret-cookie")

const runSmoke = async (): Promise<Either.Either<undefined, LiveIdentitySmokeFailure>> => {
  const recording = makeRecordingFetch()
  const environment = makeNodeOperationEnvironment({}, undefined, recording.fetchPort)

  if (Either.isLeft(environment)) {
    return Either.left({ _tag: "LiveIdentityEnvironmentInvalid" })
  }

  const homepageResponse = await environment.right.transport.request({ headers: {}, method: "GET", url: voilaHomepage })

  if (Either.isLeft(homepageResponse) || homepageResponse.right.status < 200 || homepageResponse.right.status >= 300) {
    return Either.left({
      _tag: "LiveIdentityHomepageFailed",
      ...(Either.isRight(homepageResponse) ? { status: homepageResponse.right.status } : {})
    })
  }

  const observed = recording.observed()

  if (observed.userAgent !== firstDesktopUserAgent() || observed.requestCount !== 1) {
    return Either.left({ _tag: "LiveIdentityUserAgentMismatch", requestCount: observed.requestCount })
  }

  const homepageFixture = await readFile(
    new URL("../../../voila-sdk/test/fixtures/voila-homepage.html", import.meta.url),
    "utf8"
  )
  const bootstrap = await bootstrapGuestSession(makeFixtureBootstrapTransport(homepageFixture))

  if (Either.isLeft(bootstrap)) {
    return Either.left({ _tag: "LiveIdentityFixtureBootstrapFailed", causeTag: bootstrap.left._tag })
  }

  const blocked = await searchProducts(bootstrap.right.session, { pageSize, query: harmlessQuery }, blockedTransport)

  if (
    Either.isRight(blocked) ||
    blocked.left._tag !== "VoilaRequestBlocked" ||
    !hasSafeBlockedDiagnostic(blocked.left)
  ) {
    return Either.left({ _tag: "LiveIdentityBlockedDiagnosticMismatch" })
  }

  return Either.right(undefined)
}

if (process.env[liveSmokeFlag] !== enabledValue) {
  process.stdout.write(`${liveSmokeFlag}=1 is required; skipping live request identity smoke test.\n`)
  process.exit(successStatus)
} else {
  const result = await runSmoke()

  if (Either.isRight(result)) {
    process.stdout.write("Live request identity and sanitized blocked-diagnostic smoke passed.\n")
    process.exit(successStatus)
  } else {
    process.stderr.write(`Live request identity smoke returned typed failure: ${JSON.stringify(result.left)}\n`)
    process.exit(failureStatus)
  }
}
