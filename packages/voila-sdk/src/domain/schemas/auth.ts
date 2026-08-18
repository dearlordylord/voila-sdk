import { Schema } from "effect"

import { AuthAccountSummarySchema, SessionSnapshotSchema } from "./session.js"

const BrowserLoginTimeoutMsSchema = Schema.Number.pipe(
  Schema.check(Schema.isFinite()),
  Schema.check(Schema.isInt()),
  Schema.check(Schema.isGreaterThan(0))
)

export const BrowserLoginOptionsSchema = Schema.Struct({ timeoutMs: Schema.optionalKey(BrowserLoginTimeoutMsSchema) })

export type BrowserLoginOptions = Schema.Schema.Type<typeof BrowserLoginOptionsSchema>

export const BrowserLoginRequestSchema = BrowserLoginOptionsSchema.pipe(
  Schema.fieldsAssign({ loginUrl: Schema.String })
)

export type BrowserLoginRequest = Schema.Schema.Type<typeof BrowserLoginRequestSchema>

export const BrowserLoginPortErrorSchema = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("BrowserLoginUserCancelled"), message: Schema.optionalKey(Schema.String) }),
  Schema.Struct({ _tag: Schema.Literal("BrowserLoginTimedOut"), message: Schema.optionalKey(Schema.String) }),
  Schema.Struct({ _tag: Schema.Literal("BrowserLoginAdapterFailure"), message: Schema.optionalKey(Schema.String) })
])

export type BrowserLoginPortError = Schema.Schema.Type<typeof BrowserLoginPortErrorSchema>

export const BrowserLoginCaptureSchema = Schema.Struct({
  account: Schema.optionalKey(AuthAccountSummarySchema),
  authenticated: Schema.Boolean,
  session: SessionSnapshotSchema
})

export type BrowserLoginCapture = Schema.Schema.Type<typeof BrowserLoginCaptureSchema>

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
