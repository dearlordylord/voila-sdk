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
  updateSessionFileCarrying
} from "@firfi/voila-session-store"
import { Effect, Match, type Layer, Option, Ref, Result, Schema, Semaphore } from "effect"

import { makeAuthGuidance } from "./auth-guidance.js"
import { NodeEnvironmentSchema, type NodeEnvironmentConfig } from "./startup-config.js"
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
type EnvConfig = NodeEnvironmentConfig

const envInvalid = (): OperationFailure => ({
  _tag: "VoilaEnvironmentInvalid",
  message: "Voila MCP environment variables are invalid"
})

const sessionSnapshotMissing = (): OperationFailure => ({
  _tag: "VoilaSessionSnapshotMissing",
  message: "Configured authenticated session snapshot is missing or not authenticated"
})

const sessionSnapshotConflict = (): OperationFailure => ({
  _tag: "VoilaSessionSnapshotConflict",
  message: "Authenticated session snapshot changed during keepalive check"
})

/**
 * A guest snapshot is never written to disk: it is rebuildable with one
 * request, and persisting it is exactly what lets a guest bootstrap land on top
 * of an authenticated file.
 */
const sessionFileUpdateFor = (outcome: SessionOperationOutcome<unknown>): SessionFileUpdate =>
  Match.value(outcome.refreshed).pipe(
    Match.when(undefined, () => keepSessionFile),
    Match.when({ kind: "guest" }, () => keepSessionFile),
    Match.when({ kind: "authenticated" }, persistSession),
    Match.exhaustive
  )

// what the cycle reports back: the file decision, and the operation's own
// result on the carry channel rather than through a captured variable
const cycleStep = <A>(ran: SessionOperationOutcome<A>): SessionFileCycleStep<SessionOperationOutcome<A>> => ({
  carried: ran,
  update: sessionFileUpdateFor(ran)
})

type SessionFileAccess =
  | { readonly _tag: "ordinary" }
  | { readonly _tag: "authenticated" }
  | { readonly _tag: "authenticated-recheck" }

const ordinarySessionAccess: SessionFileAccess = { _tag: "ordinary" }
const authenticatedSessionAccess: SessionFileAccess = { _tag: "authenticated" }
const authenticatedRecheckAccess: SessionFileAccess = { _tag: "authenticated-recheck" }

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
    operation: SessionOperation<A>,
    access: SessionFileAccess
  ): Effect.Effect<A, OperationFailure, VoilaTransport> => {
    const runCycle = (): Effect.Effect<A, OperationFailure, VoilaTransport | StateFileLocks> =>
      Effect.gen(function* () {
        // A dropped update needs no adoption here: the losing snapshot is never
        // kept, and the next cycle reads whatever the winner wrote. The
        // operation's own result comes back on the outcome's carry channel —
        // on every variant, including a dropped conflict.
        const outcome: SessionFileCarriedOutcome<SessionOperationOutcome<A>> = yield* updateSessionFileCarrying(
          file,
          (current) => {
            const authenticatedSession = Match.value(current).pipe(
              Match.when(
                undefined,
                (): Effect.Effect<SdkSessionSnapshot, OperationFailure> => Effect.fail(sessionSnapshotMissing())
              ),
              Match.when(
                { kind: "guest" },
                (): Effect.Effect<SdkSessionSnapshot, OperationFailure> => Effect.fail(sessionSnapshotMissing())
              ),
              Match.when(
                { kind: "authenticated" },
                (snapshot): Effect.Effect<SdkSessionSnapshot, OperationFailure> => Effect.succeed(snapshot)
              ),
              Match.exhaustive
            )
            const ordinarySession = Match.value(current).pipe(
              Match.when(undefined, () => bootstrapGuest),
              Match.when({ kind: "guest" }, (snapshot): Effect.Effect<SdkSessionSnapshot> => Effect.succeed(snapshot)),
              Match.when(
                { kind: "authenticated" },
                (snapshot): Effect.Effect<SdkSessionSnapshot> => Effect.succeed(snapshot)
              ),
              Match.exhaustive
            )
            const session = Match.typeTags<SessionFileAccess>()({
              ordinary: () => ordinarySession,
              authenticated: () => authenticatedSession,
              "authenticated-recheck": () => authenticatedSession
            })(access)

            return Effect.map(Effect.flatMap(session, operation), cycleStep)
          }
        )

        const finish = (carried: SessionOperationOutcome<A>): Effect.Effect<A, OperationFailure> =>
          Effect.gen(function* () {
            // A refreshed guest session is kept in memory for the same reason it is
            // not written: it is the session this process keeps using, and dropping
            // the refresh would replay a stale bootstrap on every call.
            yield* Match.value(carried.refreshed).pipe(
              Match.when(undefined, () => Effect.void),
              Match.when({ kind: "guest" }, (refreshed) => Ref.set(guest, Option.some(refreshed))),
              Match.when({ kind: "authenticated" }, () => Effect.void),
              Match.exhaustive
            )

            return carried.value
          })

        return yield* Match.typeTags<SessionFileCarriedOutcome<SessionOperationOutcome<A>>>()({
          saved: ({ carried }) => finish(carried),
          unchanged: ({ carried }) => finish(carried),
          "dropped-conflict": ({ carried, session }) => {
            const recheck = Match.value(session).pipe(
              Match.when(undefined, () => Effect.fail(sessionSnapshotMissing())),
              Match.when({ kind: "guest" }, () => Effect.fail(sessionSnapshotMissing())),
              Match.when({ kind: "authenticated" }, () =>
                runWithSessionFile(file, operation, authenticatedRecheckAccess)
              ),
              Match.exhaustive
            )
            const conflict = Match.value(session).pipe(
              Match.when(undefined, () => Effect.fail(sessionSnapshotMissing())),
              Match.when({ kind: "guest" }, () => Effect.fail(sessionSnapshotMissing())),
              Match.when({ kind: "authenticated" }, () => Effect.fail(sessionSnapshotConflict())),
              Match.exhaustive
            )

            return Match.typeTags<SessionFileAccess>()({
              ordinary: () => finish(carried),
              authenticated: () => recheck,
              "authenticated-recheck": () => conflict
            })(access)
          }
        })(outcome)
      })

    return runCycle().pipe(Effect.provideService(StateFileLocks, locks))
  }

  return {
    withAuthenticatedSession: (operation) =>
      sessionFile === undefined
        ? Effect.fail(sessionSnapshotMissing())
        : runWithSessionFile(sessionFile, operation, authenticatedSessionAccess),
    withSession: (operation) =>
      sessionFile === undefined
        ? runWithGuest(operation)
        : runWithSessionFile(sessionFile, operation, ordinarySessionAccess)
  }
}

export const makeNodeOperationEnvironment = (
  env: Readonly<Record<string, string | undefined>> = process.env,
  transport?: Layer.Layer<VoilaTransport>
): Result.Result<OperationEnvironment, OperationFailure> =>
  Result.map(Result.mapError(Schema.decodeUnknownResult(NodeEnvironmentSchema)(env), envInvalid), (config) =>
    makeNodeOperationEnvironmentFromConfig(config, transport)
  )

export const makeNodeOperationEnvironmentFromConfig = (
  config: EnvConfig,
  transport?: Layer.Layer<VoilaTransport>
): OperationEnvironment => ({
  ...(config.VOILA_GUEST === "1" ? {} : { authGuidance: makeAuthGuidance(config.VOILA_AUTH_SESSION_PATH) }),
  session: makeSessionPort(config),
  transport: transport ?? nodeVoilaTransportLayer(config.VOILA_USER_AGENT)
})
