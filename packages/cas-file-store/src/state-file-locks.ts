/**
 * Same-process write exclusion for state files, owned by an Effect service
 * rather than a module-global table.
 *
 * A `modify` cycle holds one permit on the file's semaphore for the duration
 * of an attempt, so two fibers in one process cannot interleave their
 * read-modify-write windows. Cross-process safety comes from the CAS check
 * alone (docs/adr/0001-cas-file-store-conflict-policy.md).
 *
 * The table is bounded: a checkout that would exceed the capacity evicts the
 * least recently released idle entries first, so a long-lived process (the
 * MCP server) that touches many state files does not accumulate semaphores
 * forever. Eviction never touches an entry with a holder or a waiter, so it
 * can never split one file across two semaphores; with more paths in flight
 * than the capacity, the table simply grows past it for that moment. No
 * background fiber and no timers are involved, so the service cannot keep a
 * short-lived process (the CLI) alive.
 */
import { Context, Effect, Layer, Option, Ref } from "effect"

/** How many per-file locks a table keeps before evicting the idlest ones. */
const defaultLocksCapacity = 256

interface LockEntry {
  readonly semaphore: Effect.Semaphore
  readonly active: number
  readonly idleSeq: Option.Option<number>
}

interface LockTable {
  readonly entries: Map<string, LockEntry>
  // stamps check-ins with a monotone sequence, so "least recently released"
  // needs no clock
  readonly released: number
}

/**
 * The service surface: run `effect` holding the one permit for `key`. Keys are
 * resolved absolute paths; callers in this package pass the resolved state
 * file path, so every spelling of one file shares one lock.
 */
export interface StateFileLocksService {
  readonly withPermit: <A, E, R>(key: string, effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
}

export class StateFileLocks extends Context.Tag("@firfi/cas-file-store/StateFileLocks")<
  StateFileLocks,
  StateFileLocksService
>() {}

const evictIdle = (entries: ReadonlyMap<string, LockEntry>, capacity: number): Map<string, LockEntry> => {
  if (entries.size < capacity) {
    return new Map(entries)
  }

  const idle = [...entries]
    .filter(([, entry]) => entry.active === 0 && Option.isSome(entry.idleSeq))
    .sort(
      ([leftKey, left], [rightKey, right]) =>
        // idleSeq is Some by the filter above; the key settles ties stably
        Option.getOrElse(left.idleSeq, () => 0) - Option.getOrElse(right.idleSeq, () => 0) ||
        leftKey.localeCompare(rightKey)
    )

  const evicted = new Map(entries)

  for (const [key] of idle.slice(0, entries.size - capacity + 1)) {
    evicted.delete(key)
  }

  return evicted
}

/**
 * Build a lock table with its own state. The constructor is a pure `Ref`
 * allocation, so a composition root that cannot provide a `Layer` can still
 * build one instance up front and share it across every cycle in the process.
 */
export const makeStateFileLocks = (capacity = defaultLocksCapacity): Effect.Effect<StateFileLocksService> =>
  Effect.map(Ref.make<LockTable>({ entries: new Map(), released: 0 }), (table) => {
    const checkout = (key: string): Effect.Effect<Effect.Semaphore> =>
      Ref.modify(table, ({ entries, released }) => {
        const existing = entries.get(key)

        if (existing !== undefined) {
          const updated: LockEntry = { ...existing, active: existing.active + 1, idleSeq: Option.none() }

          return [existing.semaphore, { entries: new Map(entries).set(key, updated), released }]
        }

        const semaphore = Effect.unsafeMakeSemaphore(1)

        return [
          semaphore,
          { entries: evictIdle(entries, capacity).set(key, { active: 1, idleSeq: Option.none(), semaphore }), released }
        ]
      })

    const checkin = (key: string): Effect.Effect<void> =>
      Ref.update(table, ({ entries, released }) => {
        const existing = entries.get(key)

        // checkout and checkin pair up inside withPermit, so the entry is
        // always present; a missing one would mean a bug in this module
        if (existing === undefined) {
          return { entries: new Map(entries), released }
        }

        const active = existing.active - 1
        const updated: LockEntry = {
          ...existing,
          active,
          idleSeq: active === 0 ? Option.some(released) : existing.idleSeq
        }

        return { entries: new Map(entries).set(key, updated), released: released + 1 }
      })

    // checkout/checkin run uninterruptibly so the active count stays exact even
    // when the locked effect is interrupted mid-attempt
    const withPermit: StateFileLocksService["withPermit"] = (key, effect) =>
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const semaphore = yield* checkout(key)

          return yield* restore(semaphore.withPermits(1)(effect)).pipe(Effect.ensuring(checkin(key)))
        })
      )

    return { withPermit }
  })

/** A `Layer` building a fresh lock table, for composition roots and tests. */
export const stateFileLocksLayer = (capacity?: number): Layer.Layer<StateFileLocks> =>
  Layer.effect(StateFileLocks, makeStateFileLocks(capacity))

/** The default layer: a fresh lock table with the default capacity. */
export const StateFileLocksLive: Layer.Layer<StateFileLocks> = stateFileLocksLayer()
