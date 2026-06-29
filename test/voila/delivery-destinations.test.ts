import { readFileSync } from "node:fs"

import { Either } from "effect"
import { describe, expect, it } from "vitest"

import { parseJson } from "../../src/domain/parse.js"
import {
  DeliveryDestinationsDiagnosticSchema,
  NormalizedDeliveryDestinationsSchema,
  type SessionSnapshot,
  type VoilaTransport,
  type VoilaTransportRequest,
  type VoilaTransportResponse
} from "../../src/index.js"
import {
  getDeliveryDestination,
  getDeliveryDestinations,
  makeDeliveryDestinationsDiagnostic,
  makeSessionSnapshot,
  normalizeDeliveryDestination,
  parseDeliveryDestinationResponse,
  parseDeliveryDestinationsDiagnostic,
  parseDeliveryDestinationsResponse,
  serializeCookieJar,
  toughCookieJarPort,
  VOILA_BASE_URL
} from "../../src/index.js"
import { assertDecodeSuccess, assertEncodeSuccess } from "../helpers/property.js"

const fixtureText = readFileSync(new URL("../fixtures/delivery-destinations-home.json", import.meta.url), "utf8")
const csrfToken = "csrf-token"
const secretAddress = "123 Secret Street"
const secretAccountId = "account-secret-123"

const sampleMetadata = {
  assetVersion: "asset-version",
  clientRouteId: "client-route-id",
  pageViewId: "page-view-id",
  regionId: "region-id"
}

const readFixture = (): unknown => {
  const parsed = parseJson(fixtureText)

  if (Either.isLeft(parsed)) {
    throw new Error("Expected fixture JSON to parse")
  }

  return parsed.right
}

const makeSession = (token: string = csrfToken): SessionSnapshot => {
  const jar = toughCookieJarPort.create()
  jar.setCookieSync("voila-session=before; Path=/; Secure", VOILA_BASE_URL)

  const cookieJar = serializeCookieJar(jar)

  if (Either.isLeft(cookieJar)) {
    throw new Error("Expected cookie jar serialization to succeed")
  }

  const snapshot = makeSessionSnapshot(sampleMetadata, { token }, cookieJar.right)

  if (Either.isLeft(snapshot)) {
    throw new Error("Expected session snapshot creation to succeed")
  }

  return snapshot.right
}

const makeResponseTransport = (response: VoilaTransportResponse): {
  readonly requests: () => ReadonlyArray<VoilaTransportRequest>
  readonly transport: VoilaTransport
} => {
  const requests: Array<VoilaTransportRequest> = []

  return {
    requests: () => requests,
    transport: {
      request: async (request) => {
        requests.push(request)
        return Either.right(response)
      }
    }
  }
}

const makeResponse = (
  body: string = fixtureText,
  status: number = 200
): VoilaTransportResponse => ({
  body,
  headers: {
    "set-cookie": "fresh-delivery-destination-cookie=after; Path=/; Secure"
  },
  status
})

const getSessionCookies = (session: SessionSnapshot): string => {
  const jar = toughCookieJarPort.deserialize(session.cookieJar)

  if (Either.isLeft(jar)) {
    throw new Error("Expected session cookie jar to deserialize")
  }

  return jar.right.getCookieStringSync(VOILA_BASE_URL)
}

describe("delivery destination parsing", () => {
  it("normalizes saved home delivery destinations from a sanitized fixture", () => {
    const result = parseDeliveryDestinationsResponse(readFixture())

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(result.right.destinations).toHaveLength(2)
      expect(result.right.destinations[0]).toEqual({
        addressId: "sanitized-address-id",
        deliverability: "DELIVERABLE",
        deliverable: true,
        deliveryDestinationId: "sanitized-delivery-destination-id",
        deliveryInstructions: "sanitized-delivery-instructions",
        deliveryMethod: "HOME_DELIVERY",
        formattedAddress: "sanitized-formatted-address",
        nickname: "sanitized-address-nickname",
        regionId: "sanitized-region-id"
      })
      expect(result.right.destinations[1]?.deliverable).toBe(false)
      expect(result.right.destinations[1]?.regionId).toBe("sanitized-fallback-region-id")
    }
  })

  it("keeps normalized destinations under the public schema", () => {
    const parsed = parseDeliveryDestinationsResponse(readFixture())

    expect(Either.isRight(parsed)).toBe(true)

    if (Either.isRight(parsed)) {
      const decoded = assertDecodeSuccess(NormalizedDeliveryDestinationsSchema, parsed.right)
      expect(assertEncodeSuccess(NormalizedDeliveryDestinationsSchema, decoded)).toEqual(parsed.right)
    }
  })

  it("normalizes a minimal destination without optional address details", () => {
    expect(normalizeDeliveryDestination({
      deliveryDestinationId: "sanitized-minimal-delivery-destination-id"
    })).toEqual({
      deliverable: false,
      deliveryDestinationId: "sanitized-minimal-delivery-destination-id"
    })
  })

  it("proves delivery destination fixtures do not carry raw address or account identifiers", () => {
    expect(fixtureText).toContain("sanitized-address-id")
    expect(fixtureText).toContain("sanitized-account-id")
    expect(fixtureText).not.toContain(secretAddress)
    expect(fixtureText).not.toContain(secretAccountId)
  })

  it("redacts address, account, and destination identifiers from diagnostics", () => {
    const destination = normalizeDeliveryDestination({
      addressId: "address-id-with-account-context",
      customerAccountId: secretAccountId,
      deliverability: "DELIVERABLE",
      deliveryDestinationId: "destination-id-with-account-context",
      deliveryInstructions: "leave groceries at a private door",
      deliveryMethod: "HOME_DELIVERY",
      formattedAddress: secretAddress,
      name: "private nickname",
      resolvedRegionId: "private-region-id"
    })
    const diagnostic = makeDeliveryDestinationsDiagnostic({
      destinations: [destination]
    })
    const encoded = JSON.stringify(diagnostic)

    expect(diagnostic).toEqual({
      count: 1,
      destinations: [{
        addressId: "[redacted]",
        deliverability: "DELIVERABLE",
        deliverable: true,
        deliveryDestinationId: "[redacted]",
        deliveryInstructions: "[redacted]",
        deliveryMethod: "HOME_DELIVERY",
        formattedAddress: "[redacted]",
        nickname: "[redacted]",
        regionId: "[redacted]"
      }]
    })
    expect(assertDecodeSuccess(DeliveryDestinationsDiagnosticSchema, diagnostic)).toEqual(diagnostic)
    expect(Either.isRight(parseDeliveryDestinationsDiagnostic(diagnostic))).toBe(true)
    expect(encoded).not.toContain(secretAddress)
    expect(encoded).not.toContain(secretAccountId)
    expect(encoded).not.toContain("address-id-with-account-context")
    expect(encoded).not.toContain("destination-id-with-account-context")
    expect(encoded).not.toContain("private-region-id")
  })

  it("builds minimal diagnostics without adding absent sensitive fields", () => {
    const diagnostic = makeDeliveryDestinationsDiagnostic({
      destinations: [{
        deliverable: false,
        deliveryDestinationId: "destination-id"
      }]
    })

    expect(diagnostic).toEqual({
      count: 1,
      destinations: [{
        deliverable: false,
        deliveryDestinationId: "[redacted]"
      }]
    })
  })

  it("rejects diagnostics that contain raw identifiers", () => {
    const result = parseDeliveryDestinationsDiagnostic({
      count: 1,
      destinations: [{
        deliverable: true,
        deliveryDestinationId: "raw-destination-id"
      }]
    })

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("DeliveryDestinationsResponseSchemaMismatch")
      expect(JSON.stringify(result.left)).not.toContain("raw-destination-id")
    }
  })

  it("normalizes a single destination response at the schema boundary", () => {
    const result = parseDeliveryDestinationResponse({
      deliverability: "DELIVERABLE",
      deliveryDestinationId: "sanitized-delivery-destination-id",
      deliveryMethod: "HOME_DELIVERY",
      formattedAddress: "sanitized-formatted-address",
      resolvedRegionId: "sanitized-region-id"
    })

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(result.right).toEqual({
        deliverability: "DELIVERABLE",
        deliverable: true,
        deliveryDestinationId: "sanitized-delivery-destination-id",
        deliveryMethod: "HOME_DELIVERY",
        formattedAddress: "sanitized-formatted-address",
        regionId: "sanitized-region-id"
      })
    }
  })

  it("fails single destination parsing with redacted schema errors", () => {
    const result = parseDeliveryDestinationResponse({
      formattedAddress: secretAddress
    })

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("DeliveryDestinationsResponseSchemaMismatch")
      expect(JSON.stringify(result.left)).not.toContain(secretAddress)
    }
  })

  it("fails at the schema boundary when destination IDs are missing", () => {
    const result = parseDeliveryDestinationsResponse([{
      deliverability: "DELIVERABLE",
      formattedAddress: secretAddress
    }])

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("DeliveryDestinationsResponseSchemaMismatch")
      expect(JSON.stringify(result.left)).not.toContain(secretAddress)
    }
  })
})

describe("delivery destination operations", () => {
  it("fetches saved home delivery destinations through the active session", async () => {
    const fake = makeResponseTransport(makeResponse())
    const result = await getDeliveryDestinations(makeSession(), {}, fake.transport)

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      const [request] = fake.requests()

      expect(request?.method).toBe("GET")
      expect(request?.url.pathname).toBe("/api/ecomdeliverydestinations/v4/delivery-addresses")
      expect(request?.url.searchParams.get("deliveryMethod")).toBe("HOME_DELIVERY")
      expect(request?.headers["X-CSRF-TOKEN"]).toBe(csrfToken)
      expect(request?.headers.cookie).toContain("voila-session=before")
      expect(result.right.value.destinations[0]?.deliveryDestinationId).toBe("sanitized-delivery-destination-id")
      expect(getSessionCookies(result.right.session)).toContain("fresh-delivery-destination-cookie=after")
    }
  })

  it("fetches saved collection destinations when requested", async () => {
    const fake = makeResponseTransport(makeResponse())
    const result = await getDeliveryDestinations(
      makeSession(),
      {
        deliveryMethod: "CUSTOMER_COLLECTION"
      },
      fake.transport
    )

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      const [request] = fake.requests()
      expect(request?.url.searchParams.get("deliveryMethod")).toBe("CUSTOMER_COLLECTION")
    }
  })

  it("rejects invalid delivery method input before network I/O", async () => {
    const fake = makeResponseTransport(makeResponse())
    const result = await getDeliveryDestinations(
      makeSession(),
      {
        deliveryMethod: "INVALID"
      },
      fake.transport
    )

    expect(Either.isLeft(result)).toBe(true)
    expect(fake.requests()).toHaveLength(0)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("DeliveryDestinationsInputInvalid")
    }
  })

  it("fetches a single delivery destination by ID", async () => {
    const fake = makeResponseTransport(makeResponse(JSON.stringify({
      deliverability: "DELIVERABLE",
      deliveryDestinationId: "sanitized-delivery-destination-id",
      deliveryMethod: "HOME_DELIVERY",
      formattedAddress: "sanitized-formatted-address",
      resolvedRegionId: "sanitized-region-id"
    })))
    const result = await getDeliveryDestination(
      makeSession(),
      {
        deliveryDestinationId: "sanitized-delivery-destination-id"
      },
      fake.transport
    )

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      const [request] = fake.requests()

      expect(request?.method).toBe("GET")
      expect(request?.url.pathname).toBe(
        "/api/ecomdeliverydestinations/v4/delivery-addresses/sanitized-delivery-destination-id"
      )
      expect(result.right.value.deliverable).toBe(true)
      expect(result.right.value.regionId).toBe("sanitized-region-id")
    }
  })

  it("rejects invalid single-destination input before network I/O", async () => {
    const fake = makeResponseTransport(makeResponse())
    const result = await getDeliveryDestination(
      makeSession(),
      {
        deliveryDestinationId: ""
      },
      fake.transport
    )

    expect(Either.isLeft(result)).toBe(true)
    expect(fake.requests()).toHaveLength(0)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("DeliveryDestinationInputInvalid")
    }
  })

  it("propagates API schema failures as redacted typed errors", async () => {
    const result = await getDeliveryDestinations(
      makeSession(),
      {},
      makeResponseTransport(makeResponse(JSON.stringify([{
        formattedAddress: secretAddress
      }]))).transport
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaSchemaDecodeFailure")
      expect(JSON.stringify(result.left)).not.toContain(secretAddress)
    }
  })
})
