import { Schema } from "effect"

import { AuthAccountSummarySchema, SessionSnapshotSchema } from "./session.js"

const BrowserLoginTimeoutMsSchema = Schema.Number.pipe(
  Schema.finite(),
  Schema.int(),
  Schema.positive()
)

export const BrowserLoginOptionsSchema = Schema.Struct({
  timeoutMs: Schema.optionalWith(BrowserLoginTimeoutMsSchema, { exact: true })
})

export type BrowserLoginOptions = Schema.Schema.Type<typeof BrowserLoginOptionsSchema>

export const BrowserLoginRequestSchema = BrowserLoginOptionsSchema.pipe(
  Schema.extend(Schema.Struct({
    loginUrl: Schema.String
  }))
)

export type BrowserLoginRequest = Schema.Schema.Type<typeof BrowserLoginRequestSchema>

export const BrowserLoginPortErrorSchema = Schema.Union(
  Schema.Struct({
    _tag: Schema.Literal("BrowserLoginUserCancelled"),
    message: Schema.optionalWith(Schema.String, { exact: true })
  }),
  Schema.Struct({
    _tag: Schema.Literal("BrowserLoginTimedOut"),
    message: Schema.optionalWith(Schema.String, { exact: true })
  }),
  Schema.Struct({
    _tag: Schema.Literal("BrowserLoginAdapterFailure"),
    message: Schema.optionalWith(Schema.String, { exact: true })
  })
)

export type BrowserLoginPortError = Schema.Schema.Type<typeof BrowserLoginPortErrorSchema>

export const BrowserLoginCaptureSchema = Schema.Struct({
  account: Schema.optionalWith(AuthAccountSummarySchema, { exact: true }),
  authenticated: Schema.Boolean,
  session: SessionSnapshotSchema
})

export type BrowserLoginCapture = Schema.Schema.Type<typeof BrowserLoginCaptureSchema>

export const BrowserLoginBrowserCookieSchema = Schema.Struct({
  domain: Schema.String,
  expires: Schema.optionalWith(Schema.Number.pipe(Schema.finite()), { exact: true }),
  httpOnly: Schema.optionalWith(Schema.Boolean, { exact: true }),
  name: Schema.String,
  path: Schema.String,
  sameSite: Schema.optionalWith(Schema.String, { exact: true }),
  secure: Schema.optionalWith(Schema.Boolean, { exact: true }),
  value: Schema.String
})

export type BrowserLoginBrowserCookie = Schema.Schema.Type<typeof BrowserLoginBrowserCookieSchema>

export const BrowserLoginBrowserCookieArraySchema = Schema.Array(BrowserLoginBrowserCookieSchema)
