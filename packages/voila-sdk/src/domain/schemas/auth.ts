import { Schema } from "effect"

import { AuthAccountSummarySchema, AuthenticatedSdkSessionSnapshotSchema, SessionSnapshotSchema } from "./session.js"

export const BrowserLoginTimeoutMsSchema = Schema.Number.pipe(
  Schema.check(Schema.isFinite()),
  Schema.check(Schema.isInt()),
  Schema.check(Schema.isGreaterThan(0))
).pipe(Schema.brand("BrowserLoginTimeoutMs"))

export type BrowserLoginTimeoutMs = Schema.Schema.Type<typeof BrowserLoginTimeoutMsSchema>

export const BrowserLoginOptionsSchema = Schema.Struct({ timeoutMs: Schema.optionalKey(BrowserLoginTimeoutMsSchema) })

export type BrowserLoginOptions = Schema.Schema.Type<typeof BrowserLoginOptionsSchema>

export const BrowserLoginRequestSchema = BrowserLoginOptionsSchema.pipe(
  Schema.fieldsAssign({ loginUrl: Schema.String })
)

export type BrowserLoginRequest = Schema.Schema.Type<typeof BrowserLoginRequestSchema>

export const BrowserLoginPortErrorSchema = Schema.TaggedUnion({
  BrowserLoginUserCancelled: { message: Schema.optionalKey(Schema.String) },
  BrowserLoginTimedOut: { message: Schema.optionalKey(Schema.String) },
  BrowserLoginAdapterFailure: { message: Schema.optionalKey(Schema.String) }
})

export type BrowserLoginPortError = Schema.Schema.Type<typeof BrowserLoginPortErrorSchema>

export const BrowserLoginErrorSchema = Schema.TaggedUnion({
  BrowserLoginAdapterFailure: { message: Schema.String },
  BrowserLoginCaptureInvalid: { message: Schema.String },
  BrowserLoginMissingCookies: { message: Schema.String },
  BrowserLoginNotAuthenticated: { message: Schema.String },
  BrowserLoginOptionsInvalid: { message: Schema.String },
  BrowserLoginTimedOut: { message: Schema.String },
  BrowserLoginUserCancelled: { message: Schema.String }
})

export type BrowserLoginError = Schema.Schema.Type<typeof BrowserLoginErrorSchema>

export const BrowserLoginCaptureSchema = Schema.Struct({
  account: Schema.optionalKey(AuthAccountSummarySchema),
  authenticated: Schema.Boolean,
  session: SessionSnapshotSchema
})

export type BrowserLoginCapture = Schema.Schema.Type<typeof BrowserLoginCaptureSchema>

export const BrowserLoginResultSchema = Schema.Struct({ session: AuthenticatedSdkSessionSnapshotSchema })

export type BrowserLoginResult = Schema.Schema.Type<typeof BrowserLoginResultSchema>

export const BrowserLoginBrowserCookieSchema = Schema.Struct({
  domain: Schema.String,
  expires: Schema.optionalKey(Schema.Number.pipe(Schema.check(Schema.isFinite()))),
  httpOnly: Schema.optionalKey(Schema.Boolean),
  name: Schema.String,
  path: Schema.String,
  sameSite: Schema.optionalKey(Schema.String),
  secure: Schema.optionalKey(Schema.Boolean),
  value: Schema.String
})

export type BrowserLoginBrowserCookie = Schema.Schema.Type<typeof BrowserLoginBrowserCookieSchema>

export const BrowserLoginBrowserCookieArraySchema = Schema.Array(BrowserLoginBrowserCookieSchema)
