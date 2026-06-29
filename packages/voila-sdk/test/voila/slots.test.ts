import { readFileSync } from "node:fs"

import { Either } from "effect"
import { describe, expect, it } from "vitest"

import { parseJson } from "../../src/domain/parse.js"
import type { SessionSnapshot, VoilaTransport, VoilaTransportRequest, VoilaTransportResponse } from "../../src/index.js"
import {
  getSlotListings,
  makeSessionSnapshot,
  makeSlotReservationInputFromSlot,
  NormalizedSlotListingSchema,
  NormalizedSlotReservationSchema,
  parseSlotListingResponse,
  parseSlotReservationResponse,
  reserveSlot,
  serializeCookieJar,
  toughCookieJarPort,
  VOILA_BASE_URL
} from "../../src/index.js"
import { assertDecodeSuccess, assertEncodeSuccess } from "../helpers/property.js"

const availableFixtureText = readFileSync(new URL("../fixtures/slot-listing-available.json", import.meta.url), "utf8")
const unavailableFixtureText = readFileSync(
  new URL("../fixtures/slot-listing-unavailable.json", import.meta.url),
  "utf8"
)
const reservationFixtureText = readFileSync(
  new URL("../fixtures/slot-reservation-success.json", import.meta.url),
  "utf8"
)
const csrfToken = "csrf-token"
const serviceDownBody = "{\"message\":\"sanitized service unavailable\"}"
const reservationRejectedBody = "{\"message\":\"sanitized slot no longer available\"}"

const sampleMetadata = {
  assetVersion: "asset-version",
  clientRouteId: "client-route-id",
  pageViewId: "client-page-view-id",
  regionId: "region-id"
}

const readFixture = (fixtureText: string): unknown => {
  const parsed = parseJson(fixtureText)

  if (Either.isLeft(parsed)) {
    throw new Error("Expected fixture JSON to parse")
  }

  return parsed.right
}

const makeSession = (): SessionSnapshot => {
  const jar = toughCookieJarPort.create()
  jar.setCookieSync("voila-session=before; Path=/; Secure", VOILA_BASE_URL)

  const cookieJar = serializeCookieJar(jar)

  if (Either.isLeft(cookieJar)) {
    throw new Error("Expected cookie jar serialization to succeed")
  }

  const snapshot = makeSessionSnapshot(sampleMetadata, { token: csrfToken }, cookieJar.right)

  if (Either.isLeft(snapshot)) {
    throw new Error("Expected session snapshot creation to succeed")
  }

  return snapshot.right
}

const makeResponse = (
  body: string,
  status: number = 200
): VoilaTransportResponse => ({
  body,
  headers: {},
  status
})

const makeResponseTransport = (
  response: VoilaTransportResponse
): {
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

const slotListingInput = {
  deliveryDestinationId: "sanitized-delivery-destination-id",
  numberOfDays: 7,
  pageViewId: "sanitized-page-view-id",
  regionId: "sanitized-region-id",
  sessionId: "sanitized-analytics-session-id",
  shippingGroupType: "HOME_DELIVERY",
  viewingLocation: "SLOT_BOOKING"
}

const slotReservationInput = {
  allowReservationOverwrite: true,
  confirmSlotReservation: true,
  deliveryDestinationId: "sanitized-delivery-destination-id",
  regionId: "sanitized-region-id",
  slotId: "sanitized-slot-id"
}

describe("slot listing parsing", () => {
  it("normalizes available standard and on-demand slots", () => {
    const result = parseSlotListingResponse(readFixture(availableFixtureText))

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(result.right.availableSlotCount).toBe(2)
      expect(result.right.carriers[0]).toEqual({
        carrierId: "sanitized-carrier-id",
        carrierName: "Voila delivery",
        days: [{
          day: "2026-07-01",
          slotIds: [
            "sanitized-slot-id"
          ],
          slotListingId: "sanitized-slot-listing-id"
        }],
        title: "Home delivery"
      })
      expect(result.right.slots[0]).toEqual({
        attributes: [
          "AVAILABLE",
          "STANDARD"
        ],
        available: true,
        carrierId: "sanitized-carrier-id",
        date: "2026-07-01",
        deliveryPrice: {
          amount: "3.99",
          currency: "CAD"
        },
        endTime: "2026-07-01T10:00:00-04:00",
        slotId: "sanitized-slot-id",
        slotListingId: "sanitized-slot-listing-id",
        startTime: "2026-07-01T08:00:00-04:00",
        timeZoneId: "America/Toronto",
        type: "STANDARD"
      })
      expect(result.right.slots[1]?.onDemandProperties?.deliveryTimeInMinutes).toBe(90)
    }
  })

  it("normalizes unavailable slots without marking them available", () => {
    const result = parseSlotListingResponse(readFixture(unavailableFixtureText))

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(result.right.availableSlotCount).toBe(0)
      expect(result.right.slots[0]?.available).toBe(false)
      expect(result.right.slots[0]?.attributes).toEqual(["FULL"])
    }
  })

  it("normalizes minimal slot listings without optional carrier or slot fields", () => {
    const result = parseSlotListingResponse({
      carriers: [{
        gridSlots: [{
          day: "2026-07-03",
          slots: [{}]
        }]
      }]
    })

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(result.right).toEqual({
        availableSlotCount: 0,
        carriers: [{
          days: []
        }],
        slots: [{
          attributes: [],
          available: false,
          date: "2026-07-03"
        }]
      })
    }
  })

  it("normalizes carriers that expose days before slot grids are available", () => {
    const result = parseSlotListingResponse({
      carriers: [{
        daysMapping: [{
          day: "2026-07-04"
        }]
      }]
    })

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(result.right).toEqual({
        availableSlotCount: 0,
        carriers: [{
          days: [{
            day: "2026-07-04"
          }]
        }],
        slots: []
      })
    }
  })

  it("keeps normalized slot listings under the public schema", () => {
    const result = parseSlotListingResponse(readFixture(availableFixtureText))

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      const decoded = assertDecodeSuccess(NormalizedSlotListingSchema, result.right)
      expect(assertEncodeSuccess(NormalizedSlotListingSchema, decoded)).toEqual(result.right)
    }
  })

  it("fails at the schema boundary with redacted errors when carriers are missing", () => {
    const result = parseSlotListingResponse({
      message: "sanitized service down"
    })

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("SlotListingSchemaMismatch")
      expect(JSON.stringify(result.left)).not.toContain("sanitized service down")
    }
  })
})

describe("slot reservation guardrails", () => {
  it("normalizes successful reservation responses with typed expiry data", () => {
    const result = parseSlotReservationResponse(readFixture(reservationFixtureText))

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(result.right).toEqual({
        confirmationData: {
          draftBasketId: "sanitized-draft-basket-id",
          invalidVouchers: [],
          regionChanged: false,
          slotRegionId: "sanitized-region-id",
          totalChanged: false
        },
        expiryTime: "2026-07-01T07:45:00-04:00",
        minimumCheckoutThreshold: {
          amount: "50.00",
          currency: "CAD"
        },
        originalMinimumCheckoutThreshold: {
          amount: "50.00",
          currency: "CAD"
        },
        reserved: true,
        slotId: "sanitized-slot-id",
        timeZoneId: "America/Toronto"
      })

      const decoded = assertDecodeSuccess(NormalizedSlotReservationSchema, result.right)
      expect(assertEncodeSuccess(NormalizedSlotReservationSchema, decoded)).toEqual(result.right)
    }
  })

  it("normalizes minimal reservation responses without optional slot details", () => {
    const result = parseSlotReservationResponse({
      slot: {}
    })

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(result.right).toEqual({
        reserved: true
      })
    }
  })

  it("builds reservation input from an available listed slot only after explicit acknowledgements", () => {
    const result = makeSlotReservationInputFromSlot(
      {
        allowReservationOverwrite: true,
        confirmSlotReservation: true,
        deliveryDestinationId: "sanitized-delivery-destination-id",
        externalAddress: {
          id: "sanitized-external-address-id"
        },
        regionId: "sanitized-region-id",
        slot: {
          attributes: ["AVAILABLE"],
          available: true,
          endTime: "2026-07-01T10:00:00-04:00",
          slotId: "sanitized-slot-id"
        }
      },
      new Date("2026-07-01T09:00:00-04:00")
    )

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(result.right).toEqual({
        allowReservationOverwrite: true,
        confirmSlotReservation: true,
        deliveryDestinationId: "sanitized-delivery-destination-id",
        externalAddress: {
          id: "sanitized-external-address-id"
        },
        regionId: "sanitized-region-id",
        slotId: "sanitized-slot-id"
      })
    }
  })

  it("builds reservation input from available slots that do not expose end-time metadata", () => {
    const result = makeSlotReservationInputFromSlot(
      {
        allowReservationOverwrite: true,
        confirmSlotReservation: true,
        deliveryDestinationId: "sanitized-delivery-destination-id",
        regionId: "sanitized-region-id",
        slot: {
          attributes: ["AVAILABLE"],
          available: true,
          slotId: "sanitized-slot-id"
        }
      },
      new Date("2026-07-01T09:00:00-04:00")
    )

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(result.right.slotId).toBe("sanitized-slot-id")
    }
  })

  it("rejects malformed listed slot reservation selections", () => {
    const result = makeSlotReservationInputFromSlot(
      {
        allowReservationOverwrite: true,
        deliveryDestinationId: "sanitized-delivery-destination-id",
        regionId: "sanitized-region-id",
        slot: {
          attributes: ["AVAILABLE"],
          available: true,
          slotId: "sanitized-slot-id"
        }
      },
      new Date("2026-07-01T09:00:00-04:00")
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("SlotReservationSelectionInvalid")
    }
  })

  it("rejects unavailable listed slots before reservation input is created", () => {
    const result = makeSlotReservationInputFromSlot(
      {
        allowReservationOverwrite: true,
        confirmSlotReservation: true,
        deliveryDestinationId: "sanitized-delivery-destination-id",
        regionId: "sanitized-region-id",
        slot: {
          attributes: ["FULL"],
          available: false,
          slotId: "sanitized-slot-id"
        }
      },
      new Date("2026-07-01T09:00:00-04:00")
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("SlotReservationSlotUnavailable")
    }
  })

  it("rejects available listed slots that do not include a slot ID", () => {
    const result = makeSlotReservationInputFromSlot(
      {
        allowReservationOverwrite: true,
        confirmSlotReservation: true,
        deliveryDestinationId: "sanitized-delivery-destination-id",
        regionId: "sanitized-region-id",
        slot: {
          attributes: ["AVAILABLE"],
          available: true
        }
      },
      new Date("2026-07-01T09:00:00-04:00")
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("SlotReservationSlotIdMissing")
    }
  })

  it("rejects expired listed slots before reservation input is created", () => {
    const result = makeSlotReservationInputFromSlot(
      {
        allowReservationOverwrite: true,
        confirmSlotReservation: true,
        deliveryDestinationId: "sanitized-delivery-destination-id",
        regionId: "sanitized-region-id",
        slot: {
          attributes: ["AVAILABLE"],
          available: true,
          endTime: "2026-07-01T10:00:00-04:00",
          slotId: "sanitized-slot-id"
        }
      },
      new Date("2026-07-01T10:00:00-04:00")
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("SlotReservationSlotExpired")
    }
  })

  it("rejects listed slots with invalid end-time metadata before network I/O", () => {
    const result = makeSlotReservationInputFromSlot(
      {
        allowReservationOverwrite: true,
        confirmSlotReservation: true,
        deliveryDestinationId: "sanitized-delivery-destination-id",
        regionId: "sanitized-region-id",
        slot: {
          attributes: ["AVAILABLE"],
          available: true,
          endTime: "not-a-date",
          slotId: "sanitized-slot-id"
        }
      },
      new Date("2026-07-01T09:00:00-04:00")
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("SlotReservationSlotEndTimeInvalid")
    }
  })

  it("rejects malformed reservation responses with redacted schema errors", () => {
    const result = parseSlotReservationResponse({
      message: "sanitized reservation response shape changed"
    })

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("SlotReservationSchemaMismatch")
      expect(JSON.stringify(result.left)).not.toContain("sanitized reservation response shape changed")
    }
  })
})

describe("getSlotListings", () => {
  it("reads slot listings without using reservation endpoints", async () => {
    const fake = makeResponseTransport(makeResponse(availableFixtureText))
    const result = await getSlotListings(makeSession(), slotListingInput, fake.transport)

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      const [request] = fake.requests()

      expect(request?.method).toBe("POST")
      expect(request?.url.href).toBe(`${VOILA_BASE_URL}/api/ecomslots/v2/slots`)
      expect(request?.url.href).not.toContain("reservation")
      expect(JSON.parse(request?.body ?? "{}")).toEqual({
        analyticsData: {
          pageViewId: "sanitized-page-view-id",
          platform: "WEB",
          sessionId: "sanitized-analytics-session-id",
          viewingLocation: "SLOT_BOOKING"
        },
        deliveryDestinationId: "sanitized-delivery-destination-id",
        displayConfiguration: "DELIVERY_METHOD",
        numberOfDays: 7,
        regionId: "sanitized-region-id",
        shippingGroupType: "HOME_DELIVERY"
      })
      expect(result.right.value.availableSlotCount).toBe(2)
    }
  })

  it("rejects invalid slot listing input before network I/O", async () => {
    const fake = makeResponseTransport(makeResponse(availableFixtureText))
    const result = await getSlotListings(
      makeSession(),
      {
        ...slotListingInput,
        numberOfDays: 0
      },
      fake.transport
    )

    expect(Either.isLeft(result)).toBe(true)
    expect(fake.requests()).toHaveLength(0)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("SlotListingInputInvalid")
    }
  })

  it("returns typed service-down errors without leaking response bodies", async () => {
    const result = await getSlotListings(
      makeSession(),
      slotListingInput,
      makeResponseTransport(makeResponse(serviceDownBody, 503)).transport
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaNon2xxResponse")
      expect(JSON.stringify(result.left)).not.toContain("sanitized service unavailable")
    }
  })
})

describe("reserveSlot", () => {
  it("reserves a slot only through the explicit reservation operation", async () => {
    const fake = makeResponseTransport(makeResponse(reservationFixtureText))
    const result = await reserveSlot(makeSession(), slotReservationInput, fake.transport)

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      const [request] = fake.requests()

      expect(request?.method).toBe("POST")
      expect(request?.url.href).toBe(`${VOILA_BASE_URL}/api/ecomslots/v1/slots/reservation`)
      expect(JSON.parse(request?.body ?? "{}")).toEqual({
        deliveryDestinationId: "sanitized-delivery-destination-id",
        regionId: "sanitized-region-id",
        slotId: "sanitized-slot-id"
      })
      expect(JSON.parse(request?.body ?? "{}")).not.toHaveProperty("confirmSlotReservation")
      expect(JSON.parse(request?.body ?? "{}")).not.toHaveProperty("allowReservationOverwrite")
      expect(result.right.value.expiryTime).toBe("2026-07-01T07:45:00-04:00")
    }
  })

  it("rejects reservation input without explicit acknowledgements before network I/O", async () => {
    const fake = makeResponseTransport(makeResponse(reservationFixtureText))
    const result = await reserveSlot(
      makeSession(),
      {
        deliveryDestinationId: "sanitized-delivery-destination-id",
        regionId: "sanitized-region-id",
        slotId: "sanitized-slot-id"
      },
      fake.transport
    )

    expect(Either.isLeft(result)).toBe(true)
    expect(fake.requests()).toHaveLength(0)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("SlotReservationInputInvalid")
    }
  })

  it("returns typed API rejections without leaking response bodies", async () => {
    const result = await reserveSlot(
      makeSession(),
      slotReservationInput,
      makeResponseTransport(makeResponse(reservationRejectedBody, 409)).transport
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaNon2xxResponse")
      expect(JSON.stringify(result.left)).not.toContain("sanitized slot no longer available")
    }
  })
})
