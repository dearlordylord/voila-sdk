import { execFileSync } from "node:child_process"

import { describe, expect, it } from "vitest"

import type {
  BrowserLoginPort,
  CheckoutReadinessDecision,
  CookieJarPort,
  GetCheckoutSummaryResult,
  NormalizedCartView,
  NormalizedCheckoutSummary,
  NormalizedSlotListing,
  SdkSessionSnapshot,
  SessionStoragePort,
  VoilaTransport
} from "@firfi/voila-sdk"
import {
  addCartItems,
  applyCartDeltas,
  applyDeliveryContextChange,
  bootstrapGuestSession,
  CheckoutReadinessDecisionSchema,
  checkSessionHealth,
  createInteractiveBrowserLoginPort,
  decideCheckoutReadiness,
  getActiveShoppingContext,
  getCart,
  getCategoryProducts,
  getCheckoutSummary,
  getDeliveryDestination,
  getDeliveryDestinations,
  getDeliveryPropositionDetails,
  getInitialStateCategories,
  getSlotListings,
  loadSdkSessionSnapshot,
  loginWithBrowser,
  makeAuthenticatedSdkSessionSnapshot,
  makeCheckoutSummaryRequest,
  makeGuestSdkSessionSnapshot,
  makeSlotListingRequest,
  makeSlotReservationInputFromSlot,
  makeSlotReservationRequest,
  NormalizedCheckoutSummarySchema,
  previewDeliveryContextChange,
  removeCartItems,
  reserveSlot,
  saveSdkSessionSnapshot,
  searchProducts,
  SessionSnapshotSchema
} from "../../src/index.js"

type PublicPortTypes = {
  readonly browserLogin: BrowserLoginPort
  readonly cookieJar: CookieJarPort
  readonly storage: SessionStoragePort
  readonly transport: VoilaTransport
}

type PublicResultTypes = {
  readonly cart: NormalizedCartView
  readonly checkout: NormalizedCheckoutSummary
  readonly checkoutDecision: CheckoutReadinessDecision
  readonly checkoutResult: GetCheckoutSummaryResult
  readonly session: SdkSessionSnapshot
  readonly slots: NormalizedSlotListing
}

describe("public package entrypoint", () => {
  it("is importable through the package export map after build", () => {
    const output = execFileSync(
      process.execPath,
      [
        "-e",
        "import('@firfi/voila-sdk').then((sdk) => console.log(typeof sdk.searchProducts))"
      ],
      {
        encoding: "utf8"
      }
    )

    expect(output.trim()).toBe("function")
  })

  it("exports documented high-level operations and advanced request helpers", () => {
    const publicFunctions = [
      addCartItems,
      applyCartDeltas,
      applyDeliveryContextChange,
      bootstrapGuestSession,
      checkSessionHealth,
      createInteractiveBrowserLoginPort,
      decideCheckoutReadiness,
      getActiveShoppingContext,
      getCart,
      getCategoryProducts,
      getCheckoutSummary,
      getDeliveryDestination,
      getDeliveryDestinations,
      getDeliveryPropositionDetails,
      getInitialStateCategories,
      getSlotListings,
      loadSdkSessionSnapshot,
      loginWithBrowser,
      makeAuthenticatedSdkSessionSnapshot,
      makeCheckoutSummaryRequest,
      makeGuestSdkSessionSnapshot,
      makeSlotListingRequest,
      makeSlotReservationInputFromSlot,
      makeSlotReservationRequest,
      previewDeliveryContextChange,
      removeCartItems,
      reserveSlot,
      saveSdkSessionSnapshot,
      searchProducts
    ]

    expect(publicFunctions.every((fn) => typeof fn === "function")).toBe(true)
  })

  it("exports documented public schemas", () => {
    expect(SessionSnapshotSchema.ast._tag).toBe("TypeLiteral")
    expect(NormalizedCheckoutSummarySchema.ast._tag).toBe("TypeLiteral")
    expect(CheckoutReadinessDecisionSchema.ast._tag).toBe("TypeLiteral")
  })
})

export type { PublicPortTypes, PublicResultTypes }
