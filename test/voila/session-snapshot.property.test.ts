import * as fc from "fast-check"
import { describe, expect, it } from "vitest"

import {
  type SerializedCookieJarSnapshot,
  type SessionSnapshot,
  SessionSnapshotSchema
} from "../../src/domain/schemas/index.js"
import { assertDecodeSuccess, assertEncodeSuccess, propertyTestParameters } from "../helpers/property.js"

const safeText = fc.string({ maxLength: 32 })
const safeNullableText = fc.option(safeText, { nil: null })
const safeBoolean = fc.boolean()

const cookieSnapshotArbitrary = fc.record({
  domain: safeText,
  httpOnly: safeBoolean,
  key: safeText,
  path: safeText,
  secure: safeBoolean,
  value: safeText
})

const cookieJarSnapshotArbitrary: fc.Arbitrary<SerializedCookieJarSnapshot> = fc.record({
  cookies: fc.array(cookieSnapshotArbitrary, { maxLength: 5 }),
  rejectPublicSuffixes: safeBoolean,
  storeType: safeNullableText,
  version: safeText
})

const sessionSnapshotArbitrary: fc.Arbitrary<SessionSnapshot> = fc.record({
  cookieJar: cookieJarSnapshotArbitrary,
  csrf: fc.record({
    token: safeText
  }),
  metadata: fc.record({
    assetVersion: safeText,
    clientRouteId: safeText,
    pageViewId: safeText,
    regionId: safeText
  })
})

describe("SessionSnapshotSchema properties", () => {
  it("round-trips generated snapshots through Effect Schema encode/decode", () => {
    fc.assert(
      fc.property(sessionSnapshotArbitrary, (snapshot) => {
        const encoded = assertEncodeSuccess(SessionSnapshotSchema, snapshot)
        const decoded = assertDecodeSuccess(SessionSnapshotSchema, encoded)

        expect(decoded).toEqual(snapshot)
      }),
      propertyTestParameters
    )
  })
})
