import {
  connectionFailure,
  makeAuthenticatedSdkSessionSnapshot,
  makeGuestSdkSessionSnapshot,
  makeSessionSnapshot,
  type SdkSessionSnapshot,
  serializeCookieJar,
  type SessionSnapshot,
  toughCookieJarPort,
  VoilaTransport,
  type VoilaTransportError,
  type VoilaTransportRequest,
  type VoilaTransportResponse
} from "@firfi/voila-sdk"
import { Effect, Layer, Result } from "effect"

import type {
  OperationEnvironment,
  OperationExecutionResult,
  OperationFailure,
  SessionOperation,
  VoilaOperationName
} from "../../src/operations.js"
import { runVoilaOperation } from "../../src/operations.js"

const voilaUrl = "https://voila.ca/"
const csrfToken = "csrf-token"

const sampleMetadata = {
  assetVersion: "asset-version",
  clientRouteId: "client-route-id",
  pageViewId: "page-view-id",
  regionId: "region-id"
}

export const makeSessionSnapshotForTest = (): SessionSnapshot => {
  const jar = toughCookieJarPort.create()
  jar.setCookieSync("voila-session=sanitized-cookie; Path=/; Secure; HttpOnly", voilaUrl)

  const cookieJar = serializeCookieJar(jar)

  if (Result.isFailure(cookieJar)) {
    throw new Error("Expected cookie jar serialization")
  }

  const session = makeSessionSnapshot(sampleMetadata, { token: csrfToken }, cookieJar.success)

  if (Result.isFailure(session)) {
    throw new Error("Expected session snapshot")
  }

  return session.success
}

export const makeSdkSessionForTest = (): SdkSessionSnapshot => {
  const snapshot = makeGuestSdkSessionSnapshot(makeSessionSnapshotForTest())

  if (Result.isFailure(snapshot)) {
    throw new Error("Expected SDK session snapshot")
  }

  return snapshot.success
}

const makeAuthenticatedSdkSessionForTest = (): SdkSessionSnapshot => {
  const snapshot = makeAuthenticatedSdkSessionSnapshot(makeSessionSnapshotForTest(), "authenticated")

  if (Result.isFailure(snapshot)) {
    throw new Error("Expected authenticated SDK session snapshot")
  }

  return snapshot.success
}

/**
 * An environment whose session cycle is real — it carries a refreshed snapshot
 * forward the way the file cycle does — over a scripted transport.
 */
export const makeStubEnvironment = (
  respond: (request: VoilaTransportRequest) => Effect.Effect<VoilaTransportResponse, VoilaTransportError>,
  options: { readonly sessionKind?: SdkSessionSnapshot["kind"] } = {}
): { readonly env: OperationEnvironment; readonly saved: () => SdkSessionSnapshot | undefined } => {
  let savedSession: SdkSessionSnapshot | undefined
  let savedAuthenticatedSession: SdkSessionSnapshot | undefined
  const initialSession =
    options.sessionKind === "authenticated" ? makeAuthenticatedSdkSessionForTest() : makeSdkSessionForTest()
  const initialAuthenticatedSession = makeAuthenticatedSdkSessionForTest()

  return {
    env: {
      session: {
        withSession: <A>(operation: SessionOperation<A>): Effect.Effect<A, OperationFailure, VoilaTransport> =>
          Effect.gen(function* () {
            const outcome = yield* operation(savedSession ?? initialSession)

            if (outcome.refreshed !== undefined) {
              savedSession = outcome.refreshed
            }

            return outcome.value
          }),
        withAuthenticatedSession: <A>(
          operation: SessionOperation<A>
        ): Effect.Effect<A, OperationFailure, VoilaTransport> =>
          Effect.gen(function* () {
            const outcome = yield* operation(savedAuthenticatedSession ?? initialAuthenticatedSession)

            if (outcome.refreshed !== undefined) {
              savedAuthenticatedSession = outcome.refreshed
            }

            return outcome.value
          })
      },
      transport: stubTransportLayer(respond)
    },
    saved: () => savedSession
  }
}

/**
 * A real transport implementation provided through the tag. Tests substitute
 * behaviour by providing a layer, never by patching a module.
 */
export const stubTransportLayer = (
  respond: (request: VoilaTransportRequest) => Effect.Effect<VoilaTransportResponse, VoilaTransportError>
): Layer.Layer<VoilaTransport> => Layer.succeed(VoilaTransport, { request: respond })

/**
 * A transport that must never be reached. An operation that rejects its input
 * before touching the network is the contract; a request arriving here fails
 * the test by failing the operation.
 */
export const unusedTransportLayer: Layer.Layer<VoilaTransport> = stubTransportLayer(() =>
  Effect.fail(connectionFailure())
)

/**
 * Runs an operation and unions its two channels back into the result shape a
 * process edge reports.
 */
export const runOperation = (
  name: VoilaOperationName,
  input: unknown,
  env: OperationEnvironment
): Promise<OperationExecutionResult> =>
  Effect.runPromise(
    Effect.map(
      Effect.result(runVoilaOperation(name, input, env)),
      (executed): OperationExecutionResult => (Result.isFailure(executed) ? executed.failure : executed.success)
    )
  )
