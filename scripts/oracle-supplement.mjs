import { captureCliSupplement } from "./oracle-supplement-cli.mjs"
import { captureOrderSupplement } from "./oracle-supplement-orders.mjs"
import { captureSessionSupplement } from "./oracle-supplement-session.mjs"

/**
 * The first oracle is intentionally kept immutable. This second corpus is an
 * additive capture for the Effect 3 APIs that were added after that first
 * capture: order history, CLI failure rendering, and session-file safety.
 */
export const captureSupplementalCorpus = async ({
  cli,
  effect,
  mcp,
  platform,
  sdk,
  store,
  testClock,
  testClockLayer
}) => ({
  cli: await captureCliSupplement(cli),
  sdk: { orders: await captureOrderSupplement({ effect, sdk }) },
  session: await captureSessionSupplement({ effect, mcp, platform, sdk, store, testClock, testClockLayer })
})
