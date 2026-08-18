import { Result } from "effect"

import { bootstrapGuestSession, searchProducts } from "../../src/index.js"
import { runLive } from "./live-transport.js"

const enabledValue = "1"
const liveSmokeFlag = "VOILA_LIVE_SMOKE"
const harmlessQuery = "milk"
const pageSize = 24
const successStatus = 0
const failureStatus = 1

type LiveSmokeFailure =
  | { readonly _tag: "LiveSmokeBootstrapFailed"; readonly causeTag: string }
  | { readonly _tag: "LiveSmokeSearchFailed"; readonly causeTag: string }
  | { readonly _tag: "LiveSmokeNoProducts" }

const toCauseTag = (error: { readonly _tag: string }): string => error._tag

const runSmoke = async (): Promise<Result.Result<number, LiveSmokeFailure>> => {
  const bootstrap = await runLive(bootstrapGuestSession())

  if (Result.isFailure(bootstrap)) {
    return Result.fail({ _tag: "LiveSmokeBootstrapFailed", causeTag: toCauseTag(bootstrap.failure) })
  }

  const search = await runLive(searchProducts(bootstrap.success.session, { pageSize, query: harmlessQuery }))

  if (Result.isFailure(search)) {
    return Result.fail({ _tag: "LiveSmokeSearchFailed", causeTag: toCauseTag(search.failure) })
  }

  if (search.success.value.products.length === 0) {
    return Result.fail({ _tag: "LiveSmokeNoProducts" })
  }

  return Result.succeed(search.success.value.products.length)
}

if (process.env[liveSmokeFlag] !== enabledValue) {
  process.stdout.write(`${liveSmokeFlag}=1 is required; skipping live catalog search smoke test.\n`)
  process.exit(successStatus)
} else {
  const result = await runSmoke()

  if (Result.isSuccess(result)) {
    process.stdout.write(
      `Live catalog search smoke passed with ${String(result.success)} products for query "${harmlessQuery}".\n`
    )
    process.exit(successStatus)
  } else {
    process.stderr.write(`Live catalog search smoke returned typed failure: ${JSON.stringify(result.failure)}\n`)
    process.exit(failureStatus)
  }
}
