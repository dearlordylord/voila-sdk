import { it } from "@effect/vitest"
import {
  makeAuthenticatedSdkSessionSnapshot,
  makeGuestSdkSessionSnapshot,
  makeSessionSnapshot,
  type SdkSessionSnapshot,
  SdkSessionSnapshotSchema,
  serializeCookieJar,
  toughCookieJarPort
} from "@firfi/voila-sdk"
import { type StateFilePath, StateFilePathSchema } from "@firfi/cas-file-store"
import { Deferred, Effect, Either, Fiber, Schema, TestClock } from "effect"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { describe, expect, it as vitestIt } from "vitest"

import { isGuestDowngrade } from "../src/session-file-store.js"

import {
  keepSessionFile,
  persistSession,
  type SessionFileContentsInvalid,
  type SessionFileError,
  type SessionFileGuestOverwriteRefused,
  type SessionFileReadFailure,
  type SessionFileUpdate,
  type SessionFileUpdateOutcome,
  type SessionFileWriteFailure,
  type StateFileLocks,
  StateFileLocksLive,
  updateSessionFile,
  updateSessionFileCarrying
} from "../src/index.js"
import type { TestServices } from "effect/TestServices"

// one fresh lock table per test, shared by any forked fibers inside it
const itLocks = <A, E>(name: string, self: () => Effect.Effect<A, E, StateFileLocks | TestServices>): void => {
  it.effect(name, () => Effect.provide(self(), StateFileLocksLive))
}

const voilaUrl = "https://voila.ca/"
const secretCookieValue = "secret-cookie-value"
const secretCsrfToken = "secret-csrf-token"

const makeBaseSession = (regionId: string) => {
  const jar = toughCookieJarPort.create()
  jar.setCookieSync(`voila-session=${secretCookieValue}; Path=/; Secure; HttpOnly`, voilaUrl)

  const cookieJar = serializeCookieJar(jar)

  if (Either.isLeft(cookieJar)) {
    throw new Error("Expected cookie jar serialization to succeed")
  }

  const session = makeSessionSnapshot(
    { assetVersion: "asset-version", clientRouteId: "client-route-id", pageViewId: "page-view-id", regionId },
    { token: secretCsrfToken },
    cookieJar.right
  )

  if (Either.isLeft(session)) {
    throw new Error("Expected session snapshot creation to succeed")
  }

  return session.right
}

const guestSnapshot = (regionId = "guest-region"): SdkSessionSnapshot => {
  const snapshot = makeGuestSdkSessionSnapshot(makeBaseSession(regionId))

  if (Either.isLeft(snapshot)) {
    throw new Error("Expected guest SDK session snapshot creation to succeed")
  }

  return snapshot.right
}

const authenticatedSnapshot = (regionId = "authenticated-region"): SdkSessionSnapshot => {
  const snapshot = makeAuthenticatedSdkSessionSnapshot(makeBaseSession(regionId), "authenticated")

  if (Either.isLeft(snapshot)) {
    throw new Error("Expected authenticated SDK session snapshot creation to succeed")
  }

  return snapshot.right
}

const makeTempDir = Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "voila-session-store-")))

// tests own absolute temp paths, so the brand is applied directly; production
// callers parse a configured path through `parseStateFilePath`
const sessionFile = (dir: string): StateFilePath => StateFilePathSchema.make(path.join(dir, "session.json"))

const encodeSnapshot = (snapshot: SdkSessionSnapshot) =>
  JSON.stringify(Schema.encodeSync(SdkSessionSnapshotSchema)(snapshot))

const writeRaw = (file: string, contents: string) => Effect.promise(() => fs.writeFile(file, contents, { mode: 0o600 }))

const writeSnapshot = (file: string, snapshot: SdkSessionSnapshot) => writeRaw(file, encodeSnapshot(snapshot))

const readRaw = (file: string) => Effect.promise(() => fs.readFile(file, "utf8"))

const fileMode = (file: string) => Effect.promise(() => fs.stat(file).then((stats) => stats.mode & 0o777))

const fileExists = (file: string) =>
  Effect.promise(() =>
    fs.access(file).then(
      () => true,
      () => false
    )
  )

const regionOf = (snapshot: SdkSessionSnapshot | undefined) => snapshot?.session.metadata.regionId

const transformBoom = { _tag: "TransformBoom", message: "the caller's own failure" } as const

// A caller whose transform waits, so an independent writer can land in the
// middle of its read-decide-write window.
const slowUpdate =
  (entered: Deferred.Deferred<void>, next: SdkSessionSnapshot) => (): Effect.Effect<SessionFileUpdate> =>
    Deferred.succeed(entered, undefined).pipe(
      Effect.zipRight(Effect.sleep("1 second")),
      Effect.as(persistSession(next))
    )

describe("updateSessionFile: creation", () => {
  itLocks("runs the transform against absence and creates the file owner-only", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = sessionFile(dir)
      const created = guestSnapshot()

      const outcome: SessionFileUpdateOutcome = yield* updateSessionFile(file, (current) =>
        Effect.succeed(current === undefined ? persistSession(created) : keepSessionFile)
      )

      expect(outcome).toEqual({ _tag: "saved", session: created })
      expect(yield* fileMode(file)).toBe(0o600)
      expect(yield* readRaw(file)).toBe(encodeSnapshot(created))
    })
  )

  itLocks("creates the session file's directory on a first run", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = sessionFile(path.join(dir, "config", "voila"))
      const created = guestSnapshot()

      const outcome = yield* updateSessionFile(file, () => Effect.succeed(persistSession(created)))

      expect(outcome).toEqual({ _tag: "saved", session: created })
      expect(yield* readRaw(file)).toBe(encodeSnapshot(created))
    })
  )

  itLocks("drops the update when another caller created the file first", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = sessionFile(dir)
      const theirs = authenticatedSnapshot("theirs")

      const entered = yield* Deferred.make<void>()
      const fiber = yield* Effect.fork(updateSessionFile(file, slowUpdate(entered, guestSnapshot("ours"))))

      yield* Deferred.await(entered)
      yield* writeSnapshot(file, theirs)
      yield* TestClock.adjust("2 seconds")

      const outcome = yield* Fiber.join(fiber)

      // concurrent creation resolves without corruption and without a failure:
      // the winner stands and the loser is handed it
      expect(outcome).toEqual({ _tag: "dropped-conflict", session: theirs })
      expect(yield* readRaw(file)).toBe(encodeSnapshot(theirs))
    })
  )

  itLocks("leaves a missing file missing when the transform keeps it", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = sessionFile(dir)

      const outcome = yield* updateSessionFile(file, () => Effect.succeed(keepSessionFile))

      expect(outcome).toEqual({ _tag: "unchanged" })
      expect(yield* fileExists(file)).toBe(false)
    })
  )
})

describe("updateSessionFile: update", () => {
  itLocks("hands the transform the snapshot currently on disk", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = sessionFile(dir)
      const onDisk = authenticatedSnapshot("on-disk")
      yield* writeSnapshot(file, onDisk)

      const outcome = yield* updateSessionFile(file, (current) =>
        Effect.succeed(persistSession(authenticatedSnapshot(`${regionOf(current)}+seen`)))
      )

      expect(outcome._tag).toBe("saved")
      expect(regionOf(outcome._tag === "saved" ? outcome.session : undefined)).toBe("on-disk+seen")
    })
  )

  itLocks("leaves an existing file untouched when the transform keeps it", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = sessionFile(dir)
      const onDisk = authenticatedSnapshot("on-disk")
      yield* writeSnapshot(file, onDisk)

      const outcome = yield* updateSessionFile(file, () => Effect.succeed(keepSessionFile))

      expect(outcome).toEqual({ _tag: "unchanged" })
      expect(yield* readRaw(file)).toBe(encodeSnapshot(onDisk))
    })
  )

  itLocks("drops the update and reports the snapshot that won", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = sessionFile(dir)
      yield* writeSnapshot(file, authenticatedSnapshot("boot"))
      const fresh = authenticatedSnapshot("fresh-login")

      const entered = yield* Deferred.make<void>()
      const fiber = yield* Effect.fork(
        updateSessionFile(file, slowUpdate(entered, authenticatedSnapshot("background-refresh")))
      )

      // an interactive login in another process lands mid-flight
      yield* Deferred.await(entered)
      yield* writeSnapshot(file, fresh)
      yield* TestClock.adjust("2 seconds")

      const outcome = yield* Fiber.join(fiber)

      expect(outcome).toEqual({ _tag: "dropped-conflict", session: fresh })
      expect(yield* readRaw(file)).toBe(encodeSnapshot(fresh))
    })
  )

  itLocks("reports a dropped update without a snapshot when the winner removed the file", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = sessionFile(dir)
      yield* writeSnapshot(file, authenticatedSnapshot("boot"))

      const entered = yield* Deferred.make<void>()
      const fiber = yield* Effect.fork(updateSessionFile(file, slowUpdate(entered, authenticatedSnapshot("ours"))))

      yield* Deferred.await(entered)
      yield* Effect.promise(() => fs.rm(file))
      yield* TestClock.adjust("2 seconds")

      expect(yield* Fiber.join(fiber)).toEqual({ _tag: "dropped-conflict", session: undefined })
      expect(yield* fileExists(file)).toBe(false)
    })
  )

  itLocks("lets two independent callers over one file both land", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = sessionFile(dir)

      const append = (current: SdkSessionSnapshot | undefined) =>
        Effect.succeed(persistSession(authenticatedSnapshot(`${regionOf(current) ?? "new"}+`)))

      const first = yield* Effect.fork(updateSessionFile(file, append))
      yield* Effect.yieldNow()
      const second = yield* Effect.fork(updateSessionFile(file, append))

      expect((yield* Fiber.join(first))._tag).toBe("saved")
      expect((yield* Fiber.join(second))._tag).toBe("saved")
      // neither update was lost: the second saw what the first wrote
      expect(regionOf(Schema.decodeUnknownSync(SdkSessionSnapshotSchema)(JSON.parse(yield* readRaw(file))))).toBe(
        "new++"
      )
    })
  )
})

describe("updateSessionFile: transform effects", () => {
  itLocks("surfaces the transform's own typed failure unchanged and leaves the file alone", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = sessionFile(dir)
      const onDisk = authenticatedSnapshot("on-disk")
      yield* writeSnapshot(file, onDisk)

      const error = yield* updateSessionFile(file, () => Effect.fail(transformBoom)).pipe(Effect.flip)

      expect(error).toEqual(transformBoom)
      expect(yield* readRaw(file)).toBe(encodeSnapshot(onDisk))
    })
  )

  itLocks("covers I/O performed inside the transform with the conflict check", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = sessionFile(dir)
      yield* writeSnapshot(file, guestSnapshot("boot"))
      const fresh = authenticatedSnapshot("fresh-login")

      // the transform's own I/O (here: a read of another file, standing in for
      // a request whose Set-Cookie is folded into the snapshot) happens inside
      // the guarded window, not before it
      const marker = path.join(dir, "response.txt")
      yield* writeRaw(marker, "set-cookie")

      const entered = yield* Deferred.make<void>()
      const fiber = yield* Effect.fork(
        updateSessionFile(file, () =>
          Deferred.succeed(entered, undefined).pipe(
            Effect.zipRight(Effect.sleep("1 second")),
            Effect.zipRight(readRaw(marker)),
            Effect.map((body) => persistSession(guestSnapshot(`rotated-${body}`)))
          )
        )
      )

      yield* Deferred.await(entered)
      yield* writeSnapshot(file, fresh)
      yield* TestClock.adjust("2 seconds")

      expect(yield* Fiber.join(fiber)).toEqual({ _tag: "dropped-conflict", session: fresh })
    })
  )
})

describe("updateSessionFile: guest downgrade", () => {
  itLocks("refuses to replace an authenticated snapshot with a guest one", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = sessionFile(dir)
      const onDisk = authenticatedSnapshot("logged-in")
      yield* writeSnapshot(file, onDisk)

      const error: SessionFileGuestOverwriteRefused | SessionFileError = yield* updateSessionFile(file, () =>
        Effect.succeed(persistSession(guestSnapshot()))
      ).pipe(Effect.flip)

      expect(error._tag).toBe("SessionFileGuestOverwriteRefused")
      expect(yield* readRaw(file)).toBe(encodeSnapshot(onDisk))
    })
  )

  itLocks("allows a guest snapshot to replace a guest one", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = sessionFile(dir)
      yield* writeSnapshot(file, guestSnapshot("old"))
      const next = guestSnapshot("new")

      expect(yield* updateSessionFile(file, () => Effect.succeed(persistSession(next)))).toEqual({
        _tag: "saved",
        session: next
      })
    })
  )

  itLocks("allows an authenticated snapshot to replace a guest one", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = sessionFile(dir)
      yield* writeSnapshot(file, guestSnapshot("old"))
      const next = authenticatedSnapshot("login")

      expect(yield* updateSessionFile(file, () => Effect.succeed(persistSession(next)))).toEqual({
        _tag: "saved",
        session: next
      })
    })
  )

  itLocks("allows a guest snapshot when the file does not exist yet", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = sessionFile(dir)
      const next = guestSnapshot("bootstrap")

      expect(yield* updateSessionFile(file, () => Effect.succeed(persistSession(next)))).toEqual({
        _tag: "saved",
        session: next
      })
    })
  )
})

describe("updateSessionFile: failures", () => {
  itLocks("fails with SessionFileContentsInvalid when the stored snapshot is corrupt", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = sessionFile(dir)
      yield* writeRaw(file, `{"kind":"guest","session":${secretCsrfToken}`)

      const error: SessionFileContentsInvalid | SessionFileError = yield* updateSessionFile(file, () =>
        Effect.succeed(keepSessionFile)
      ).pipe(Effect.flip)

      expect(error._tag).toBe("SessionFileContentsInvalid")
      expect(error.message).not.toContain(secretCsrfToken)
      expect(error.message).not.toContain(file)
    })
  )

  itLocks("fails with SessionFileContentsInvalid when the stored JSON is not a session snapshot", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = sessionFile(dir)
      yield* writeRaw(file, JSON.stringify({ kind: "guest" }))

      const error: SessionFileError = yield* updateSessionFile(file, () => Effect.succeed(keepSessionFile)).pipe(
        Effect.flip
      )

      expect(error._tag).toBe("SessionFileContentsInvalid")
    })
  )

  itLocks("fails with SessionFileReadFailure when the path cannot be read", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir

      const error: SessionFileReadFailure | SessionFileError = yield* updateSessionFile(
        StateFilePathSchema.make(dir),
        () => Effect.succeed(keepSessionFile)
      ).pipe(Effect.flip)

      expect(error._tag).toBe("SessionFileReadFailure")
    })
  )

  itLocks("fails with SessionFileWriteFailure when the durable write cannot complete", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      // a 255-byte basename: the sibling tmp name exceeds the filesystem's
      // component limit, so the write fails while reads still work
      const file = StateFilePathSchema.make(path.join(dir, `${"s".repeat(250)}.json`))
      const onDisk = guestSnapshot("on-disk")
      yield* writeSnapshot(file, onDisk)

      const error: SessionFileWriteFailure | SessionFileError = yield* updateSessionFile(file, () =>
        Effect.succeed(persistSession(guestSnapshot("next")))
      ).pipe(Effect.flip)

      expect(error._tag).toBe("SessionFileWriteFailure")
      expect(error.message).not.toContain(secretCookieValue)
      expect(error.message).not.toContain(secretCsrfToken)
      expect(yield* readRaw(file)).toBe(encodeSnapshot(onDisk))
    })
  )
})

describe("updateSessionFileCarrying", () => {
  itLocks("carries the update's value through every outcome variant", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = sessionFile(dir)

      const kept = yield* updateSessionFileCarrying(file, (current) =>
        Effect.succeed({ carried: current === undefined ? "saw absence" : "saw a file", update: keepSessionFile })
      )

      expect(kept).toEqual({ _tag: "unchanged", carried: "saw absence" })
      expect(yield* fileExists(file)).toBe(false)

      const saved = yield* updateSessionFileCarrying(file, () =>
        Effect.succeed({ carried: "login finished", update: persistSession(authenticatedSnapshot("login")) })
      )

      expect(saved._tag).toBe("saved")
      expect(saved._tag === "saved" ? [saved.carried, saved.session.kind] : []).toEqual([
        "login finished",
        "authenticated"
      ])
    })
  )

  itLocks("carries the update's value through a dropped conflict", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = sessionFile(dir)
      yield* writeSnapshot(file, guestSnapshot("on-disk"))

      const entered = yield* Deferred.make<void>()
      const fiber = yield* Effect.fork(
        updateSessionFileCarrying(file, () =>
          Deferred.succeed(entered, undefined).pipe(
            Effect.zipRight(Effect.sleep("1 second")),
            Effect.as({ carried: "operation result", update: persistSession(guestSnapshot("stale")) })
          )
        )
      )

      yield* Deferred.await(entered)
      const winner = authenticatedSnapshot("winner")
      yield* writeSnapshot(file, winner)
      yield* TestClock.adjust("2 seconds")

      const outcome = yield* Fiber.join(fiber)

      expect(outcome._tag).toBe("dropped-conflict")
      expect(outcome.carried).toBe("operation result")
      expect(outcome._tag === "dropped-conflict" ? outcome.session : undefined).toEqual(winner)
    })
  )
})

describe("isGuestDowngrade", () => {
  vitestIt("refuses a guest snapshot over an authenticated one", () => {
    expect(isGuestDowngrade(authenticatedSnapshot(), guestSnapshot())).toBe(true)
  })

  vitestIt("allows every other combination", () => {
    expect(isGuestDowngrade(undefined, guestSnapshot())).toBe(false)
    expect(isGuestDowngrade(guestSnapshot(), guestSnapshot())).toBe(false)
    expect(isGuestDowngrade(guestSnapshot(), authenticatedSnapshot())).toBe(false)
    expect(isGuestDowngrade(authenticatedSnapshot(), authenticatedSnapshot())).toBe(false)
  })
})
