import { readFileSync } from "node:fs"

import { Either } from "effect"
import { describe, expect, it } from "vitest"

import { parseJson } from "../../src/domain/parse.js"
import type { SessionSnapshot, VoilaTransport, VoilaTransportRequest, VoilaTransportResponse } from "../../src/index.js"
import {
  applyDeliveryContextChange,
  getActiveShoppingContext,
  getDeliveryPropositionDetails,
  makeSessionSnapshot,
  normalizeDeliveryContextPreviewResponse,
  parseActiveShoppingContextResponse,
  parseDeliveryContextPreviewResponse,
  parseDeliveryPropositionDetailsResponse,
  previewDeliveryContextChange,
  serializeCookieJar,
  setActiveCartPropositionContext,
  setActiveDeliveryDestinationContext,
  toughCookieJarPort,
  VOILA_BASE_URL
} from "../../src/index.js"

const propositionsFixtureText = readFileSync(new URL("../fixtures/delivery-propositions.json", import.meta.url), "utf8")
const previewImpactFixtureText = readFileSync(
  new URL("../fixtures/delivery-context-preview-impact.json", import.meta.url),
  "utf8"
)
const csrfToken = "csrf-token"
const secretAddress = "123 Secret Street"
const secretCustomerId = "secret-customer-id"
const secretVisitorId = "secret-visitor-id"

const sampleMetadata = {
  assetVersion: "asset-version",
  clientRouteId: "client-route-id",
  pageViewId: "page-view-id",
  regionId: "region-id"
}

const readJsonFixture = (fixtureText: string): unknown => {
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

const makeResponse = (
  body: string,
  status: number = 200,
  headers: VoilaTransportResponse["headers"] = {}
): VoilaTransportResponse => ({
  body,
  headers,
  status
})

const makeSequenceTransport = (
  responses: ReadonlyArray<VoilaTransportResponse>
): {
  readonly requests: () => ReadonlyArray<VoilaTransportRequest>
  readonly transport: VoilaTransport
} => {
  const requests: Array<VoilaTransportRequest> = []
  const remaining = [...responses]

  return {
    requests: () => requests,
    transport: {
      request: async (request) => {
        requests.push(request)
        const response = remaining.shift()

        if (response === undefined) {
          return Either.left("unexpected extra request")
        }

        return Either.right(response)
      }
    }
  }
}

describe("shopping context parsing", () => {
  it("normalizes delivery and collection proposition details from a sanitized fixture", () => {
    const result = parseDeliveryPropositionDetailsResponse(readJsonFixture(propositionsFixtureText))

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(result.right.propositions).toHaveLength(2)
      expect(result.right.propositions[0]?.deliveryMethod).toBe("HOME_DELIVERY")
      expect(result.right.propositions[0]?.deliveryPropositionId).toBe("sanitized-home-proposition-id")
      expect(result.right.propositions[1]?.deliveryMethod).toBe("CUSTOMER_COLLECTION")
      expect(result.right.propositions[1]?.deliveryPropositionId).toBe("sanitized-collection-proposition-id")
    }
  })

  it("normalizes wrapped proposition detail responses", () => {
    const result = parseDeliveryPropositionDetailsResponse({
      propositions: readJsonFixture(propositionsFixtureText)
    })

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(result.right.propositions[0]?.deliveryMethod).toBe("HOME_DELIVERY")
    }
  })

  it("normalizes active shopping context fields without account identifiers", () => {
    const result = parseActiveShoppingContextResponse({
      cartPropositionId: "sanitized-cart-proposition-id",
      customerId: secretCustomerId,
      deliveryDestinationId: "sanitized-delivery-destination-id",
      deliveryMethod: "HOME_DELIVERY",
      propositionType: "SCHEDULED",
      regionId: "sanitized-region-id",
      type: "DELIVERY"
    })

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(result.right).toEqual({
        cartPropositionId: "sanitized-cart-proposition-id",
        deliveryDestinationId: "sanitized-delivery-destination-id",
        deliveryMethod: "HOME_DELIVERY",
        propositionType: "SCHEDULED",
        regionId: "sanitized-region-id",
        type: "DELIVERY"
      })
      expect(JSON.stringify(result.right)).not.toContain(secretCustomerId)
    }
  })

  it("surfaces cart impact warnings from proposition preview responses", () => {
    const result = parseDeliveryContextPreviewResponse(readJsonFixture(previewImpactFixtureText))

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(result.right.requiresConfirmation).toBe(true)
      expect(result.right.originCartPropositionId).toBe("sanitized-origin-cart-proposition-id")
      expect(result.right.destinationCartPropositionId).toBe("sanitized-destination-cart-proposition-id")
      expect(result.right.cartImpactWarnings.map((warning) => warning.kind)).toEqual([
        "origin-cart-items",
        "destination-cart-items",
        "limited-cart-items"
      ])
      expect(result.right.cartImpactWarnings[2]?.products[0]?.productId).toBe("sanitized-limited-product-id")
    }
  })

  it("does not require confirmation when proposition preview has no cart impact", () => {
    const result = normalizeDeliveryContextPreviewResponse({
      destinationCartProposition: {
        cartPropositionId: "sanitized-destination-cart-proposition-id",
        regionId: "sanitized-region-id"
      }
    })

    expect(result).toEqual({
      cartImpactWarnings: [],
      destinationCartPropositionId: "sanitized-destination-cart-proposition-id",
      destinationRegionId: "sanitized-region-id",
      requiresConfirmation: false
    })
  })

  it("normalizes previews with present propositions but no proposition IDs or regions", () => {
    const result = normalizeDeliveryContextPreviewResponse({
      destinationCartProposition: {},
      originCartProposition: {}
    })

    expect(result).toEqual({
      cartImpactWarnings: [],
      requiresConfirmation: false
    })
  })

  it("fails preview parsing with redacted schema errors", () => {
    const result = parseDeliveryContextPreviewResponse({
      formattedAddress: secretAddress
    })

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("ShoppingContextSchemaMismatch")
      expect(JSON.stringify(result.left)).not.toContain(secretAddress)
    }
  })
})

describe("shopping context operations", () => {
  it("reads active shopping context with the optional region query", async () => {
    const fake = makeSequenceTransport([
      makeResponse(JSON.stringify({
        deliveryDestinationId: "sanitized-delivery-destination-id",
        deliveryMethod: "HOME_DELIVERY",
        regionId: "sanitized-region-id",
        type: "DELIVERY"
      }))
    ])
    const result = await getActiveShoppingContext(
      makeSession(),
      {
        regionId: "sanitized-region-id"
      },
      fake.transport
    )

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      const [request] = fake.requests()
      expect(request?.method).toBe("GET")
      expect(request?.url.href).toBe(
        `${VOILA_BASE_URL}/api/customersessions/v2/sessions/active?regionId=sanitized-region-id`
      )
      expect(result.right.value.deliveryMethod).toBe("HOME_DELIVERY")
    }
  })

  it("reads active shopping context without a region query", async () => {
    const fake = makeSequenceTransport([
      makeResponse(JSON.stringify({
        type: "DELIVERY"
      }))
    ])
    const result = await getActiveShoppingContext(makeSession(), {}, fake.transport)

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      const [request] = fake.requests()
      expect(request?.url.search).toBe("")
      expect(result.right.value).toEqual({
        type: "DELIVERY"
      })
    }
  })

  it("rejects invalid active shopping context input before network I/O", async () => {
    const fake = makeSequenceTransport([])
    const result = await getActiveShoppingContext(
      makeSession(),
      {
        regionId: ""
      },
      fake.transport
    )

    expect(Either.isLeft(result)).toBe(true)
    expect(fake.requests()).toHaveLength(0)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("ActiveShoppingContextInputInvalid")
    }
  })

  it("reads delivery proposition details", async () => {
    const fake = makeSequenceTransport([
      makeResponse(propositionsFixtureText)
    ])
    const result = await getDeliveryPropositionDetails(
      makeSession(),
      {
        deliveryDestinationId: "sanitized-delivery-destination-id",
        regionId: "sanitized-region-id"
      },
      fake.transport
    )

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      const [request] = fake.requests()
      expect(request?.method).toBe("GET")
      expect(request?.url.pathname).toBe("/api/ecomdeliverydestinations/v1/propositions")
      expect(request?.url.searchParams.get("regionId")).toBe("sanitized-region-id")
      expect(request?.url.searchParams.get("deliveryDestinationId")).toBe("sanitized-delivery-destination-id")
      expect(result.right.value.propositions[1]?.deliveryMethod).toBe("CUSTOMER_COLLECTION")
    }
  })

  it("rejects invalid proposition detail input before network I/O", async () => {
    const fake = makeSequenceTransport([])
    const result = await getDeliveryPropositionDetails(
      makeSession(),
      {
        deliveryDestinationId: "",
        regionId: "sanitized-region-id"
      },
      fake.transport
    )

    expect(Either.isLeft(result)).toBe(true)
    expect(fake.requests()).toHaveLength(0)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("DeliveryPropositionDetailsInputInvalid")
    }
  })

  it("previews delivery context changes and returns cart impact warnings", async () => {
    const fake = makeSequenceTransport([
      makeResponse(previewImpactFixtureText)
    ])
    const result = await previewDeliveryContextChange(
      makeSession(),
      {
        deliveryDestinationId: "sanitized-delivery-destination-id",
        destinationRegionId: "sanitized-region-id"
      },
      fake.transport
    )

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      const [request] = fake.requests()
      expect(request?.method).toBe("POST")
      expect(request?.url.pathname).toBe("/api/customersessions/v2/sessions/proposition")
      expect(request?.body).toBe(JSON.stringify({
        deliveryDestinationId: "sanitized-delivery-destination-id",
        destinationRegionId: "sanitized-region-id"
      }))
      expect(result.right.value.requiresConfirmation).toBe(true)
      expect(result.right.value.cartImpactWarnings).toHaveLength(3)
    }
  })

  it("rejects invalid delivery context preview input before network I/O", async () => {
    const fake = makeSequenceTransport([])
    const result = await previewDeliveryContextChange(
      makeSession(),
      {
        deliveryDestinationId: "sanitized-delivery-destination-id",
        destinationRegionId: ""
      },
      fake.transport
    )

    expect(Either.isLeft(result)).toBe(true)
    expect(fake.requests()).toHaveLength(0)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("DeliveryContextPreviewInputInvalid")
    }
  })

  it("sets active delivery destination context with optional account headers", async () => {
    const fake = makeSequenceTransport([
      makeResponse(JSON.stringify({
        deliveryDestinationId: "sanitized-delivery-destination-id",
        deliveryMethod: "HOME_DELIVERY",
        regionId: "sanitized-region-id"
      }))
    ])
    const result = await setActiveDeliveryDestinationContext(
      makeSession(),
      {
        customerId: secretCustomerId,
        deliveryDestinationId: "sanitized-delivery-destination-id",
        regionId: "sanitized-region-id",
        visitorId: secretVisitorId
      },
      fake.transport
    )

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      const [request] = fake.requests()
      expect(request?.method).toBe("PUT")
      expect(request?.url.pathname).toBe("/api/customersessions/v2/sessions/active")
      expect(request?.headers["customer-id"]).toBe(secretCustomerId)
      expect(request?.headers["visitor-id"]).toBe(secretVisitorId)
      expect(request?.body).toBe(JSON.stringify({
        deliveryDestinationId: "sanitized-delivery-destination-id",
        regionId: "sanitized-region-id"
      }))
      expect(JSON.stringify(result.right.value)).not.toContain(secretCustomerId)
    }
  })

  it("rejects invalid active delivery destination context input before network I/O", async () => {
    const fake = makeSequenceTransport([])
    const result = await setActiveDeliveryDestinationContext(
      makeSession(),
      {
        deliveryDestinationId: "sanitized-delivery-destination-id",
        regionId: ""
      },
      fake.transport
    )

    expect(Either.isLeft(result)).toBe(true)
    expect(fake.requests()).toHaveLength(0)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("SetActiveDeliveryDestinationInputInvalid")
    }
  })

  it("sets active cart proposition context", async () => {
    const fake = makeSequenceTransport([
      makeResponse(JSON.stringify({
        cartPropositionId: "sanitized-destination-cart-proposition-id",
        deliveryMethod: "CUSTOMER_COLLECTION",
        regionId: "sanitized-destination-region-id"
      }))
    ])
    const result = await setActiveCartPropositionContext(
      makeSession(),
      {
        destinationCartPropositionId: "sanitized-destination-cart-proposition-id",
        originCartPropositionId: "sanitized-origin-cart-proposition-id"
      },
      fake.transport
    )

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      const [request] = fake.requests()
      expect(request?.method).toBe("POST")
      expect(request?.url.pathname).toBe("/api/customersessions/v2/sessions/active")
      expect(request?.body).toBe(JSON.stringify({
        destinationCartPropositionId: "sanitized-destination-cart-proposition-id",
        originCartPropositionId: "sanitized-origin-cart-proposition-id"
      }))
      expect(result.right.value.deliveryMethod).toBe("CUSTOMER_COLLECTION")
    }
  })

  it("rejects invalid active cart proposition context input before network I/O", async () => {
    const fake = makeSequenceTransport([])
    const result = await setActiveCartPropositionContext(
      makeSession(),
      {
        destinationCartPropositionId: "sanitized-destination-cart-proposition-id",
        originCartPropositionId: ""
      },
      fake.transport
    )

    expect(Either.isLeft(result)).toBe(true)
    expect(fake.requests()).toHaveLength(0)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("SetActiveCartPropositionInputInvalid")
    }
  })

  it("does not apply a context change with cart impact unless explicitly allowed", async () => {
    const fake = makeSequenceTransport([
      makeResponse(previewImpactFixtureText)
    ])
    const result = await applyDeliveryContextChange(
      makeSession(),
      {
        deliveryDestinationId: "sanitized-delivery-destination-id",
        destinationRegionId: "sanitized-region-id"
      },
      fake.transport
    )

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(fake.requests()).toHaveLength(1)
      expect(result.right.value.status).toBe("requires-confirmation")
      expect(result.right.value.applied).toBe(false)
      expect(result.right.value.preview.cartImpactWarnings).toHaveLength(3)
    }
  })

  it("propagates preview failures before applying context changes", async () => {
    const fake = makeSequenceTransport([
      makeResponse(JSON.stringify({
        unexpected: true
      }))
    ])
    const result = await applyDeliveryContextChange(
      makeSession(),
      {
        allowCartImpact: true,
        deliveryDestinationId: "sanitized-delivery-destination-id",
        destinationRegionId: "sanitized-region-id"
      },
      fake.transport
    )

    expect(Either.isLeft(result)).toBe(true)
    expect(fake.requests()).toHaveLength(1)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaSchemaDecodeFailure")
    }
  })

  it("applies a confirmed proposition context change and keeps the preview warnings", async () => {
    const fake = makeSequenceTransport([
      makeResponse(previewImpactFixtureText),
      makeResponse(JSON.stringify({
        cartPropositionId: "sanitized-destination-cart-proposition-id",
        deliveryMethod: "CUSTOMER_COLLECTION",
        regionId: "sanitized-destination-region-id"
      }))
    ])
    const result = await applyDeliveryContextChange(
      makeSession(),
      {
        allowCartImpact: true,
        customerId: secretCustomerId,
        deliveryDestinationId: "sanitized-delivery-destination-id",
        destinationRegionId: "sanitized-region-id",
        visitorId: secretVisitorId
      },
      fake.transport
    )

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      const [, commitRequest] = fake.requests()
      expect(commitRequest?.method).toBe("POST")
      expect(commitRequest?.headers["customer-id"]).toBe(secretCustomerId)
      expect(commitRequest?.headers["visitor-id"]).toBe(secretVisitorId)
      expect(result.right.value.status).toBe("applied")
      if (result.right.value.status === "applied") {
        expect(result.right.value.preview.cartImpactWarnings).toHaveLength(3)
        expect(result.right.value.context.cartPropositionId).toBe("sanitized-destination-cart-proposition-id")
      }
      expect(JSON.stringify(result.right.value)).not.toContain(secretCustomerId)
      expect(JSON.stringify(result.right.value)).not.toContain(secretVisitorId)
    }
  })

  it("propagates failed confirmed cart proposition commits", async () => {
    const fake = makeSequenceTransport([
      makeResponse(previewImpactFixtureText),
      makeResponse(
        JSON.stringify({
          error: "sanitized failure"
        }),
        500
      )
    ])
    const result = await applyDeliveryContextChange(
      makeSession(),
      {
        allowCartImpact: true,
        deliveryDestinationId: "sanitized-delivery-destination-id",
        destinationRegionId: "sanitized-region-id"
      },
      fake.transport
    )

    expect(Either.isLeft(result)).toBe(true)
    expect(fake.requests()).toHaveLength(2)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaNon2xxResponse")
    }
  })

  it("falls back to delivery destination context when preview has no origin cart proposition", async () => {
    const fake = makeSequenceTransport([
      makeResponse(JSON.stringify({
        destinationCartProposition: {
          cartPropositionId: "sanitized-destination-cart-proposition-id",
          regionId: "sanitized-region-id"
        }
      })),
      makeResponse(JSON.stringify({
        deliveryDestinationId: "sanitized-delivery-destination-id",
        deliveryMethod: "HOME_DELIVERY",
        regionId: "sanitized-region-id"
      }))
    ])
    const result = await applyDeliveryContextChange(
      makeSession(),
      {
        deliveryDestinationId: "sanitized-delivery-destination-id",
        destinationRegionId: "sanitized-region-id"
      },
      fake.transport
    )

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      const [, commitRequest] = fake.requests()
      expect(commitRequest?.method).toBe("PUT")
      expect(commitRequest?.body).toBe(JSON.stringify({
        deliveryDestinationId: "sanitized-delivery-destination-id",
        regionId: "sanitized-region-id"
      }))
      expect(result.right.value.status).toBe("applied")
    }
  })

  it("propagates failed fallback delivery destination commits", async () => {
    const fake = makeSequenceTransport([
      makeResponse(JSON.stringify({
        destinationCartProposition: {
          cartPropositionId: "sanitized-destination-cart-proposition-id",
          regionId: "sanitized-region-id"
        }
      })),
      makeResponse(
        JSON.stringify({
          error: "sanitized failure"
        }),
        500
      )
    ])
    const result = await applyDeliveryContextChange(
      makeSession(),
      {
        deliveryDestinationId: "sanitized-delivery-destination-id",
        destinationRegionId: "sanitized-region-id"
      },
      fake.transport
    )

    expect(Either.isLeft(result)).toBe(true)
    expect(fake.requests()).toHaveLength(2)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaNon2xxResponse")
    }
  })

  it("rejects invalid apply input before network I/O", async () => {
    const fake = makeSequenceTransport([])
    const result = await applyDeliveryContextChange(
      makeSession(),
      {
        deliveryDestinationId: "",
        destinationRegionId: "sanitized-region-id"
      },
      fake.transport
    )

    expect(Either.isLeft(result)).toBe(true)
    expect(fake.requests()).toHaveLength(0)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("ApplyDeliveryContextChangeInputInvalid")
    }
  })
})
