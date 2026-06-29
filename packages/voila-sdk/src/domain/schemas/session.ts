import { Schema } from "effect"

import { CartUpdateResultSchema } from "./cart.js"
import type { CartUpdateResult } from "./cart.js"
import { RawCategoryTreeSchema } from "./category.js"
import type { RawCategoryTree } from "./category.js"

const UnknownStringRecordSchema = Schema.Record({ key: Schema.String, value: Schema.Unknown })

export const SessionMetadataSchema = Schema.Struct({
  assetVersion: Schema.String,
  clientRouteId: Schema.String,
  pageViewId: Schema.String,
  regionId: Schema.String
})

export type SessionMetadata = Schema.Schema.Type<typeof SessionMetadataSchema>

export const SessionMetadataDiagnosticSchema = Schema.Struct({
  assetVersion: Schema.String,
  clientRouteId: Schema.Literal("[redacted]"),
  pageViewId: Schema.Literal("[redacted]"),
  regionId: Schema.String
})

export type SessionMetadataDiagnostic = Schema.Schema.Type<typeof SessionMetadataDiagnosticSchema>

export const CsrfStateSchema = Schema.Struct({
  token: Schema.String
})

export type CsrfState = Schema.Schema.Type<typeof CsrfStateSchema>

export const SerializedCookieSchema = Schema.asSchema(
  Schema.Struct({
    key: Schema.optionalWith(Schema.String, { exact: true }),
    value: Schema.optionalWith(Schema.String, { exact: true })
  }).pipe(Schema.extend(UnknownStringRecordSchema))
)

export type SerializedCookie = Schema.Schema.Type<typeof SerializedCookieSchema>

export const SerializedCookieJarSnapshotSchema = Schema.asSchema(
  Schema.Struct({
    cookies: Schema.Array(SerializedCookieSchema),
    rejectPublicSuffixes: Schema.Boolean,
    storeType: Schema.NullOr(Schema.String),
    version: Schema.String
  }).pipe(Schema.extend(UnknownStringRecordSchema))
)

export type SerializedCookieJarSnapshot = Schema.Schema.Type<typeof SerializedCookieJarSnapshotSchema>

export const SessionSnapshotSchema = Schema.Struct({
  cookieJar: SerializedCookieJarSnapshotSchema,
  csrf: CsrfStateSchema,
  metadata: SessionMetadataSchema
})

export type SessionSnapshot = Schema.Schema.Type<typeof SessionSnapshotSchema>

export const AuthSessionStateSchema = Schema.Literal("authenticated", "unknown-expiry", "reauth-required")

export type AuthSessionState = Schema.Schema.Type<typeof AuthSessionStateSchema>

export const AuthAccountSummarySchema = Schema.Struct({
  displayName: Schema.optionalWith(Schema.String, { exact: true }),
  emailHint: Schema.optionalWith(Schema.String, { exact: true }),
  stableAccountIdHash: Schema.optionalWith(Schema.String, { exact: true })
})

export type AuthAccountSummary = Schema.Schema.Type<typeof AuthAccountSummarySchema>

export const GuestSdkSessionSnapshotSchema = Schema.Struct({
  kind: Schema.Literal("guest"),
  session: SessionSnapshotSchema
})

export type GuestSdkSessionSnapshot = Schema.Schema.Type<typeof GuestSdkSessionSnapshotSchema>

export const AuthenticatedSdkSessionSnapshotSchema = Schema.Struct({
  account: Schema.optionalWith(AuthAccountSummarySchema, { exact: true }),
  kind: Schema.Literal("authenticated"),
  session: SessionSnapshotSchema,
  state: AuthSessionStateSchema
})

export type AuthenticatedSdkSessionSnapshot = Schema.Schema.Type<typeof AuthenticatedSdkSessionSnapshotSchema>

export const SdkSessionSnapshotSchema = Schema.Union(
  GuestSdkSessionSnapshotSchema,
  AuthenticatedSdkSessionSnapshotSchema
)

export type SdkSessionSnapshot = Schema.Schema.Type<typeof SdkSessionSnapshotSchema>

export const SessionSnapshotDiagnosticSchema = Schema.Struct({
  cookieJar: Schema.Struct({
    cookieCount: Schema.Number.pipe(Schema.finite(), Schema.int(), Schema.nonNegative()),
    storeType: Schema.NullOr(Schema.String),
    version: Schema.String
  }),
  csrf: Schema.Literal("[redacted]"),
  metadata: SessionMetadataDiagnosticSchema
})

export type SessionSnapshotDiagnostic = Schema.Schema.Type<typeof SessionSnapshotDiagnosticSchema>

const RedactedAuthAccountSummarySchema = Schema.Struct({
  displayName: Schema.optionalWith(Schema.Literal("[redacted]"), { exact: true }),
  emailHint: Schema.optionalWith(Schema.Literal("[redacted]"), { exact: true }),
  stableAccountIdHash: Schema.optionalWith(Schema.Literal("[redacted]"), { exact: true })
})

export const GuestSdkSessionSnapshotDiagnosticSchema = SessionSnapshotDiagnosticSchema.pipe(
  Schema.extend(Schema.Struct({
    account: Schema.optionalWith(Schema.Never, { exact: true }),
    kind: Schema.Literal("guest"),
    state: Schema.Literal("guest")
  }))
)

export type GuestSdkSessionSnapshotDiagnostic = Schema.Schema.Type<typeof GuestSdkSessionSnapshotDiagnosticSchema>

export const AuthenticatedSdkSessionSnapshotDiagnosticSchema = SessionSnapshotDiagnosticSchema.pipe(
  Schema.extend(Schema.Struct({
    account: Schema.optionalWith(RedactedAuthAccountSummarySchema, { exact: true }),
    kind: Schema.Literal("authenticated"),
    state: AuthSessionStateSchema
  }))
)

export type AuthenticatedSdkSessionSnapshotDiagnostic = Schema.Schema.Type<
  typeof AuthenticatedSdkSessionSnapshotDiagnosticSchema
>

export const SdkSessionSnapshotDiagnosticSchema = Schema.Union(
  GuestSdkSessionSnapshotDiagnosticSchema,
  AuthenticatedSdkSessionSnapshotDiagnosticSchema
)

export type SdkSessionSnapshotDiagnostic = Schema.Schema.Type<typeof SdkSessionSnapshotDiagnosticSchema>

const ActiveCustomerSummarySchema = Schema.asSchema(
  Schema.Struct({
    anonymous: Schema.optionalWith(Schema.Boolean, { exact: true }),
    authenticated: Schema.optionalWith(Schema.Boolean, { exact: true }),
    id: Schema.optionalWith(Schema.String, { exact: true })
  }).pipe(Schema.extend(UnknownStringRecordSchema))
)

export const ActiveCustomerSessionResponseSchema = Schema.asSchema(
  Schema.Struct({
    authenticated: Schema.optionalWith(Schema.Boolean, { exact: true }),
    cartId: Schema.optionalWith(Schema.String, { exact: true }),
    customer: Schema.optionalWith(ActiveCustomerSummarySchema, { exact: true }),
    isAuthenticated: Schema.optionalWith(Schema.Boolean, { exact: true }),
    regionId: Schema.optionalWith(Schema.String, { exact: true }),
    status: Schema.optionalWith(Schema.String, { exact: true })
  }).pipe(Schema.extend(UnknownStringRecordSchema))
)

export type ActiveCustomerSessionResponse = Schema.Schema.Type<typeof ActiveCustomerSessionResponseSchema>

export const ActiveAuthenticatedSdkSessionSnapshotSchema = Schema.Struct({
  account: Schema.optionalWith(AuthAccountSummarySchema, { exact: true }),
  kind: Schema.Literal("authenticated"),
  session: SessionSnapshotSchema,
  state: Schema.Literal("authenticated")
})

export type ActiveAuthenticatedSdkSessionSnapshot = Schema.Schema.Type<
  typeof ActiveAuthenticatedSdkSessionSnapshotSchema
>

export const ReauthenticationRequiredSdkSessionSnapshotSchema = Schema.Struct({
  account: Schema.optionalWith(AuthAccountSummarySchema, { exact: true }),
  kind: Schema.Literal("authenticated"),
  session: SessionSnapshotSchema,
  state: Schema.Literal("reauth-required")
})

export type ReauthenticationRequiredSdkSessionSnapshot = Schema.Schema.Type<
  typeof ReauthenticationRequiredSdkSessionSnapshotSchema
>

export const ActiveSessionHealthSchema = Schema.Union(
  Schema.Struct({
    session: GuestSdkSessionSnapshotSchema,
    status: Schema.Literal("active")
  }),
  Schema.Struct({
    session: ActiveAuthenticatedSdkSessionSnapshotSchema,
    status: Schema.Literal("active")
  })
)

export type ActiveSessionHealth = Schema.Schema.Type<typeof ActiveSessionHealthSchema>

export const RetryableSessionHealthSchema = Schema.Struct({
  reason: Schema.Literal("network", "server", "persistence"),
  session: SdkSessionSnapshotSchema,
  status: Schema.Literal("retry")
})

export type RetryableSessionHealth = Schema.Schema.Type<typeof RetryableSessionHealthSchema>

export const ReauthenticationRequiredSessionHealthSchema = Schema.Struct({
  session: ReauthenticationRequiredSdkSessionSnapshotSchema,
  status: Schema.Literal("reauth-required")
})

export type ReauthenticationRequiredSessionHealth = Schema.Schema.Type<
  typeof ReauthenticationRequiredSessionHealthSchema
>

export const UnauthorizedSessionHealthSchema = Schema.Struct({
  session: GuestSdkSessionSnapshotSchema,
  status: Schema.Literal("unauthorized")
})

export type UnauthorizedSessionHealth = Schema.Schema.Type<typeof UnauthorizedSessionHealthSchema>

export const SessionSchemaChangedHealthSchema = Schema.Struct({
  session: SdkSessionSnapshotSchema,
  status: Schema.Literal("schema-changed")
})

export type SessionSchemaChangedHealth = Schema.Schema.Type<typeof SessionSchemaChangedHealthSchema>

export const SessionHealthSchema = Schema.Union(
  ActiveSessionHealthSchema,
  RetryableSessionHealthSchema,
  ReauthenticationRequiredSessionHealthSchema,
  UnauthorizedSessionHealthSchema,
  SessionSchemaChangedHealthSchema
)

export type SessionHealth = Schema.Schema.Type<typeof SessionHealthSchema>

interface InitialStateBasket extends CartUpdateResult {
  readonly basketId: string
  readonly regionId: string
}

interface InitialStateShape {
  readonly csrf: CsrfState
  readonly data: {
    readonly basket: InitialStateBasket
    readonly categories?: RawCategoryTree
  }
  readonly session: {
    readonly metadata: SessionMetadata
  }
}

export const InitialStateSchema: Schema.Schema<InitialStateShape> = Schema.Struct({
  csrf: CsrfStateSchema,
  data: Schema.Struct({
    basket: Schema.extend(
      CartUpdateResultSchema,
      Schema.Struct({
        basketId: Schema.String,
        regionId: Schema.String
      })
    ),
    categories: Schema.optionalWith(RawCategoryTreeSchema, { exact: true })
  }),
  session: Schema.Struct({
    metadata: SessionMetadataSchema
  })
})

export type InitialState = Schema.Schema.Type<typeof InitialStateSchema>
