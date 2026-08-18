import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const right = (result) =>
  result?._tag === "Right" ? result.right : result?._tag === "Success" ? result.success : undefined

const tagged = (result) => {
  if (result?._tag === "Right") return { _tag: "Right", value: result.right }
  if (result?._tag === "Left") return { _tag: "Left", error: { _tag: result.left?._tag ?? "UnknownFailure" } }
  if (result?._tag === "Success") return { _tag: "Right", value: result.success }
  if (result?._tag === "Failure") return { _tag: "Left", error: { _tag: result.failure?._tag ?? "UnknownFailure" } }
  return { _tag: "UnknownResult" }
}

const failure = (error) => ({ status: "unavailable", error: error?._tag ?? "SupplementProbeFailure" })

const makeSessionSnapshot = (sdk, regionId, token = "oracle-csrf", authenticated = false) => {
  const jar = sdk.toughCookieJarPort.create()
  jar.setCookieSync("voila-session=oracle-session-cookie; Path=/; Secure; HttpOnly", "https://voila.ca/")
  const serialized = sdk.serializeCookieJar(jar)
  const session = sdk.makeSessionSnapshot(
    { assetVersion: "oracle-asset", clientRouteId: "oracle-route", pageViewId: "oracle-page", regionId },
    { token },
    right(serialized)
  )
  const snapshot = authenticated
    ? sdk.makeAuthenticatedSdkSessionSnapshot(right(session), "authenticated")
    : sdk.makeGuestSdkSessionSnapshot(right(session))
  return right(snapshot)
}

const encodeSnapshot = (effect, sdk, snapshot) =>
  JSON.stringify(effect.Schema.encodeSync(sdk.SdkSessionSnapshotSchema)(snapshot))

const decodeRegion = (effect, sdk, contents) =>
  effect.Schema.decodeUnknownSync(effect.Schema.fromJsonString(sdk.SdkSessionSnapshotSchema))(contents).session.metadata
    .regionId

const writeSnapshot = async (effect, sdk, path, snapshot) => {
  await writeFile(path, encodeSnapshot(effect, sdk, snapshot), { encoding: "utf8", mode: 0o600 })
}

const runProvided = (effect, program, layer) =>
  effect.Effect.runPromise(effect.Effect.scoped(effect.Effect.provide(program, layer)))

const settle = (effect, program) => (effect.Effect.either ?? effect.Effect.result)(program)

const forkFiber = (effect, program) => (effect.Effect.fork ?? effect.Effect.forkDetach)(program)

const interruptFiber = (effect, fiber) => (effect.Fiber.interruptFork ?? effect.Fiber.interrupt)(fiber)

const continueWith = (effect, next) => effect.Effect.zipRight?.(next) ?? effect.Effect.andThen(next)

const asyncEffect = (effect, register) => (effect.Effect.async ?? effect.Effect.callback)(register)

const completeDeferredUnsafe = (effect, deferred, value) =>
  (effect.Deferred.unsafeDone ?? effect.Deferred.doneUnsafe)(deferred, effect.Effect.succeed(value))

const lineageSample = async ({ effect, mcp, sdk }) => {
  const directory = await mkdtemp(join(tmpdir(), "voila-oracle-lineage-"))
  const file = join(directory, "session.json")
  try {
    await writeSnapshot(effect, sdk, file, makeSessionSnapshot(sdk, "oracle-boot", "oracle-csrf", true))
    const transport = effect.Layer.succeed(sdk.VoilaTransport, {
      request: () => effect.Effect.fail({ _tag: "OracleTransportMustNotRun" })
    })
    const environment = right(mcp.makeNodeOperationEnvironment({ VOILA_AUTH_SESSION_PATH: file }, transport))
    const seen = []
    const observe = (current) => effect.Effect.succeed({ value: current.session.metadata.regionId })
    const refresh = (current) =>
      effect.Effect.succeed({
        refreshed: makeSessionSnapshot(sdk, `${current.session.metadata.regionId}+rotated`, "oracle-csrf", true),
        value: current.session.metadata.regionId
      })
    const first = await runProvided(
      effect,
      environment.session.withSession((current) => {
        seen.push(current.session.metadata.regionId)
        return observe(current)
      }),
      transport
    )
    await writeSnapshot(effect, sdk, file, makeSessionSnapshot(sdk, "oracle-fresh-login", "oracle-csrf", true))
    const second = await runProvided(effect, environment.session.withSession(refresh), transport)
    return {
      firstValue: first,
      persistedRegion: decodeRegion(effect, sdk, await readFile(file, "utf8")),
      secondValue: second,
      seen
    }
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
}

const guestDowngradeSample = async ({ effect, sdk, store }) => {
  const directory = await mkdtemp(join(tmpdir(), "voila-oracle-downgrade-"))
  const file = store.StateFilePathSchema.make(join(directory, "session.json"))
  const authenticated = makeSessionSnapshot(sdk, "oracle-authenticated", "oracle-csrf", true)
  try {
    await writeSnapshot(effect, sdk, file, authenticated)
    const result = await runProvided(
      effect,
      settle(
        effect,
        store.updateSessionFile(file, () =>
          effect.Effect.succeed(store.persistSession(makeSessionSnapshot(sdk, "oracle-guest")))
        )
      ),
      store.StateFileLocksLive
    )
    const outcome = tagged(result)
    return {
      error: outcome._tag === "Left" ? outcome.error : undefined,
      persistedRegion: decodeRegion(effect, sdk, await readFile(file, "utf8")),
      result: outcome
    }
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
}

const casSample = async ({ effect, sdk, store }) => {
  const directory = await mkdtemp(join(tmpdir(), "voila-oracle-cas-"))
  const file = store.StateFilePathSchema.make(join(directory, "session.json"))
  try {
    const entered = await effect.Effect.runPromise(effect.Deferred.make())
    const release = await effect.Effect.runPromise(effect.Deferred.make())
    const ours = makeSessionSnapshot(sdk, "oracle-ours")
    const theirs = makeSessionSnapshot(sdk, "oracle-theirs", "oracle-csrf", true)
    const program = effect.Effect.gen(function* () {
      const pending = yield* forkFiber(
        effect,
        settle(
          effect,
          store.updateSessionFile(file, () =>
            effect.Deferred.succeed(entered, undefined).pipe(
              continueWith(effect, effect.Deferred.await(release)),
              effect.Effect.as(store.persistSession(ours))
            )
          )
        )
      )
      const started = yield* effect.Effect.raceFirst(
        effect.Deferred.await(entered).pipe(effect.Effect.as({ _tag: "entered" })),
        effect.Fiber.join(pending).pipe(effect.Effect.map((outcome) => ({ _tag: "early", outcome })))
      )
      if (started._tag === "early") return started
      yield* effect.Effect.promise(() => writeSnapshot(effect, sdk, file, theirs))
      yield* effect.Deferred.succeed(release, undefined)
      return yield* effect.Fiber.join(pending)
    })
    const result = await runProvided(effect, program, store.StateFileLocksLive)
    const outcome = right(result)
    return outcome?._tag === "early"
      ? { status: "unavailable", error: "CasUpdateEndedBeforeTransform", result: tagged(outcome.outcome) }
      : {
          result: outcome?._tag === "dropped-conflict" ? { _tag: outcome._tag } : tagged(result),
          winnerRegion: outcome?._tag === "dropped-conflict" ? "oracle-theirs" : "unknown"
        }
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
}

const csrfSample = async ({ effect, sdk }) => {
  const snapshot = makeSessionSnapshot(sdk, "oracle-csrf-region").session
  const response = {
    body: `<html><script>window.__INITIAL_STATE__ = ${JSON.stringify({
      session: {
        csrf: { token: "oracle-fresh-csrf" },
        metadata: {
          assetVersion: "oracle-fresh-asset",
          pageViewId: "oracle-fresh-page",
          regionId: "oracle-csrf-region"
        }
      }
    })};</script></html>`,
    headers: { "set-cookie": "oracle-visitor=fresh; Path=/; Secure" },
    status: 200
  }
  const requests = []
  const transport = effect.Layer.succeed(sdk.VoilaTransport, {
    request: (request) => {
      requests.push({
        hasCookie: typeof request.headers.cookie === "string",
        method: request.method,
        path: request.url.pathname
      })
      return effect.Effect.succeed(response)
    }
  })
  const result = await runProvided(effect, settle(effect, sdk.refreshSessionCsrf(snapshot)), transport)
  const refreshed = right(result)
  return {
    metadata: refreshed === undefined ? undefined : refreshed.metadata,
    requests,
    result: refreshed === undefined ? tagged(result) : { _tag: "Right", value: { sessionRefreshed: true } },
    tokenChanged: refreshed?.csrf.token !== snapshot?.csrf.token
  }
}

const timingSample = async ({ effect, mcp, platform, sdk, testClock, testClockLayer }) => {
  if (platform === undefined || typeof mcp.voilaTransportLayer !== "function") {
    return { status: "unsupported-runtime" }
  }
  const run = (mode) => {
    const started = effect.Effect.runSync(effect.Deferred.make())
    const cancellations = []
    const client = effect.Layer.succeed(
      platform.HttpClient.HttpClient,
      platform.HttpClient.make(() =>
        asyncEffect(effect, () => {
          completeDeferredUnsafe(effect, started, undefined)
          return effect.Effect.sync(() => cancellations.push(true))
        })
      )
    )
    const request = effect.Effect.flatMap(sdk.VoilaTransport, (transport) =>
      transport.request({ headers: {}, method: "GET", url: new URL("https://voila.ca/api/oracle") })
    )
    const program = effect.Effect.gen(function* () {
      const fiber = yield* forkFiber(effect, settle(effect, request))
      const requestStarted = yield* effect.Effect.raceFirst(
        effect.Deferred.await(started).pipe(effect.Effect.as({ _tag: "started" })),
        effect.Fiber.join(fiber).pipe(effect.Effect.map((outcome) => ({ _tag: "early", outcome })))
      )
      if (requestStarted._tag === "early") {
        return { cancellations, result: tagged(requestStarted.outcome), status: "ended-before-http-client" }
      }
      if (mode === "deadline") {
        yield* testClock.adjust("1 second")
        const result = yield* effect.Fiber.join(fiber)
        return { cancellations, result: tagged(result) }
      }

      yield* interruptFiber(effect, fiber)
      const exit = yield* effect.Fiber.await(fiber)
      return { cancellations, result: { _tag: exit._tag === "Failure" ? "Interrupted" : "Completed" } }
    })
    const transportLayer = effect.Layer.provide(mcp.voilaTransportLayer(undefined, 500), client)
    return runProvided(effect, program, effect.Layer.merge(transportLayer, testClockLayer))
  }
  return { deadline: await run("deadline"), interruption: await run("interrupt"), clock: "TestClock" }
}

export const captureSessionSupplement = async ({ effect, mcp, platform, sdk, store, testClock, testClockLayer }) => {
  const samples = {}
  const probes = [
    ["lineage", () => lineageSample({ effect, mcp, sdk })],
    ["guestDowngrade", () => guestDowngradeSample({ effect, sdk, store })],
    ["cas", () => casSample({ effect, sdk, store })],
    ["csrfRefresh", () => csrfSample({ effect, sdk })],
    ["timing", () => timingSample({ effect, mcp, sdk, platform, testClock, testClockLayer })]
  ]
  for (const [name, probe] of probes) {
    try {
      samples[name] = await probe()
    } catch (error) {
      samples[name] = failure(error)
    }
  }
  return samples
}
