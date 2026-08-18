import { Schema } from "effect"

import { CartUpdateResultSchema } from "./cart.js"
import { RawCategoriesSchema } from "./category.js"

import { withUnknownStringFields } from "./unknown-fields.js"

// `clientRouteId` is optional because the server-rendered page publishes one
// only when it has one to publish; Voila's own endpoints accept a request
// without the header, and a snapshot captured when the page did carry one keeps
// using it
export const SessionMetadataSchema = Schema.Struct({
  assetVersion: Schema.String,
  clientRouteId: Schema.optionalKey(Schema.String),
  pageViewId: Schema.String,
  regionId: Schema.String
})

export type SessionMetadata = Schema.Schema.Type<typeof SessionMetadataSchema>

export const SessionMetadataDiagnosticSchema = Schema.Struct({
  assetVersion: Schema.String,
  clientRouteId: Schema.optionalKey(Schema.Literal("[redacted]")),
  pageViewId: Schema.Literal("[redacted]"),
  regionId: Schema.String
})

export type SessionMetadataDiagnostic = Schema.Schema.Type<typeof SessionMetadataDiagnosticSchema>

export const CsrfStateSchema = Schema.Struct({ token: Schema.String })

export type CsrfState = Schema.Schema.Type<typeof CsrfStateSchema>

export const SerializedCookieSchema = Schema.revealCodec(
  Schema.Struct({ key: Schema.optionalKey(Schema.String), value: Schema.optionalKey(Schema.String) }).pipe(
    withUnknownStringFields
  )
)

export type SerializedCookie = Schema.Schema.Type<typeof SerializedCookieSchema>

export const SerializedCookieJarSnapshotSchema = Schema.revealCodec(
  Schema.Struct({
    cookies: Schema.Array(SerializedCookieSchema),
    rejectPublicSuffixes: Schema.Boolean,
    storeType: Schema.NullOr(Schema.String),
    version: Schema.String
  }).pipe(withUnknownStringFields)
)

export type SerializedCookieJarSnapshot = Schema.Schema.Type<typeof SerializedCookieJarSnapshotSchema>

export const SessionSnapshotSchema = Schema.Struct({
  cookieJar: SerializedCookieJarSnapshotSchema,
  csrf: CsrfStateSchema,
  metadata: SessionMetadataSchema
})

export type SessionSnapshot = Schema.Schema.Type<typeof SessionSnapshotSchema>

export const AuthSessionStateSchema = Schema.Literals(["authenticated", "unknown-expiry", "reauth-required"])

export type AuthSessionState = Schema.Schema.Type<typeof AuthSessionStateSchema>

export const AuthAccountSummarySchema = Schema.Struct({
  displayName: Schema.optionalKey(Schema.String),
  emailHint: Schema.optionalKey(Schema.String),
  stableAccountIdHash: Schema.optionalKey(Schema.String)
})

export type AuthAccountSummary = Schema.Schema.Type<typeof AuthAccountSummarySchema>

export const GuestSdkSessionSnapshotSchema = Schema.Struct({
  kind: Schema.Literal("guest"),
  session: SessionSnapshotSchema
})

export type GuestSdkSessionSnapshot = Schema.Schema.Type<typeof GuestSdkSessionSnapshotSchema>

export const AuthenticatedSdkSessionSnapshotSchema = Schema.Struct({
  account: Schema.optionalKey(AuthAccountSummarySchema),
  kind: Schema.Literal("authenticated"),
  session: SessionSnapshotSchema,
  state: AuthSessionStateSchema
})

export type AuthenticatedSdkSessionSnapshot = Schema.Schema.Type<typeof AuthenticatedSdkSessionSnapshotSchema>

export const SdkSessionSnapshotSchema = Schema.Union([
  GuestSdkSessionSnapshotSchema,
  AuthenticatedSdkSessionSnapshotSchema
])

export type SdkSessionSnapshot = Schema.Schema.Type<typeof SdkSessionSnapshotSchema>

export const SessionSnapshotDiagnosticSchema = Schema.Struct({
  cookieJar: Schema.Struct({
    cookieCount: Schema.Number.pipe(
      Schema.check(Schema.isFinite()),
      Schema.check(Schema.isInt()),
      Schema.check(Schema.isGreaterThanOrEqualTo(0))
    ),
    storeType: Schema.NullOr(Schema.String),
    version: Schema.String
  }),
  csrf: Schema.Literal("[redacted]"),
  metadata: SessionMetadataDiagnosticSchema
})

export type SessionSnapshotDiagnostic = Schema.Schema.Type<typeof SessionSnapshotDiagnosticSchema>

const RedactedAuthAccountSummarySchema = Schema.Struct({
  displayName: Schema.optionalKey(Schema.Literal("[redacted]")),
  emailHint: Schema.optionalKey(Schema.Literal("[redacted]")),
  stableAccountIdHash: Schema.optionalKey(Schema.Literal("[redacted]"))
})

export const GuestSdkSessionSnapshotDiagnosticSchema = SessionSnapshotDiagnosticSchema.pipe(
  Schema.fieldsAssign({
    account: Schema.optionalKey(Schema.Never),
    kind: Schema.Literal("guest"),
    state: Schema.Literal("guest")
  })
)

export type GuestSdkSessionSnapshotDiagnostic = Schema.Schema.Type<typeof GuestSdkSessionSnapshotDiagnosticSchema>

export const AuthenticatedSdkSessionSnapshotDiagnosticSchema = SessionSnapshotDiagnosticSchema.pipe(
  Schema.fieldsAssign({
    account: Schema.optionalKey(RedactedAuthAccountSummarySchema),
    kind: Schema.Literal("authenticated"),
    state: AuthSessionStateSchema
  })
)

export type AuthenticatedSdkSessionSnapshotDiagnostic = Schema.Schema.Type<
  typeof AuthenticatedSdkSessionSnapshotDiagnosticSchema
>

export const SdkSessionSnapshotDiagnosticSchema = Schema.Union([
  GuestSdkSessionSnapshotDiagnosticSchema,
  AuthenticatedSdkSessionSnapshotDiagnosticSchema
])

export type SdkSessionSnapshotDiagnostic = Schema.Schema.Type<typeof SdkSessionSnapshotDiagnosticSchema>

const ActiveCustomerSummarySchema = Schema.revealCodec(
  Schema.Struct({
    anonymous: Schema.optionalKey(Schema.Boolean),
    authenticated: Schema.optionalKey(Schema.Boolean),
    id: Schema.optionalKey(Schema.String)
  }).pipe(withUnknownStringFields)
)

export const ActiveCustomerSessionResponseSchema = Schema.revealCodec(
  Schema.Struct({
    authenticated: Schema.optionalKey(Schema.Boolean),
    cartId: Schema.optionalKey(Schema.String),
    customer: Schema.optionalKey(ActiveCustomerSummarySchema),
    isAuthenticated: Schema.optionalKey(Schema.Boolean),
    regionId: Schema.optionalKey(Schema.String),
    status: Schema.optionalKey(Schema.String)
  }).pipe(withUnknownStringFields)
)

export type ActiveCustomerSessionResponse = Schema.Schema.Type<typeof ActiveCustomerSessionResponseSchema>

export const ActiveAuthenticatedSdkSessionSnapshotSchema = Schema.Struct({
  account: Schema.optionalKey(AuthAccountSummarySchema),
  kind: Schema.Literal("authenticated"),
  session: SessionSnapshotSchema,
  state: Schema.Literal("authenticated")
})

export type ActiveAuthenticatedSdkSessionSnapshot = Schema.Schema.Type<
  typeof ActiveAuthenticatedSdkSessionSnapshotSchema
>

export const ReauthenticationRequiredSdkSessionSnapshotSchema = Schema.Struct({
  account: Schema.optionalKey(AuthAccountSummarySchema),
  kind: Schema.Literal("authenticated"),
  session: SessionSnapshotSchema,
  state: Schema.Literal("reauth-required")
})

export type ReauthenticationRequiredSdkSessionSnapshot = Schema.Schema.Type<
  typeof ReauthenticationRequiredSdkSessionSnapshotSchema
>

export const ActiveSessionHealthSchema = Schema.Union([
  Schema.Struct({ session: GuestSdkSessionSnapshotSchema, status: Schema.Literal("active") }),
  Schema.Struct({ session: ActiveAuthenticatedSdkSessionSnapshotSchema, status: Schema.Literal("active") })
])

export type ActiveSessionHealth = Schema.Schema.Type<typeof ActiveSessionHealthSchema>

export const RetryableSessionHealthSchema = Schema.Struct({
  reason: Schema.Literals(["network", "server", "persistence"]),
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

export const SessionHealthSchema = Schema.Union([
  ActiveSessionHealthSchema,
  RetryableSessionHealthSchema,
  ReauthenticationRequiredSessionHealthSchema,
  UnauthorizedSessionHealthSchema,
  SessionSchemaChangedHealthSchema
])

export type SessionHealth = Schema.Schema.Type<typeof SessionHealthSchema>

// The CSRF token and the page metadata both live under `session`: they are what
// the server-rendered page says about the session it just handed out.
export const InitialStateSchema = Schema.Struct({
  data: Schema.Struct({
    basket: CartUpdateResultSchema.pipe(Schema.fieldsAssign({ basketId: Schema.String, regionId: Schema.String })),
    categories: Schema.optionalKey(RawCategoriesSchema)
  }),
  session: Schema.Struct({ csrf: CsrfStateSchema, metadata: SessionMetadataSchema })
})

export type InitialState = Schema.Schema.Type<typeof InitialStateSchema>

// What a CSRF refresh reads out of the server-rendered page: the session block
// alone. The homepage also carries the basket, the categories and the adverts,
// and a token rotation that depended on all of them parsing would fail for
// reasons that have nothing to do with the token.
export const InitialStateSessionSchema = Schema.Struct({
  session: Schema.Struct({ csrf: CsrfStateSchema, metadata: SessionMetadataSchema })
})

export type InitialStateSession = Schema.Schema.Type<typeof InitialStateSessionSchema>
