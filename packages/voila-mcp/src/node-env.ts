import type {
  SdkSessionSnapshot,
  VoilaTransport,
  VoilaTransportRequest,
  VoilaTransportResponse
} from "@firfi/voila-sdk"
import {
  keepSessionFile,
  makeStateFileLocks,
  persistSession,
  type SessionFileCarriedOutcome,
  type SessionFileCycleStep,
  type SessionFileUpdate,
  StateFileLocks,
  type StateFilePath,
  StateFilePathSchema,
  updateSessionFileCarrying
} from "@firfi/voila-session-store"
import { Effect, Either, Option, Ref, Schema } from "effect"

import topDesktopUserAgents from "top-user-agents/desktop"

import { makeAuthGuidance } from "./auth-guidance.js"
import {
  makeGuestSessionSnapshot,
  type OperationEnvironment,
  type OperationFailure,
  type OperationSessionPort,
  type SessionOperation,
  type SessionOperationOutcome
} from "./operations.js"

// One configured path, parsed here at the environment boundary: the read path
// and the write path cannot differ, because a write compared against a file
// nobody reads guarantees nothing.
const EnvSchema = Schema.Struct({
  VOILA_AUTH_SESSION_PATH: Schema.optionalWith(StateFilePathSchema, { exact: true }),
  VOILA_GUEST: Schema.optionalWith(Schema.Literal("1"), { exact: true }),
  VOILA_USER_AGENT: Schema.optionalWith(Schema.String.pipe(Schema.trimmed(), Schema.minLength(1)), { exact: true })
})

type EnvConfig = Schema.Schema.Type<typeof EnvSchema>

const envInvalid = (): OperationFailure => ({
  _tag: "VoilaEnvironmentInvalid",
  message: "Voila MCP environment variables are invalid"
})

// a transport that rejects rather than returning a typed failure must still
// leave the operation layer as a typed, redacted failure, not a defect
const bootstrapRejected = (): OperationFailure => ({
  _tag: "VoilaSessionBootstrapFailed",
  message: "Guest session could not be bootstrapped"
})

/**
 * A guest snapshot is never written to disk: it is rebuildable with one
 * request, and persisting it is exactly what lets a guest bootstrap land on top
 * of an authenticated file.
 */
const sessionFileUpdateFor = (outcome: SessionOperationOutcome<unknown>): SessionFileUpdate =>
  outcome.refreshed === undefined || outcome.refreshed.kind === "guest"
    ? keepSessionFile
    : persistSession(outcome.refreshed)

// what the cycle reports back: the file decision, and the operation's own
// result on the carry channel rather than through a captured variable
const cycleStep = <A>(ran: SessionOperationOutcome<A>): SessionFileCycleStep<SessionOperationOutcome<A>> => ({
  carried: ran,
  update: sessionFileUpdateFor(ran)
})

const makeSessionPort = (config: EnvConfig, transport: VoilaTransport): OperationSessionPort => {
  // The guest session lives for the process's lifetime instead of on disk, and
  // is the only session this port holds in memory. A configured session file is
  // read inside every update cycle, so a login that lands between two
  // operations is picked up without a restart.
  const guest = Effect.runSync(Ref.make(Option.none<SdkSessionSnapshot>()))
  // guards the bootstrap check-and-fetch: two concurrent fibers must not each
  // pay for a guest bootstrap
  const guestBootstrapLock = Effect.unsafeMakeSemaphore(1)
  // one lock table per environment, shared by every session-file cycle in this
  // process: per-cycle tables would exclude nothing
  const locks = Effect.runSync(makeStateFileLocks())
  const sessionFile = config.VOILA_GUEST === "1" ? undefined : config.VOILA_AUTH_SESSION_PATH

  const bootstrapGuest: Effect.Effect<SdkSessionSnapshot, OperationFailure> = guestBootstrapLock.withPermits(1)(
    Effect.gen(function* () {
      const cached = yield* Ref.get(guest)

      if (Option.isSome(cached)) {
        return cached.value
      }

      const bootstrapped = yield* Effect.tryPromise({
        catch: bootstrapRejected,
        try: () => makeGuestSessionSnapshot(transport)
      })
      const snapshot = yield* bootstrapped
      yield* Ref.set(guest, Option.some(snapshot))

      return snapshot
    })
  )

  const runWithGuest = <A>(operation: SessionOperation<A>): Effect.Effect<A, OperationFailure> =>
    Effect.gen(function* () {
      const outcome = yield* Effect.flatMap(bootstrapGuest, operation)

      if (outcome.refreshed !== undefined) {
        yield* Ref.set(guest, Option.some(outcome.refreshed))
      }

      return outcome.value
    })

  const runWithSessionFile = <A>(
    file: StateFilePath,
    operation: SessionOperation<A>
  ): Effect.Effect<A, OperationFailure> =>
    Effect.gen(function* () {
      // A dropped update needs no adoption here: the losing snapshot is never
      // kept, and the next cycle reads whatever the winner wrote. The
      // operation's own result comes back on the outcome's carry channel —
      // on every variant, including a dropped conflict.
      const outcome: SessionFileCarriedOutcome<SessionOperationOutcome<A>> = yield* updateSessionFileCarrying(
        file,
        (current) =>
          Effect.map(
            Effect.flatMap(current === undefined ? bootstrapGuest : Effect.succeed(current), operation),
            cycleStep
          )
      )

      // A refreshed guest session is kept in memory for the same reason it is
      // not written: it is the session this process keeps using, and dropping
      // the refresh would replay a stale bootstrap on every call.
      const refreshed = outcome.carried.refreshed

      if (refreshed?.kind === "guest") {
        yield* Ref.set(guest, Option.some(refreshed))
      }

      return outcome.carried.value
    }).pipe(Effect.provideService(StateFileLocks, locks))

  return {
    withSession: (operation) =>
      sessionFile === undefined ? runWithGuest(operation) : runWithSessionFile(sessionFile, operation)
  }
}

const collectResponseHeaders = (headers: Headers): VoilaTransportResponse["headers"] =>
  Object.fromEntries(headers.entries())

const getMostPopularUserAgent = (): string => {
  const [mostPopularUserAgent] = topDesktopUserAgents

  if (mostPopularUserAgent === undefined) {
    throw new Error("top-user-agents/desktop returned an empty list")
  }

  return mostPopularUserAgent
}

export type NodeFetchPort = (input: URL, init: RequestInit) => Promise<Response>

/**
 * How long one Voila request may take before it is abandoned. A request runs
 * inside the session file cycle and holds that file's lock while it does, so
 * an unbounded request is not one slow tool call — it is every tool call in
 * the process waiting behind it. Generous enough for the slowest observed
 * endpoints (decorated order details, large category pages); Node's own
 * defaults are roughly ten times this.
 */
export const defaultRequestTimeoutMs = 30_000

export const makeFetchVoilaTransport = (
  configuredUserAgent?: string,
  fetchPort: NodeFetchPort = fetch,
  requestTimeoutMs: number = defaultRequestTimeoutMs
): VoilaTransport => ({
  request: async (request: VoilaTransportRequest) => {
    const hasRequestUserAgent = Object.keys(request.headers).some((name) => name.toLowerCase() === "user-agent")
    const headers = hasRequestUserAgent
      ? request.headers
      : { ...request.headers, "user-agent": configuredUserAgent ?? getMostPopularUserAgent() }

    try {
      // the body is read under the same timeout and the same handling: a
      // response whose headers arrive and whose body then stalls is the same
      // held lock as one that never answers at all
      const response = await fetchPort(request.url, {
        ...(request.body === undefined ? {} : { body: request.body }),
        headers,
        method: request.method,
        signal: AbortSignal.timeout(requestTimeoutMs)
      })

      return Either.right({
        body: await response.text(),
        headers: collectResponseHeaders(response.headers),
        status: response.status
      })
    } catch (error) {
      return Either.left(error)
    }
  }
})

export const fetchVoilaTransport: VoilaTransport = makeFetchVoilaTransport()

export const makeNodeOperationEnvironment = (
  env: Readonly<Record<string, string | undefined>> = process.env,
  transport?: VoilaTransport,
  fetchPort: NodeFetchPort = fetch
): Either.Either<OperationEnvironment, OperationFailure> =>
  Either.map(Either.mapLeft(Schema.decodeUnknownEither(EnvSchema)(env), envInvalid), (config) => {
    const effectiveTransport = transport ?? makeFetchVoilaTransport(config.VOILA_USER_AGENT, fetchPort)

    return {
      ...(config.VOILA_GUEST === "1" ? {} : { authGuidance: makeAuthGuidance(config.VOILA_AUTH_SESSION_PATH) }),
      session: makeSessionPort(config, effectiveTransport),
      transport: effectiveTransport
    }
  })

export const defaultNodeOperationEnvironment = (): OperationEnvironment => {
  const env = makeNodeOperationEnvironment()

  if (Either.isLeft(env)) {
    throw new Error(env.left.message)
  }

  return env.right
}
