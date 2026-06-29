import { Either } from "effect"

import { parseUnknown } from "../domain/parse.js"
import {
  type ActiveCartCheckoutGroup,
  type ActiveCartViewResponse,
  type AnyCartViewResponse,
  AnyCartViewResponseSchema,
  type CartViewItemGroup,
  type CartViewResponse,
  type NormalizedCartItem,
  type NormalizedCartView,
  NormalizedCartViewSchema,
  type SessionSnapshot
} from "../domain/schemas/index.js"
import type { VoilaJsonResult, VoilaSdkError, VoilaTransport } from "./http-client.js"
import { requestVoilaJson } from "./http-client.js"
import type { CookieJarPort } from "./session-snapshot.js"
import { makeCartViewRequest } from "./urls.js"

export type CartViewResponseNormalizationError = {
  readonly _tag: "CartViewResponseSchemaMismatch"
  readonly message: string
}

export type GetCartError = VoilaSdkError

export type GetCartResult = VoilaJsonResult<NormalizedCartView>

const cartViewResponseSchemaMismatch = (): CartViewResponseNormalizationError => ({
  _tag: "CartViewResponseSchemaMismatch",
  message: "Voila cart view response does not match the SDK schema"
})

const normalizeCartViewItemGroup = (group: CartViewItemGroup): ReadonlyArray<NormalizedCartItem> =>
  group.items.map((item) => ({
    ...item,
    ...(group.name === undefined ? {} : { groupName: group.name })
  }))

const normalizeLegacyCartViewItemGroups = (
  itemGroups: ReadonlyArray<CartViewItemGroup> | undefined
): ReadonlyArray<NormalizedCartItem> => (itemGroups ?? []).flatMap(normalizeCartViewItemGroup)

const normalizeActiveCartViewItemGroups = (
  checkoutGroups: ReadonlyArray<ActiveCartCheckoutGroup> | undefined
): ReadonlyArray<NormalizedCartItem> =>
  (checkoutGroups ?? []).flatMap((checkoutGroup) =>
    (checkoutGroup.itemGroups ?? []).flatMap(normalizeCartViewItemGroup)
  )

const normalizeCheckoutRestrictions = (
  restrictions: ReadonlyArray<string> | CartViewResponse["checkoutRestrictions"] | undefined
): NormalizedCartView["checkoutRestrictions"] =>
  (restrictions ?? []).map((restriction) =>
    typeof restriction === "string"
      ? { code: restriction }
      : restriction
  )

const isActiveCartViewResponse = (response: AnyCartViewResponse): response is ActiveCartViewResponse =>
  "cartId" in response

export const normalizeCartViewResponse = (
  response: AnyCartViewResponse
): NormalizedCartView => {
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
    limitedItems: isActiveCartViewResponse(response) ? [] : response.limitedItems ?? [],
    pricingNotifications: response.pricingNotifications ?? [],
    totals: isActiveCartViewResponse(response) ? response.totals : response.basket.totals,
    unavailableData: response.unavailableData ?? []
  }
}

export const parseCartViewResponse = (
  input: unknown
): Either.Either<NormalizedCartView, CartViewResponseNormalizationError> =>
  Either.flatMap(
    Either.mapLeft(parseUnknown(AnyCartViewResponseSchema, input), cartViewResponseSchemaMismatch),
    (response) =>
      Either.mapLeft(
        parseUnknown(NormalizedCartViewSchema, normalizeCartViewResponse(response)),
        cartViewResponseSchemaMismatch
      )
  )

export const getCart = async (
  session: SessionSnapshot,
  transport: VoilaTransport,
  cookieJarPort?: CookieJarPort
): Promise<Either.Either<GetCartResult, GetCartError>> => {
  const response = await requestVoilaJson(
    AnyCartViewResponseSchema,
    session,
    makeCartViewRequest(),
    transport,
    cookieJarPort
  )

  return Either.map(response, (result) => ({
    session: result.session,
    value: normalizeCartViewResponse(result.value)
  }))
}
