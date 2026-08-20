import { it } from "@effect/vitest"
import {
  type ActiveAuthenticatedSdkSessionSnapshot,
  ActiveAuthenticatedSdkSessionSnapshotSchema,
  makeAuthenticatedSdkSessionSnapshot,
  makeSessionSnapshot,
  type SdkSessionSnapshot,
  SdkSessionSnapshotSchema,
  serializeCookieJar,
  type SessionSnapshot,
  toughCookieJarPort
} from "@firfi/voila-sdk"
import { type StateFileLocks, StateFileLocksLive, StateFilePathSchema } from "@firfi/voila-session-store"
import { Effect, Result, Schema } from "effect"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { describe, expect } from "vitest"

import type { LoginSessionWriteError } from "../src/auth-session-file.js"
import { persistValidatedLoginSession } from "../src/auth-session-file.js"

const voilaUrl = "https://voila.ca/"
const secretCookieValue = "sanitized-cookie"
const secretCsrfToken = "sanitized-csrf-token"

// one fresh lock table per test, shared by any forked fibers inside it
const itLocks = <A, E>(name: string, self: () => Effect.Effect<A, E, StateFileLocks>): void => {
  it.effect(name, () => Effect.provide(self(), StateFileLocksLive))
}

const makeBaseSession = (regionId: string): SessionSnapshot => {
  const jar = toughCookieJarPort.create()
  jar.setCookieSync(`voila-session=${secretCookieValue}; Path=/; Secure; HttpOnly`, voilaUrl)

  const cookieJar = serializeCookieJar(jar)

  if (Result.isFailure(cookieJar)) {
    throw new Error("Expected cookie jar serialization")
  }

  const session = makeSessionSnapshot(
    { assetVersion: "asset-version", clientRouteId: "client-route-id", pageViewId: "page-view-id", regionId },
    { token: secretCsrfToken },
    cookieJar.success
  )

  if (Result.isFailure(session)) {
    throw new Error("Expected session snapshot")
  }

  return session.success
}

const authenticated = (regionId: string): ActiveAuthenticatedSdkSessionSnapshot => {
  const snapshot = makeAuthenticatedSdkSessionSnapshot(makeBaseSession(regionId), "authenticated")

  if (Result.isFailure(snapshot)) {
    throw new Error("Expected authenticated SDK session snapshot")
  }

  return Schema.decodeUnknownSync(ActiveAuthenticatedSdkSessionSnapshotSchema)(snapshot.success)
}

const encode = (snapshot: SdkSessionSnapshot): string =>
  JSON.stringify(Schema.encodeSync(SdkSessionSnapshotSchema)(snapshot))

const makeTempDir = Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "voila-login-session-")))

const sessionFile = (dir: string) => StateFilePathSchema.make(path.join(dir, "session.json"))

const readRaw = (file: string) => Effect.promise(() => fs.readFile(file, "utf8"))

const fileMode = (file: string) => Effect.promise(() => fs.stat(file).then((stats) => stats.mode & 0o777))

describe("persistValidatedLoginSession", () => {
  itLocks("creates the session file owner-only after active validation", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = sessionFile(dir)
      const login = authenticated("first-login")

      yield* persistValidatedLoginSession(file, Effect.succeed({ session: login, status: "active" }))

      expect(yield* readRaw(file)).toBe(encode(login))
      expect(yield* fileMode(file)).toBe(0o600)
    })
  )

  itLocks("replaces the current snapshot only after active validation", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = sessionFile(dir)
      const older = authenticated("older-login")
      yield* persistValidatedLoginSession(file, Effect.succeed({ session: older, status: "active" }))
      const login = authenticated("newer-login")

      yield* persistValidatedLoginSession(file, Effect.succeed({ session: login, status: "active" }))

      expect(yield* readRaw(file)).toBe(encode(login))
    })
  )

  itLocks("leaves an existing authenticated snapshot untouched when validation is inactive", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = sessionFile(dir)
      const existing = authenticated("existing-login")
      const inactive = authenticated("inactive-capture")

      yield* persistValidatedLoginSession(file, Effect.succeed({ session: existing, status: "active" }))
      const health = yield* persistValidatedLoginSession(
        file,
        Effect.succeed({ reason: "server", session: inactive, status: "retry" })
      )

      expect(health.status).toBe("retry")
      expect(yield* readRaw(file)).toBe(encode(existing))
    })
  )

  itLocks("does not overwrite a newer session written while validation is in flight", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = sessionFile(dir)
      const checked = authenticated("checked-before-health")
      const newer = authenticated("newer-during-health")
      const validated = authenticated("validated-after-health")

      yield* persistValidatedLoginSession(file, Effect.succeed({ session: checked, status: "active" }))

      const error: LoginSessionWriteError = yield* persistValidatedLoginSession(
        file,
        Effect.gen(function* () {
          yield* Effect.promise(() => fs.writeFile(file, encode(newer), { mode: 0o600 }))
          return { session: validated, status: "active" }
        })
      ).pipe(Effect.flip)

      expect(error._tag).toBe("VoilaAuthSessionSuperseded")
      expect(yield* readRaw(file)).toBe(encode(newer))
    })
  )

  itLocks("keeps an already matching active validation unchanged", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = sessionFile(dir)
      const validated = authenticated("validated")

      yield* persistValidatedLoginSession(file, Effect.succeed({ session: validated, status: "active" }))
      yield* persistValidatedLoginSession(file, Effect.succeed({ session: validated, status: "active" }))

      expect(yield* readRaw(file)).toBe(encode(validated))
    })
  )

  itLocks("reports a dropped write as superseded instead of retrying over the winner", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = sessionFile(dir)
      // A dangling symlink reads as absence and refuses to be created, so the
      // cycle takes the create-if-absent path and loses it without racing two
      // writers. A real lost creation race also reports the winner's bytes;
      // this one cannot, so it stands in for the losing half only.
      yield* Effect.promise(() => fs.symlink(path.join(dir, "nowhere.json"), file))

      const error: LoginSessionWriteError = yield* persistValidatedLoginSession(
        file,
        Effect.succeed({ session: authenticated("login"), status: "active" })
      ).pipe(Effect.flip)

      expect(error._tag).toBe("VoilaAuthSessionSuperseded")
      expect(error.message).not.toContain(secretCookieValue)
      expect(error.message).not.toContain(secretCsrfToken)
      expect(error.message).not.toContain(file)
    })
  )
})
