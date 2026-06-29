import {
  loadSdkSessionSnapshot,
  saveSdkSessionSnapshot,
  type SdkSessionSnapshot,
  type SessionStoragePort,
  type VoilaTransport,
  type VoilaTransportRequest,
  type VoilaTransportResponse
} from "@firfi/voila-sdk"
import { Either, Schema } from "effect"
import { access, mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

import { makeAuthGuidance } from "./auth-guidance.js"
import { makeGuestSessionSnapshot, type OperationEnvironment, type OperationFailure } from "./operations.js"

const EnvSchema = Schema.Struct({
  VOILA_AUTH_SESSION_PATH: Schema.optionalWith(Schema.String.pipe(Schema.trimmed(), Schema.minLength(1)), {
    exact: true
  }),
  VOILA_GUEST: Schema.optionalWith(Schema.Literal("1"), { exact: true }),
  VOILA_SESSION_WRITE_PATH: Schema.optionalWith(Schema.String.pipe(Schema.trimmed(), Schema.minLength(1)), {
    exact: true
  })
})

type EnvConfig = Schema.Schema.Type<typeof EnvSchema>

const envInvalid = (): OperationFailure => ({
  _tag: "VoilaEnvironmentInvalid",
  message: "Voila MCP environment variables are invalid"
})

const storageFailure = (tag: string, message: string): OperationFailure => ({
  _tag: tag,
  message
})

const makeFileStorage = (path: string): SessionStoragePort => ({
  read: () => readFile(path, "utf8"),
  write: async (contents) => {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, contents, { mode: 0o600 })
  }
})

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await access(path)

    return true
  } catch {
    return false
  }
}

const loadSessionFile = async (path: string): Promise<Either.Either<SdkSessionSnapshot, OperationFailure>> => {
  const loaded = await loadSdkSessionSnapshot(makeFileStorage(path))

  return Either.mapLeft(loaded, (error) => storageFailure(error._tag, error.message))
}

const saveSessionFile = async (
  path: string,
  snapshot: SdkSessionSnapshot
): Promise<Either.Either<undefined, OperationFailure>> => {
  const saved = await saveSdkSessionSnapshot(makeFileStorage(path), snapshot)

  return Either.mapLeft(saved, (error) => storageFailure(error._tag, error.message))
}

const makeSessionPort = (
  config: EnvConfig,
  transport: VoilaTransport
): OperationEnvironment["session"] => {
  let cachedSession: SdkSessionSnapshot | undefined
  const writePath = config.VOILA_SESSION_WRITE_PATH ?? config.VOILA_AUTH_SESSION_PATH

  const loadGuest = async (): Promise<Either.Either<SdkSessionSnapshot, OperationFailure>> => {
    if (cachedSession !== undefined && cachedSession.kind === "guest") {
      return Either.right(cachedSession)
    }

    const guest = await makeGuestSessionSnapshot(transport)

    if (Either.isRight(guest)) {
      cachedSession = guest.right
    }

    return guest
  }

  return {
    load: async () => {
      if (config.VOILA_GUEST === "1") {
        return loadGuest()
      }

      if (cachedSession !== undefined) {
        return Either.right(cachedSession)
      }

      if (config.VOILA_AUTH_SESSION_PATH === undefined) {
        return loadGuest()
      }

      if (!await fileExists(config.VOILA_AUTH_SESSION_PATH)) {
        return loadGuest()
      }

      const loaded = await loadSessionFile(config.VOILA_AUTH_SESSION_PATH)

      if (Either.isRight(loaded)) {
        cachedSession = loaded.right
      }

      return loaded
    },
    save: async (snapshot) => {
      cachedSession = snapshot

      if (writePath === undefined) {
        return Either.right(undefined)
      }

      return saveSessionFile(writePath, snapshot)
    }
  }
}

const collectResponseHeaders = (headers: Headers): VoilaTransportResponse["headers"] => {
  const collected: Record<string, string> = {}

  headers.forEach((value, key) => {
    collected[key] = value
  })

  return collected
}

export const fetchVoilaTransport: VoilaTransport = {
  request: async (request: VoilaTransportRequest) => {
    let response: Response

    try {
      response = await fetch(request.url, {
        ...(request.body === undefined ? {} : { body: request.body }),
        headers: request.headers,
        method: request.method
      })
    } catch (error) {
      return Either.left(error)
    }

    return Either.right({
      body: await response.text(),
      headers: collectResponseHeaders(response.headers),
      status: response.status
    })
  }
}

export const makeNodeOperationEnvironment = (
  env: Readonly<Record<string, string | undefined>> = process.env,
  transport: VoilaTransport = fetchVoilaTransport
): Either.Either<OperationEnvironment, OperationFailure> =>
  Either.map(
    Either.mapLeft(Schema.decodeUnknownEither(EnvSchema)(env), envInvalid),
    (config) => ({
      ...(config.VOILA_GUEST === "1" ? {} : { authGuidance: makeAuthGuidance(config.VOILA_AUTH_SESSION_PATH) }),
      session: makeSessionPort(config, transport),
      transport
    })
  )

export const defaultNodeOperationEnvironment = (): OperationEnvironment => {
  const env = makeNodeOperationEnvironment()

  if (Either.isLeft(env)) {
    throw new Error(env.left.message)
  }

  return env.right
}
