import { Either } from "effect"
import { CookieJar } from "tough-cookie"

import { parseUnknown } from "../domain/parse.js"
import {
  type AuthAccountSummary,
  type AuthenticatedSdkSessionSnapshot,
  AuthenticatedSdkSessionSnapshotSchema,
  type CsrfState,
  type GuestSdkSessionSnapshot,
  GuestSdkSessionSnapshotSchema,
  type SdkSessionSnapshot,
  type SdkSessionSnapshotDiagnostic,
  SdkSessionSnapshotDiagnosticSchema,
  SdkSessionSnapshotSchema,
  type SerializedCookieJarSnapshot,
  SerializedCookieJarSnapshotSchema,
  type SessionMetadata,
  type SessionMetadataDiagnostic,
  type SessionSnapshot,
  type SessionSnapshotDiagnostic,
  SessionSnapshotDiagnosticSchema,
  SessionSnapshotSchema
} from "../domain/schemas/index.js"

export type CookieJarPortError =
  | {
    readonly _tag: "CookieJarSerializationUnsupported"
  }
  | {
    readonly _tag: "CookieJarSerializationFailed"
    readonly message: string
  }
  | {
    readonly _tag: "CookieJarSnapshotSchemaMismatch"
    readonly message: string
  }
  | {
    readonly _tag: "CookieJarSnapshotImportFailed"
    readonly message: string
  }

export interface CookieJarPort {
  readonly create: () => CookieJar
  readonly deserialize: (snapshot: SerializedCookieJarSnapshot) => Either.Either<CookieJar, CookieJarPortError>
  readonly serialize: (jar: SerializableCookieJar) => Either.Either<SerializedCookieJarSnapshot, CookieJarPortError>
}

export interface SerializableCookieJar {
  readonly serializeSync: () => unknown
}

export type SessionSnapshotError =
  | CookieJarPortError
  | {
    readonly _tag: "SessionSnapshotSchemaMismatch"
    readonly message: string
  }

const cookieJarSerializationUnsupported = (): CookieJarPortError => ({
  _tag: "CookieJarSerializationUnsupported"
})

const cookieJarSerializationFailed = (_cause: unknown): CookieJarPortError => ({
  _tag: "CookieJarSerializationFailed",
  message: "Cookie jar serialization failed"
})

const cookieJarSnapshotSchemaMismatch = (): CookieJarPortError => ({
  _tag: "CookieJarSnapshotSchemaMismatch",
  message: "Serialized cookie jar snapshot does not match the SDK schema"
})

const cookieJarSnapshotImportFailed = (_cause: unknown): CookieJarPortError => ({
  _tag: "CookieJarSnapshotImportFailed",
  message: "Cookie jar snapshot import failed"
})

const sessionSnapshotSchemaMismatch = (): SessionSnapshotError => ({
  _tag: "SessionSnapshotSchemaMismatch",
  message: "Session snapshot does not match the SDK schema"
})

export const createCookieJar = (): CookieJar => new CookieJar()

export const serializeCookieJar = (
  jar: SerializableCookieJar
): Either.Either<SerializedCookieJarSnapshot, CookieJarPortError> => {
  let snapshot: unknown

  try {
    snapshot = jar.serializeSync()
  } catch (error) {
    return Either.left(cookieJarSerializationFailed(error))
  }

  if (snapshot === undefined) {
    return Either.left(cookieJarSerializationUnsupported())
  }

  return Either.mapLeft(parseUnknown(SerializedCookieJarSnapshotSchema, snapshot), cookieJarSnapshotSchemaMismatch)
}

export const deserializeCookieJar = (
  snapshot: SerializedCookieJarSnapshot
): Either.Either<CookieJar, CookieJarPortError> => {
  try {
    return Either.right(CookieJar.deserializeSync(JSON.stringify(snapshot)))
  } catch (error) {
    return Either.left(cookieJarSnapshotImportFailed(error))
  }
}

export const toughCookieJarPort: CookieJarPort = {
  create: createCookieJar,
  deserialize: deserializeCookieJar,
  serialize: serializeCookieJar
}

export const decodeSessionSnapshot = (input: unknown): Either.Either<SessionSnapshot, SessionSnapshotError> =>
  Either.mapLeft(parseUnknown(SessionSnapshotSchema, input), sessionSnapshotSchemaMismatch)

export const decodeSdkSessionSnapshot = (
  input: unknown
): Either.Either<SdkSessionSnapshot, SessionSnapshotError> =>
  Either.mapLeft(parseUnknown(SdkSessionSnapshotSchema, input), sessionSnapshotSchemaMismatch)

export const makeSessionSnapshot = (
  metadata: SessionMetadata,
  csrf: CsrfState,
  cookieJar: SerializedCookieJarSnapshot
): Either.Either<SessionSnapshot, SessionSnapshotError> =>
  decodeSessionSnapshot({
    cookieJar,
    csrf,
    metadata
  })

export const makeGuestSdkSessionSnapshot = (
  session: SessionSnapshot
): Either.Either<GuestSdkSessionSnapshot, SessionSnapshotError> =>
  Either.mapLeft(
    parseUnknown(GuestSdkSessionSnapshotSchema, {
      kind: "guest",
      session
    }),
    sessionSnapshotSchemaMismatch
  )

export const makeAuthenticatedSdkSessionSnapshot = (
  session: SessionSnapshot,
  state: AuthenticatedSdkSessionSnapshot["state"],
  account?: AuthAccountSummary
): Either.Either<AuthenticatedSdkSessionSnapshot, SessionSnapshotError> =>
  Either.mapLeft(
    parseUnknown(AuthenticatedSdkSessionSnapshotSchema, {
      ...(account === undefined ? {} : { account }),
      kind: "authenticated",
      session,
      state
    }),
    sessionSnapshotSchemaMismatch
  )

const redactSessionMetadata = (metadata: SessionMetadata): SessionMetadataDiagnostic => ({
  assetVersion: metadata.assetVersion,
  clientRouteId: "[redacted]",
  pageViewId: "[redacted]",
  regionId: metadata.regionId
})

export const redactSessionSnapshot = (snapshot: SessionSnapshot): SessionSnapshotDiagnostic =>
  Either.getOrThrow(
    parseUnknown(SessionSnapshotDiagnosticSchema, {
      cookieJar: {
        cookieCount: snapshot.cookieJar.cookies.length,
        storeType: snapshot.cookieJar.storeType,
        version: snapshot.cookieJar.version
      },
      csrf: "[redacted]",
      metadata: redactSessionMetadata(snapshot.metadata)
    })
  )

export const formatSessionSnapshotDiagnostic = (snapshot: SessionSnapshot): string =>
  JSON.stringify(redactSessionSnapshot(snapshot))

const redactAccountSummary = (
  account: AuthAccountSummary | undefined
): SdkSessionSnapshotDiagnostic["account"] =>
  account === undefined
    ? undefined
    : {
      ...(account.displayName === undefined ? {} : { displayName: "[redacted]" as const }),
      ...(account.emailHint === undefined ? {} : { emailHint: "[redacted]" as const }),
      ...(account.stableAccountIdHash === undefined ? {} : { stableAccountIdHash: "[redacted]" as const })
    }

export const redactSdkSessionSnapshot = (snapshot: SdkSessionSnapshot): SdkSessionSnapshotDiagnostic =>
  Either.getOrThrow(
    parseUnknown(SdkSessionSnapshotDiagnosticSchema, {
      ...redactSessionSnapshot(snapshot.session),
      ...(() => {
        const account = snapshot.kind === "authenticated" ? redactAccountSummary(snapshot.account) : undefined

        return account === undefined ? {} : { account }
      })(),
      kind: snapshot.kind,
      state: snapshot.kind === "authenticated" ? snapshot.state : "guest"
    })
  )

export const formatSdkSessionSnapshotDiagnostic = (snapshot: SdkSessionSnapshot): string =>
  JSON.stringify(redactSdkSessionSnapshot(snapshot))
