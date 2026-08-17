import { it } from "@effect/vitest"
import {
  makeAuthenticatedSdkSessionSnapshot,
  makeSessionSnapshot,
  type SdkSessionSnapshot,
  SdkSessionSnapshotSchema,
  serializeCookieJar,
  type SessionSnapshot,
  toughCookieJarPort
} from "@firfi/voila-sdk"
import { type StateFileLocks, StateFileLocksLive, StateFilePathSchema } from "@firfi/voila-session-store"
import { Effect, Either, Schema } from "effect"
import type { TestServices } from "effect/TestServices"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { describe, expect } from "vitest"

import type {
  LoginSessionPathInvalid,
  LoginSessionSuperseded,
  LoginSessionWriteError
} from "../src/auth-session-file.js"
import { parseLoginSessionPath, persistLoginSession } from "../src/auth-session-file.js"

const voilaUrl = "https://voila.ca/"
const secretCookieValue = "sanitized-cookie"
const secretCsrfToken = "sanitized-csrf-token"

// one fresh lock table per test, shared by any forked fibers inside it
const itLocks = <A, E>(name: string, self: () => Effect.Effect<A, E, StateFileLocks | TestServices>): void => {
  it.effect(name, () => Effect.provide(self(), StateFileLocksLive))
}

const makeBaseSession = (regionId: string): SessionSnapshot => {
  const jar = toughCookieJarPort.create()
  jar.setCookieSync(`voila-session=${secretCookieValue}; Path=/; Secure; HttpOnly`, voilaUrl)

  const cookieJar = serializeCookieJar(jar)

  if (Either.isLeft(cookieJar)) {
    throw new Error("Expected cookie jar serialization")
  }

  const session = makeSessionSnapshot(
    { assetVersion: "asset-version", clientRouteId: "client-route-id", pageViewId: "page-view-id", regionId },
    { token: secretCsrfToken },
    cookieJar.right
  )

  if (Either.isLeft(session)) {
    throw new Error("Expected session snapshot")
  }

  return session.right
}

const authenticated = (regionId: string): SdkSessionSnapshot => {
  const snapshot = makeAuthenticatedSdkSessionSnapshot(makeBaseSession(regionId), "authenticated")

  if (Either.isLeft(snapshot)) {
    throw new Error("Expected authenticated SDK session snapshot")
  }

  return snapshot.right
}

const encode = (snapshot: SdkSessionSnapshot): string =>
  JSON.stringify(Schema.encodeSync(SdkSessionSnapshotSchema)(snapshot))

const makeTempDir = Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "voila-login-session-")))

const sessionFile = (dir: string) => StateFilePathSchema.make(path.join(dir, "session.json"))

const readRaw = (file: string) => Effect.promise(() => fs.readFile(file, "utf8"))

const fileMode = (file: string) => Effect.promise(() => fs.stat(file).then((stats) => stats.mode & 0o777))

describe("persistLoginSession", () => {
  itLocks("creates the session file owner-only on a first login", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = sessionFile(dir)
      const login = authenticated("first-login")

      yield* persistLoginSession(file, login)

      expect(yield* readRaw(file)).toBe(encode(login))
      expect(yield* fileMode(file)).toBe(0o600)
    })
  )

  itLocks("replaces whatever the cycle finds on disk", () =>
    Effect.gen(function* () {
      const dir = yield* makeTempDir
      const file = sessionFile(dir)
      yield* Effect.promise(() => fs.writeFile(file, encode(authenticated("older-login")), { mode: 0o600 }))
      const login = authenticated("newer-login")

      yield* persistLoginSession(file, login)

      expect(yield* readRaw(file)).toBe(encode(login))
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

      const error: LoginSessionSuperseded | LoginSessionWriteError = yield* persistLoginSession(
        file,
        authenticated("login")
      ).pipe(Effect.flip)

      expect(error._tag).toBe("VoilaAuthSessionSuperseded")
      expect(error.message).not.toContain(secretCookieValue)
      expect(error.message).not.toContain(secretCsrfToken)
      expect(error.message).not.toContain(file)
    })
  )
})

describe("parseLoginSessionPath", () => {
  it.effect("accepts an absolute session path", () =>
    Effect.gen(function* () {
      expect(yield* parseLoginSessionPath("/tmp/voila/session.json")).toBe("/tmp/voila/session.json")
    })
  )

  it.effect("rejects a relative path without naming it", () =>
    Effect.gen(function* () {
      const error: LoginSessionPathInvalid = yield* parseLoginSessionPath("relative/session.json").pipe(Effect.flip)

      expect(error._tag).toBe("VoilaAuthSessionPathInvalid")
      expect(error.message).not.toContain("relative/session.json")
    })
  )
})
