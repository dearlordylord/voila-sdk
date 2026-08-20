import { Context, Effect, Layer, Option, Ref, Semaphore } from "effect"

/**
 * Same-process write exclusion for state files, owned by an Effect service.
 * Cross-process safety comes from the CAS check in the file engine.
 */
export interface StateFileLocksService {
  readonly withPermit: <A, E, R>(key: string, effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
}

export class StateFileLocks extends Context.Service<StateFileLocks, StateFileLocksService>()(
  "@firfi/voila-session-store/StateFileLocks"
) {}

/** How many per-file locks a table keeps before evicting idle entries. */
const defaultLocksCapacity = 256

interface LockEntry {
  readonly active: number
  readonly idleSeq: Option.Option<number>
  readonly semaphore: Semaphore.Semaphore
}

interface LockTable {
  readonly entries: ReadonlyMap<string, LockEntry>
  readonly released: number
}

const evictIdle = (entries: ReadonlyMap<string, LockEntry>, capacity: number): Map<string, LockEntry> => {
  if (entries.size < capacity) {
    return new Map(entries)
  }

  const idle = [...entries]
    .filter(([, entry]) => entry.active === 0 && Option.isSome(entry.idleSeq))
    .sort(([, left], [, right]) => {
      const leftIdleSeq = Option.getOrThrow(left.idleSeq)
      const rightIdleSeq = Option.getOrThrow(right.idleSeq)

      return leftIdleSeq - rightIdleSeq
    })

  const evicted = new Map(entries)
  for (const [key] of idle.slice(0, entries.size - capacity + 1)) {
    evicted.delete(key)
  }
  return evicted
}

/**
 * Build a lock table with its own state. A capacity may be supplied by
 * composition roots and tests; idle entries are evicted in least-recently
 * released order, while active entries and waiters remain protected.
 */
export const makeStateFileLocks = (capacity = defaultLocksCapacity): Effect.Effect<StateFileLocksService> =>
  Effect.map(Ref.make<LockTable>({ entries: new Map(), released: 0 }), (table) => {
    const checkout = (key: string) =>
      Ref.modify(table, ({ entries, released }) => {
        const existing = entries.get(key)
        if (existing !== undefined) {
          const updated: LockEntry = { ...existing, active: existing.active + 1, idleSeq: Option.none() }
          return [existing.semaphore, { entries: new Map(entries).set(key, updated), released }]
        }

        const semaphore = Semaphore.makeUnsafe(1)
        return [
          semaphore,
          { entries: evictIdle(entries, capacity).set(key, { active: 1, idleSeq: Option.none(), semaphore }), released }
        ]
      })

    const checkin = (key: string) =>
      Ref.update(table, ({ entries, released }) => {
        const existing = Option.getOrThrow(Option.fromUndefinedOr(entries.get(key)))

        const active = existing.active - 1
        const updated: LockEntry = {
          ...existing,
          active,
          idleSeq: active === 0 ? Option.some(released) : existing.idleSeq
        }
        return { entries: new Map(entries).set(key, updated), released: released + 1 }
      })

    return {
      withPermit: <A, E, R>(key: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
        Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const semaphore = yield* checkout(key)
            return yield* restore(semaphore.withPermits(1)(effect)).pipe(Effect.ensuring(checkin(key)))
          })
        )
    }
  })

const stateFileLocksLayer = (capacity?: number): Layer.Layer<StateFileLocks> =>
  Layer.effect(StateFileLocks, makeStateFileLocks(capacity))

export const StateFileLocksLive = stateFileLocksLayer()
