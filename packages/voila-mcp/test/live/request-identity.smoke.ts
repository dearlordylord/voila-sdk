import { FetchHttpClient, HttpClient } from "@effect/platform"
import {
  bootstrapGuestSession,
  searchProducts,
  VoilaTransport,
  type VoilaRequestBlocked,
  type VoilaTransportError
} from "@firfi/voila-sdk"
import { Effect, Either, Layer } from "effect"
import { readFile } from "node:fs/promises"
import topDesktopUserAgents from "top-user-agents/desktop"

import { voilaTransportLayer } from "../../src/node-transport.js"

const blockedBody =
  "<HTML><HEAD><TITLE>ERROR: The request could not be satisfied</TITLE></HEAD><BODY>Request blocked.</BODY></HTML>"
const blockedStatus = 503
const enabledValue = "1"
const failureStatus = 1
const harmlessQuery = "milk"
const liveSmokeFlag = "VOILA_WAF_SMOKE"
const okStatusFloor = 200
const okStatusCeiling = 300
const pageSize = 24
const singleRequest = 1
const successStatus = 0
const voilaHomepage = new URL("https://voila.ca/")

type LiveIdentitySmokeFailure =
  | { readonly _tag: "LiveIdentityHomepageFailed"; readonly status?: number }
  | { readonly _tag: "LiveIdentityUserAgentMismatch"; readonly requestCount: number }
  | { readonly _tag: "LiveIdentityFixtureBootstrapFailed"; readonly causeTag: string }
  | { readonly _tag: "LiveIdentityBlockedDiagnosticMismatch" }

const firstDesktopUserAgent = (): string => {
  const userAgent = topDesktopUserAgents.at(0)

  if (userAgent === undefined) throw new Error("Expected the desktop user-agent dataset to be non-empty")

  return userAgent
}

interface RecordedIdentity {
  readonly requestCount: number
  readonly userAgent: string | undefined
}

/**
 * The real node transport, with the outgoing request headers recorded. What is
 * under test is the identity the deployed transport presents, so the recording
 * wraps the shipped client rather than replacing it.
 */
const recordingTransportLayer = (recorded: Array<Readonly<Record<string, string>>>): Layer.Layer<VoilaTransport> =>
  Layer.provide(
    voilaTransportLayer(),
    Layer.provide(
      Layer.effect(
        HttpClient.HttpClient,
        Effect.map(HttpClient.HttpClient, (client) =>
          HttpClient.transform(client, (response, request) => {
            recorded.push(request.headers)

            return response
          })
        )
      ),
      FetchHttpClient.layer
    )
  )

const identityFrom = (recorded: ReadonlyArray<Readonly<Record<string, string>>>): RecordedIdentity => ({
  requestCount: recorded.length,
  userAgent: recorded[0]?.["user-agent"]
})

const fixtureBootstrapTransportLayer = (homepage: string): Layer.Layer<VoilaTransport> =>
  Layer.succeed(VoilaTransport, {
    request: () =>
      Effect.succeed({
        body: homepage,
        headers: { "set-cookie": "voila-session=sanitized-cookie; Path=/; Secure; HttpOnly" },
        status: 200
      })
  })

const blockedTransportLayer: Layer.Layer<VoilaTransport> = Layer.succeed(VoilaTransport, {
  request: () =>
    Effect.succeed({
      body: blockedBody,
      headers: { "set-cookie": "secret-cookie=must-not-leak", "x-amz-cf-id": "safe-edge-request-id" },
      status: blockedStatus
    })
})

const hasSafeBlockedDiagnostic = (error: VoilaRequestBlocked): boolean =>
  error.edgeRequestId === "safe-edge-request-id" &&
  error.method === "GET" &&
  error.status === blockedStatus &&
  !JSON.stringify(error).includes("secret-cookie")

const homepageIdentity = (
  recorded: Array<Readonly<Record<string, string>>>
): Effect.Effect<Either.Either<undefined, LiveIdentitySmokeFailure>, VoilaTransportError> =>
  Effect.map(
    Effect.flatMap(VoilaTransport, (transport) =>
      transport.request({ headers: {}, method: "GET", url: voilaHomepage })
    ).pipe(Effect.provide(recordingTransportLayer(recorded))),
    (response) => {
      if (response.status < okStatusFloor || response.status >= okStatusCeiling) {
        const failed: LiveIdentitySmokeFailure = { _tag: "LiveIdentityHomepageFailed", status: response.status }

        return Either.left(failed)
      }

      const identity = identityFrom(recorded)
      const mismatched: LiveIdentitySmokeFailure = {
        _tag: "LiveIdentityUserAgentMismatch",
        requestCount: identity.requestCount
      }

      return identity.userAgent === firstDesktopUserAgent() && identity.requestCount === singleRequest
        ? Either.right(undefined)
        : Either.left(mismatched)
    }
  )

const blockedDiagnostic = (
  homepageFixture: string
): Effect.Effect<Either.Either<undefined, LiveIdentitySmokeFailure>> =>
  Effect.gen(function* () {
    const bootstrap = yield* Effect.either(
      Effect.provide(bootstrapGuestSession(), fixtureBootstrapTransportLayer(homepageFixture))
    )

    if (Either.isLeft(bootstrap)) {
      const failed: LiveIdentitySmokeFailure = {
        _tag: "LiveIdentityFixtureBootstrapFailed",
        causeTag: bootstrap.left._tag
      }

      return Either.left(failed)
    }

    const blocked = yield* Effect.either(
      Effect.provide(searchProducts(bootstrap.right.session, { pageSize, query: harmlessQuery }), blockedTransportLayer)
    )

    const mismatched: LiveIdentitySmokeFailure = { _tag: "LiveIdentityBlockedDiagnosticMismatch" }

    return Either.isLeft(blocked) &&
      blocked.left._tag === "VoilaRequestBlocked" &&
      hasSafeBlockedDiagnostic(blocked.left)
      ? Either.right(undefined)
      : Either.left(mismatched)
  })

const runSmoke = async (): Promise<Either.Either<undefined, LiveIdentitySmokeFailure>> => {
  const recorded: Array<Readonly<Record<string, string>>> = []
  const homepage = await Effect.runPromise(
    Effect.catchAll(
      homepageIdentity(recorded),
      (): Effect.Effect<Either.Either<undefined, LiveIdentitySmokeFailure>> => {
        const failed: LiveIdentitySmokeFailure = { _tag: "LiveIdentityHomepageFailed" }

        return Effect.succeed(Either.left(failed))
      }
    )
  )

  if (Either.isLeft(homepage)) return homepage

  const homepageFixture = await readFile(
    new URL("../../../voila-sdk/test/fixtures/voila-homepage.html", import.meta.url),
    "utf8"
  )

  return Effect.runPromise(blockedDiagnostic(homepageFixture))
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
