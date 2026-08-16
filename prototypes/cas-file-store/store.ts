// PROTOTYPE — throwaway. Answers: which CAS conflict policy for the session
// file store is the global maximum? Not for app code.
//
// Model: a "process" is a store instance over the same JSON file. The
// keepalive tick is read -> slow network rotation -> write. A login is a
// blind whole-file replace from another process.
import { Effect, Ref, Schedule } from "effect"
import * as fs from "node:fs/promises"
import * as path from "node:path"

export interface Session {
  readonly lineage: string // which login this snapshot descends from
  readonly cookies: string
  readonly rotations: number
}

export type TickOutcome = "saved" | "dropped-conflict"

export class Conflict extends Error {
  readonly _tag = "Conflict"
}

// --- file primitives ---------------------------------------------------------

const readRaw = (file: string) =>
  Effect.tryPromise({
    try: () => fs.readFile(file, "utf8"),
    catch: (e) => new Error(`read failed: ${e}`)
  })

// atomic write: tmp file + rename (no torn reads, no truncated JSON on crash)
const writeRawAtomic = (file: string, contents: string) =>
  Effect.tryPromise({
    try: async () => {
      const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`)
      await fs.writeFile(tmp, contents, { mode: 0o600 })
      await fs.rename(tmp, file)
    },
    catch: (e) => new Error(`write failed: ${e}`)
  })

// status quo: direct writeFile, can leave a torn file on crash
const writeRawDirect = (file: string, contents: string) =>
  Effect.tryPromise({
    try: () => fs.writeFile(file, contents, { mode: 0o600 }),
    catch: (e) => new Error(`write failed: ${e}`)
  })

const parse = (raw: string): Session => JSON.parse(raw) as Session

// A network rotation: slow (models the HTTP call) and derives new content
// strictly from the snapshot it was given.
export type Network = (s: Session) => Effect.Effect<Session>

export const rotateCookie: Network = (s) =>
  Effect.sleep("1 second").pipe(
    Effect.as({ ...s, cookies: `${s.cookies}->r${s.rotations + 1}`, rotations: s.rotations + 1 })
  )

// --- variant 0: status quo (node-env.ts makeSessionPort) ----------------------
// process-lifetime cache; load reads the file once, ever; save writes blindly.

export const makeNaiveStore = (file: string) =>
  Effect.gen(function* () {
    const cache = yield* Ref.make<Session | undefined>(undefined)

    const load = Ref.get(cache).pipe(Effect.flatMap((cached) =>
      cached !== undefined
        ? Effect.succeed(cached)
        : readRaw(file).pipe(
          Effect.map(parse),
          Effect.tap((s) => Ref.set(cache, s))
        )
    ))

    const replace = (s: Session) => writeRawDirect(file, JSON.stringify(s))

    const tick = (network: Network): Effect.Effect<TickOutcome> =>
      Effect.gen(function* () {
        const session = yield* load
        const rotated = yield* network(session)
        yield* Ref.set(cache, rotated)
        yield* writeRawDirect(file, JSON.stringify(rotated))
        return "saved" as const
      })

    return { load, replace, tick }
  })

// --- variant A: re-read per tick + CAS drop ----------------------------------
// no cache; before writing, re-read and compare with what we loaded;
// on mismatch, drop our update — the other writer's lineage wins.

export const makeCasDropStore = (file: string) => {
  const replace = (s: Session) => writeRawAtomic(file, JSON.stringify(s))

  const tick = (network: Network): Effect.Effect<TickOutcome> =>
    Effect.gen(function* () {
      const base = yield* readRaw(file)
      const rotated = yield* network(parse(base))
      const current = yield* readRaw(file)

      if (current !== base) {
        return "dropped-conflict" as const
      }

      yield* writeRawAtomic(file, JSON.stringify(rotated))
      return "saved" as const
    })

  return { replace, tick }
}

// --- variant B: optimistic retry ----------------------------------------------
// on conflict, re-read the fresh file and re-run the whole rotation against
// the new base; bounded via Effect Schedule. Cost: the HTTP call is repeated.

export const makeCasRetryStore = (file: string) => {
  const replace = (s: Session) => writeRawAtomic(file, JSON.stringify(s))

  const tick = (network: Network): Effect.Effect<TickOutcome, Conflict> =>
    Effect.gen(function* () {
      const base = yield* readRaw(file)
      const rotated = yield* network(parse(base))
      const current = yield* readRaw(file)

      if (current !== base) {
        return yield* Effect.fail(new Conflict())
      }

      yield* writeRawAtomic(file, JSON.stringify(rotated))
      return "saved" as const
    }).pipe(
      Effect.retry(Schedule.recurs(3).pipe(Schedule.addDelay(() => "10 millis")))
    )

  return { replace, tick }
}

// --- variant C: lockfile serialization ----------------------------------------
// mkdir is atomic: first process wins, others retry. Release is guaranteed by
// acquireUseRelease even on interruption. Serializes the whole RMW region.

export const makeLockStore = (file: string) => {
  const lockDir = `${file}.lock`

  const acquire = Effect.tryPromise({
    try: () => fs.mkdir(lockDir),
    catch: () => new Conflict()
  }).pipe(
    Effect.retry(Schedule.recurs(200).pipe(Schedule.addDelay(() => "50 millis")))
  )

  const release = Effect.tryPromise({
    try: () => fs.rmdir(lockDir),
    catch: (e) => new Error(`lock release failed: ${e}`)
  }).pipe(Effect.ignore)

  const replace = (s: Session) => writeRawAtomic(file, JSON.stringify(s))

  const tick = (network: Network): Effect.Effect<TickOutcome> =>
    Effect.acquireUseRelease(
      acquire,
      () =>
        Effect.gen(function* () {
          const session = parse(yield* readRaw(file))
          const rotated = yield* network(session)
          yield* writeRawAtomic(file, JSON.stringify(rotated))
          return "saved" as const
        }),
      () => release
    )

  return { replace, tick }
}
