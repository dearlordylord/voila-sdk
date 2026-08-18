import { createRequire } from "node:module"
import { join } from "node:path"
import { spawn } from "node:child_process"
import { oracleWorkspaceRoot } from "./oracle-workspace.mjs"

const root = oracleWorkspaceRoot
const mcpRoot = join(root, "packages/voila-mcp")
const requireMcp = createRequire(join(mcpRoot, "package.json"))
const effect = requireMcp("effect")
let platform
let platformNode
try {
  platform = requireMcp("@effect/platform")
} catch {
  // Effect 3 exposes the HTTP client through @effect/platform.
}
try {
  platformNode = requireMcp("@effect/platform-node")
} catch {
  // Effect 4's Node server layer is loaded independently below. Keeping this
  // optional is also what lets the pre-cutover Effect 3 branch run.
}
let http
try {
  http = requireMcp("effect/unstable/http")
} catch {
  // Effect 3 has no effect/unstable/http module.
}

const resultValue = (value) =>
  value?._tag === "Right" ? value.right : value?._tag === "Success" ? value.success : undefined

export const makeSession = (sdk) => {
  const jar = sdk.toughCookieJarPort.create()
  jar.setCookieSync("voila-session=oracle-cookie; Path=/; Secure; HttpOnly", "https://voila.ca/")
  const serialized = sdk.serializeCookieJar(jar)
  if (resultValue(serialized) === undefined) throw new Error("Could not serialize oracle cookie jar")
  const session = sdk.makeSessionSnapshot(
    {
      assetVersion: "oracle-asset",
      clientRouteId: "oracle-route",
      pageViewId: "oracle-page",
      regionId: "oracle-region"
    },
    { token: "oracle-csrf" },
    resultValue(serialized)
  )
  if (resultValue(session) === undefined) throw new Error("Could not make oracle session snapshot")
  const guest = sdk.makeGuestSdkSessionSnapshot(resultValue(session))
  if (resultValue(guest) === undefined) throw new Error("Could not make oracle guest snapshot")
  return { guest: resultValue(guest), session: resultValue(session) }
}

const makeEnvironment = (sdk, body, failure = false) => {
  const snapshot = makeSession(sdk)
  const transport = effect.Layer.succeed(sdk.VoilaTransport, {
    request: () =>
      failure
        ? effect.Effect.fail({ _tag: "VoilaConnectionFailure", message: "Oracle transport failure" })
        : effect.Effect.succeed({ body, headers: {}, status: 200 })
  })
  return {
    session: {
      withSession: (operation) =>
        failure
          ? effect.Effect.fail({ _tag: "VoilaSessionUnavailable", message: "Oracle session unavailable" })
          : effect.Effect.map(operation(snapshot.guest), (outcome) => outcome.value)
    },
    transport
  }
}

const jsonRpcRequest = (path, body, headers = {}) =>
  effect.Effect.flatMap(platform.HttpClient.HttpClient, (client) =>
    client
      .execute(
        platform.HttpClientRequest.post(path, {
          body: platform.HttpBody.unsafeJson(body),
          headers: { accept: "application/json, text/event-stream", ...headers }
        })
      )
      .pipe(
        effect.Effect.flatMap((response) =>
          effect.Effect.map(response.json, (parsed) => ({ body: parsed, status: response.status }))
        ),
        effect.Effect.scoped
      )
  )

const jsonGet = (path) =>
  effect.Effect.flatMap(platform.HttpClient.HttpClient, (client) =>
    client.get(path).pipe(
      effect.Effect.flatMap((response) =>
        effect.Effect.map(response.json, (body) => ({ body, status: response.status }))
      ),
      effect.Effect.scoped
    )
  )

const jsonRpcRequestV4 = (path, body, headers = {}) =>
  effect.Effect.flatMap(http.HttpClient.HttpClient, (client) =>
    client
      .execute(
        http.HttpClientRequest.post(path, {
          body: http.HttpBody.jsonUnsafe(body),
          headers: { accept: "application/json, text/event-stream", ...headers }
        })
      )
      .pipe(
        effect.Effect.flatMap((response) =>
          effect.Effect.map(response.json, (parsed) => ({ body: parsed, status: response.status }))
        ),
        effect.Effect.scoped
      )
  )

const jsonGetV4 = (path) =>
  effect.Effect.flatMap(http.HttpClient.HttpClient, (client) =>
    client.get(path).pipe(
      effect.Effect.flatMap((response) =>
        effect.Effect.map(response.json, (body) => ({ body, status: response.status }))
      ),
      effect.Effect.scoped
    )
  )

export const protocolSamples = async (mcp, sdk, cartBody) => {
  if (http !== undefined) {
    if (platformNode === undefined) {
      throw new Error(
        "Deterministic RC.110 HTTP oracle requires effect/unstable/http and @effect/platform-node NodeHttpServer.layerTest"
      )
    }
    return protocolSamplesEffect4(mcp, sdk, cartBody)
  }
  if (platform !== undefined && platformNode !== undefined) return protocolSamplesEffect3(mcp, sdk, cartBody)
  throw new Error(
    "Deterministic HTTP oracle requires an Effect 3 @effect/platform seam or the RC.110 effect/unstable/http + NodeHttpServer.layerTest seam"
  )
}

const protocolSamplesEffect3 = async (mcp, sdk, cartBody) => {
  const path = "/mcp"
  const server = (environment) =>
    effect.Layer.provideMerge(mcp.voilaMcpRoutesLayer(path), platformNode.NodeHttpServer.layerTest).pipe(
      effect.Layer.provide(effect.Layer.succeed(mcp.VoilaOperations, environment)),
      effect.Layer.orDie
    )
  const initialize = {
    id: 1,
    jsonrpc: "2.0",
    method: "initialize",
    params: { capabilities: {}, clientInfo: { name: "voila-oracle", version: "1" }, protocolVersion: "2025-06-18" }
  }
  const list = { id: 2, jsonrpc: "2.0", method: "tools/list", params: {} }
  const call = (id, name, args) => ({ id, jsonrpc: "2.0", method: "tools/call", params: { arguments: args, name } })
  const run = (request, environment, headers) =>
    effect.Effect.runPromise(effect.Effect.provide(jsonRpcRequest(path, request, headers), server(environment)))
  const health = await effect.Effect.runPromise(
    effect.Effect.provide(effect.Effect.all([jsonGet("/"), jsonGet("/health")]), server(makeEnvironment(sdk, cartBody)))
  )
  const negotiated = await run(initialize, makeEnvironment(sdk, cartBody))
  const listed = await run(list, makeEnvironment(sdk, cartBody))
  const succeeded = await run(call(3, "voila_get_cart", {}), makeEnvironment(sdk, cartBody))
  const failed = await run(call(4, "voila_get_cart", {}), makeEnvironment(sdk, cartBody, true))
  const invalid = await run(call(5, "voila_search_products", { query: " milk " }), makeEnvironment(sdk, cartBody, true))
  const missingArguments = await run(
    { id: 6, jsonrpc: "2.0", method: "tools/call", params: { name: "voila_get_cart" } },
    makeEnvironment(sdk, cartBody, true)
  )
  const foreignOrigin = await run(list, makeEnvironment(sdk, cartBody), { origin: "https://attacker.example" })
  return { foreignOrigin, health, invalid, listed, missingArguments, negotiated, succeeded, failed }
}

const protocolSamplesEffect4 = async (mcp, sdk, cartBody) => {
  const path = "/mcp"
  const server = (environment) =>
    effect.Layer.provideMerge(mcp.voilaMcpRoutesLayer(path), platformNode.NodeHttpServer.layerTest).pipe(
      effect.Layer.provide(effect.Layer.succeed(mcp.VoilaOperations, environment)),
      effect.Layer.orDie
    )
  const initialize = {
    id: 1,
    jsonrpc: "2.0",
    method: "initialize",
    params: { capabilities: {}, clientInfo: { name: "voila-oracle", version: "1" }, protocolVersion: "2025-06-18" }
  }
  const list = { id: 2, jsonrpc: "2.0", method: "tools/list", params: {} }
  const call = (id, name, args) => ({ id, jsonrpc: "2.0", method: "tools/call", params: { arguments: args, name } })
  const run = (request, environment, headers) =>
    effect.Effect.runPromise(effect.Effect.provide(jsonRpcRequestV4(path, request, headers), server(environment)))
  const health = await effect.Effect.runPromise(
    effect.Effect.provide(
      effect.Effect.all([jsonGetV4("/"), jsonGetV4("/health")]),
      server(makeEnvironment(sdk, cartBody))
    )
  )
  const negotiated = await run(initialize, makeEnvironment(sdk, cartBody))
  const listed = await run(list, makeEnvironment(sdk, cartBody))
  const succeeded = await run(call(3, "voila_get_cart", {}), makeEnvironment(sdk, cartBody))
  const failed = await run(call(4, "voila_get_cart", {}), makeEnvironment(sdk, cartBody, true))
  const invalid = await run(call(5, "voila_search_products", { query: " milk " }), makeEnvironment(sdk, cartBody, true))
  const missingArguments = await run(
    { id: 6, jsonrpc: "2.0", method: "tools/call", params: { name: "voila_get_cart" } },
    makeEnvironment(sdk, cartBody, true)
  )
  const foreignOrigin = await run(list, makeEnvironment(sdk, cartBody), { origin: "https://attacker.example" })
  return { foreignOrigin, health, invalid, listed, missingArguments, negotiated, succeeded, failed }
}

export const stdioSamples = async () => {
  const child = spawn(process.execPath, [join(mcpRoot, "dist/bin.cjs")], {
    cwd: root,
    env: { ...process.env, MCP_TRANSPORT: "stdio", VOILA_GUEST: "1" },
    stdio: ["pipe", "pipe", "pipe"]
  })
  let output = ""
  let errorOutput = ""
  let pending
  let buffer = ""
  const readNext = () =>
    new Promise((resolve, reject) => {
      pending = { reject, resolve }
      const timer = setTimeout(() => reject(new Error("MCP stdio response timed out")), 5_000)
      pending.timer = timer
    })
  child.stdout.on("data", (chunk) => {
    output += String(chunk)
    buffer += String(chunk)
    const lineEnd = buffer.indexOf("\n")
    if (lineEnd >= 0 && pending !== undefined) {
      const line = buffer.slice(0, lineEnd)
      buffer = buffer.slice(lineEnd + 1)
      clearTimeout(pending.timer)
      const next = pending
      pending = undefined
      try {
        next.resolve(JSON.parse(line))
      } catch (error) {
        next.reject(error)
      }
    }
  })
  child.stderr.on("data", (chunk) => {
    errorOutput += String(chunk)
  })
  const exchange = async (message) => {
    child.stdin.write(`${JSON.stringify(message)}\n`)
    return readNext()
  }
  try {
    const initialize = await exchange({
      id: 1,
      jsonrpc: "2.0",
      method: "initialize",
      params: { capabilities: {}, clientInfo: { name: "oracle", version: "1" }, protocolVersion: "2025-06-18" }
    })
    const listed = await exchange({ id: 2, jsonrpc: "2.0", method: "tools/list", params: {} })
    return { errorOutput, initialize, listed, output }
  } finally {
    child.kill("SIGTERM")
  }
}
