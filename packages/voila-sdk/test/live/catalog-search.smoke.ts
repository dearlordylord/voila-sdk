import { Either } from "effect"

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

const runSmoke = async (): Promise<Either.Either<number, LiveSmokeFailure>> => {
  const bootstrap = await runLive(bootstrapGuestSession())

  if (Either.isLeft(bootstrap)) {
    return Either.left({ _tag: "LiveSmokeBootstrapFailed", causeTag: toCauseTag(bootstrap.left) })
  }

  const search = await runLive(searchProducts(bootstrap.right.session, { pageSize, query: harmlessQuery }))

  if (Either.isLeft(search)) {
    return Either.left({ _tag: "LiveSmokeSearchFailed", causeTag: toCauseTag(search.left) })
  }

  if (search.right.value.products.length === 0) {
    return Either.left({ _tag: "LiveSmokeNoProducts" })
  }

  return Either.right(search.right.value.products.length)
}

if (process.env[liveSmokeFlag] !== enabledValue) {
  process.stdout.write(`${liveSmokeFlag}=1 is required; skipping live catalog search smoke test.\n`)
  process.exit(successStatus)
} else {
  const result = await runSmoke()

  if (Either.isRight(result)) {
    process.stdout.write(
      `Live catalog search smoke passed with ${String(result.right)} products for query "${harmlessQuery}".\n`
    )
    process.exit(successStatus)
  } else {
    process.stderr.write(`Live catalog search smoke returned typed failure: ${JSON.stringify(result.left)}\n`)
    process.exit(failureStatus)
  }
}
