import { Effect, Result } from "effect"

import { parseUnknown } from "../domain/parse.js"
import {
  type ActiveCartCheckoutGroup,
  type ActiveCartViewResponse,
  type AnyCartViewResponse,
  AnyCartViewResponseSchema,
  type CartViewItemGroup,
  type CartViewResponse,
  type NormalizedCartView,
  NormalizedCartViewSchema,
  type SessionSnapshot
} from "../domain/schemas/index.js"
import type { VoilaJsonResult, VoilaSdkError } from "./http-client.js"
import { requestVoilaJson } from "./http-client.js"
import type { CookieJarPort } from "./session-snapshot.js"
import type { VoilaTransport } from "./transport.js"
import { makeCartViewRequest } from "./urls.js"

export type CartViewResponseNormalizationError = {
  readonly _tag: "CartViewResponseSchemaMismatch"
  readonly message: string
}

export type GetCartError = CartViewResponseNormalizationError | VoilaSdkError

export type GetCartResult = VoilaJsonResult<NormalizedCartView>

const cartViewResponseSchemaMismatch = (): CartViewResponseNormalizationError => ({
  _tag: "CartViewResponseSchemaMismatch",
  message: "Voila cart view response does not match the SDK schema"
})

const normalizeCartViewItemGroup = (group: CartViewItemGroup) =>
  group.items.map((item) => ({ ...item, ...(group.name === undefined ? {} : { groupName: group.name }) }))

const normalizeLegacyCartViewItemGroups = (itemGroups: ReadonlyArray<CartViewItemGroup> | undefined) =>
  (itemGroups ?? []).flatMap(normalizeCartViewItemGroup)

const normalizeActiveCartViewItemGroups = (checkoutGroups: ReadonlyArray<ActiveCartCheckoutGroup> | undefined) =>
  (checkoutGroups ?? []).flatMap((checkoutGroup) =>
    (checkoutGroup.itemGroups ?? []).flatMap(normalizeCartViewItemGroup)
  )

const normalizeCheckoutRestrictions = (
  restrictions: ReadonlyArray<string> | CartViewResponse["checkoutRestrictions"] | undefined
): NormalizedCartView["checkoutRestrictions"] =>
  (restrictions ?? []).map((restriction) => (typeof restriction === "string" ? { code: restriction } : restriction))

const isActiveCartViewResponse = (response: AnyCartViewResponse): response is ActiveCartViewResponse =>
  "cartId" in response

const projectCartViewResponse = (response: AnyCartViewResponse) => {
  const items = isActiveCartViewResponse(response)
    ? normalizeActiveCartViewItemGroups(response.checkoutGroups?.assignedCheckoutGroups)
    : normalizeLegacyCartViewItemGroups(response.basket.itemGroups)

  return {
    basketId: isActiveCartViewResponse(response) ? response.cartId : response.basket.basketId,
    checkoutRestrictions: normalizeCheckoutRestrictions(
      isActiveCartViewResponse(response)
        ? response.activeCheckoutGroup?.checkoutRestrictions
        : response.checkoutRestrictions
    ),
    itemCount: items.reduce((total, item) => total + item.quantity, 0),
    items,
    limitedItems: isActiveCartViewResponse(response) ? [] : (response.limitedItems ?? []),
    pricingNotifications: response.pricingNotifications ?? [],
    totals: isActiveCartViewResponse(response) ? response.totals : response.basket.totals,
    unavailableData: response.unavailableData ?? []
  }
}

export const normalizeCartViewResponse = (
  response: AnyCartViewResponse
): Result.Result<NormalizedCartView, CartViewResponseNormalizationError> =>
  Result.mapError(
    parseUnknown(NormalizedCartViewSchema, projectCartViewResponse(response)),
    cartViewResponseSchemaMismatch
  )

export const parseCartViewResponse = (
  input: unknown
): Result.Result<NormalizedCartView, CartViewResponseNormalizationError> =>
  Result.flatMap(
    Result.mapError(parseUnknown(AnyCartViewResponseSchema, input), cartViewResponseSchemaMismatch),
    normalizeCartViewResponse
  )

export const getCart = (
  session: SessionSnapshot,
  cookieJarPort?: CookieJarPort
): Effect.Effect<GetCartResult, GetCartError, VoilaTransport> =>
  Effect.flatMap(requestVoilaJson(AnyCartViewResponseSchema, session, makeCartViewRequest(), cookieJarPort), (result) =>
    Effect.map(Effect.fromResult(parseCartViewResponse(result.value)), (value) => ({ session: result.session, value }))
  )
