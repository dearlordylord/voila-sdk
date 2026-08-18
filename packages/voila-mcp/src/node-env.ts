import type { SdkSessionSnapshot, VoilaTransport } from "@firfi/voila-sdk"
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
import { Effect, type Layer, Option, Ref, Result, Schema, Semaphore } from "effect"

import { makeAuthGuidance } from "./auth-guidance.js"
import {
  makeGuestSessionSnapshot,
  type OperationEnvironment,
  type OperationFailure,
  type OperationSessionPort,
  type SessionOperation,
  type SessionOperationOutcome
} from "./operations.js"
import { nodeVoilaTransportLayer } from "./node-transport.js"

// One configured path, parsed here at the environment boundary: the read path
// and the write path cannot differ, because a write compared against a file
// nobody reads guarantees nothing.
const EnvSchema = Schema.Struct({
  VOILA_AUTH_SESSION_PATH: Schema.optionalKey(StateFilePathSchema),
  VOILA_GUEST: Schema.optionalKey(Schema.Literal("1")),
  VOILA_USER_AGENT: Schema.optionalKey(Schema.Trimmed.check(Schema.isNonEmpty()))
})

type EnvConfig = Schema.Schema.Type<typeof EnvSchema>

const envInvalid = (): OperationFailure => ({
  _tag: "VoilaEnvironmentInvalid",
  message: "Voila MCP environment variables are invalid"
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

const makeSessionPort = (config: EnvConfig): OperationSessionPort => {
  // The guest session lives for the process's lifetime instead of on disk, and
  // is the only session this port holds in memory. A configured session file is
  // read inside every update cycle, so a login that lands between two
  // operations is picked up without a restart.
  const guest = Effect.runSync(Ref.make(Option.none<SdkSessionSnapshot>()))
  // guards the bootstrap check-and-fetch: two concurrent fibers must not each
  // pay for a guest bootstrap
  const guestBootstrapLock = Semaphore.makeUnsafe(1)
  // one lock table per environment, shared by every session-file cycle in this
  // process: per-cycle tables would exclude nothing
  const locks = Effect.runSync(makeStateFileLocks())
  const sessionFile = config.VOILA_GUEST === "1" ? undefined : config.VOILA_AUTH_SESSION_PATH

  const bootstrapGuest: Effect.Effect<SdkSessionSnapshot, OperationFailure, VoilaTransport> =
    guestBootstrapLock.withPermits(1)(
      Effect.gen(function* () {
        const cached = yield* Ref.get(guest)

        if (Option.isSome(cached)) {
          return cached.value
        }

        const snapshot = yield* makeGuestSessionSnapshot()
        yield* Ref.set(guest, Option.some(snapshot))

        return snapshot
      })
    )

  const runWithGuest = <A>(operation: SessionOperation<A>): Effect.Effect<A, OperationFailure, VoilaTransport> =>
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
  ): Effect.Effect<A, OperationFailure, VoilaTransport> =>
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

export const makeNodeOperationEnvironment = (
  env: Readonly<Record<string, string | undefined>> = process.env,
  transport?: Layer.Layer<VoilaTransport>
): Result.Result<OperationEnvironment, OperationFailure> =>
  Result.map(Result.mapError(Schema.decodeUnknownResult(EnvSchema)(env), envInvalid), (config) => ({
    ...(config.VOILA_GUEST === "1" ? {} : { authGuidance: makeAuthGuidance(config.VOILA_AUTH_SESSION_PATH) }),
    session: makeSessionPort(config),
    transport: transport ?? nodeVoilaTransportLayer(config.VOILA_USER_AGENT)
  }))

export const defaultNodeOperationEnvironment = (): OperationEnvironment => {
  const env = makeNodeOperationEnvironment()

  if (Result.isFailure(env)) {
    throw new Error(env.failure.message)
  }

  return env.success
}
