import { createRequire } from "node:module"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { spawn } from "node:child_process"
import { register } from "tsx/esm/api"

import {
  canonicalJson,
  normalizeNondeterministic,
  oracleVersion,
  toOracleValue,
  validateDraft07
} from "./oracle-core.mjs"
import { artifactManifest } from "./oracle-artifacts.mjs"
import { makeSession, protocolSamples, stdioSamples } from "./oracle-protocol.mjs"
import { oracleWorkspaceRoot } from "./oracle-workspace.mjs"
import { parseJsonValue } from "./json-boundary.mjs"

const root = oracleWorkspaceRoot
const mcpRoot = join(root, "packages/voila-mcp")
const cliRoot = join(root, "packages/voila-cli")
const sdkRoot = join(root, "packages/voila-sdk")
const requireMcp = createRequire(join(mcpRoot, "package.json"))
const effect = requireMcp("effect")
const testing = effect.TestClock === undefined ? requireMcp("effect/testing") : undefined
const testClock = effect.TestClock ?? testing.TestClock
const testClockLayer =
  effect.TestContext?.TestContext ?? effect.Layer.mergeAll(testing.TestConsole.layer, testClock.layer())
let toolApi
try {
  toolApi = requireMcp("effect/unstable/ai")
} catch {
  try {
    toolApi = requireMcp("@effect/ai")
  } catch {
    // Effect 3 builds expose annotation maps directly on the tool value.
  }
}

const loadBuiltPackages = async () => {
  const store = await import(join(root, "packages/voila-session-store/dist/src/index.js")).catch(() => undefined)
  const mcp = requireMcp(join(mcpRoot, "dist/index.cjs"))
  const unregisterTypeScript = register({ tsconfig: false })
  const mcpTransport = await import(join(mcpRoot, "src/node-transport.ts")).finally(unregisterTypeScript)
  let platform
  try {
    platform = requireMcp("@effect/platform")
  } catch {
    // Effect 4 folds the HTTP client APIs into Effect itself.
    platform = requireMcp("effect/unstable/http")
  }
  return {
    cli: requireMcp(join(cliRoot, "dist/index.cjs")),
    mcp: { ...mcp, voilaTransportLayer: mcpTransport.voilaTransportLayer },
    platform,
    sdk: await import(join(sdkRoot, "dist/src/index.js")),
    store,
    testClock,
    testClockLayer
  }
}

const readJson = async (path) => parseJsonValue(await readFile(path, "utf8"))
const fixture = async (name) => readJson(join(sdkRoot, "test/fixtures", name))
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)

const normalizeResultAsEither = (value) => {
  if (value?._tag === "Right") return { _tag: "Right", value: value.right }
  if (value?._tag === "Left") return { _tag: "Left", value: value.left }
  if (value?._tag === "Success") return { _tag: "Right", value: value.success }
  if (value?._tag === "Failure") return { _tag: "Left", value: value.failure }
  return value
}

const resultValue = (value) =>
  value?._tag === "Right" ? value.right : value?._tag === "Success" ? value.success : undefined

const schemaJson = (schema) => {
  if (schema === undefined) return { $oracle: "missing-schema" }
  if (typeof effect.JSONSchema?.make === "function") return effect.JSONSchema.make(schema)
  if (typeof effect.Schema?.toStandardJSONSchemaV1 === "function") {
    const standard = effect.Schema.toStandardJSONSchemaV1(schema)
    return standard["~standard"].jsonSchema.input({ target: "draft-07" })
  }
  if (typeof effect.Schema?.toJSONSchema === "function") return effect.Schema.toJSONSchema(schema)
  throw new Error("Effect JSON Schema converter is unavailable")
}

const metadataFromTool = (tool) => {
  const contextAnnotation = (name) => {
    const key = toolApi?.Tool?.[name]
    if (key === undefined || tool.annotations === undefined || typeof effect.Context?.getOption !== "function") {
      return undefined
    }
    try {
      const option = effect.Context.getOption(tool.annotations, key)
      return option?._tag === "Some" ? option.value : undefined
    } catch {
      return undefined
    }
  }
  const annotations = tool.annotations?.unsafeMap ?? tool.annotations ?? {}
  const legacyAnnotation = (name) => (annotations instanceof Map ? annotations.get(name) : annotations[name])
  const getAnnotation = (name, legacyName) =>
    contextAnnotation(name) ?? legacyAnnotation(legacyName) ?? legacyAnnotation(`@effect/ai/Tool/${name}`)
  return {
    annotations: {
      destructiveHint: getAnnotation("Destructive", "destructiveHint"),
      idempotentHint: getAnnotation("Idempotent", "idempotentHint"),
      openWorldHint: getAnnotation("OpenWorld", "openWorldHint"),
      readOnlyHint: getAnnotation("Readonly", "readOnlyHint")
    },
    description: tool.description,
    failureMode: tool.failureMode,
    failureSchema: schemaJson(tool.failureSchema),
    inputSchema: schemaJson(tool.parametersSchema ?? tool.parameters),
    name: tool.name,
    successSchema: schemaJson(tool.successSchema ?? tool.success),
    title: getAnnotation("Title", "title")
  }
}

export const wireToolSchemas = (protocol) => {
  const tools = protocol?.listed?.body?.result?.tools
  if (!Array.isArray(tools)) throw new Error("MCP tools/list did not return a result.tools array")
  const schemas = {}
  for (const tool of tools) {
    if (typeof tool?.name !== "string" || tool.name.length === 0) {
      throw new Error(`MCP tools/list returned a tool without a name: ${JSON.stringify(tool)}`)
    }
    if (tool.inputSchema === undefined) {
      throw new Error(`MCP tools/list tool ${tool.name} omitted its inputSchema`)
    }
    schemas[`${tool.name}.wire.input`] = tool.inputSchema
    if (Object.hasOwn(tool, "outputSchema")) schemas[`${tool.name}.wire.output`] = tool.outputSchema
  }
  return schemas
}

const draft07WireSchema = (schema) => {
  if (!isRecord(schema)) return schema
  const dialect = typeof schema.$schema === "string" ? schema.$schema : ""
  const requiresConversion = dialect.includes("2020-12") || Object.hasOwn(schema, "$defs")
  const fromSchemaDraft2020_12 = effect.JsonSchema?.fromSchemaDraft2020_12
  const toDocumentDraft07 = effect.JsonSchema?.toDocumentDraft07
  if (!requiresConversion || typeof fromSchemaDraft2020_12 !== "function" || typeof toDocumentDraft07 !== "function") {
    return schema
  }
  const document = toDocumentDraft07(fromSchemaDraft2020_12(schema))
  return Object.keys(document.definitions).length > 0
    ? { ...document.schema, definitions: document.definitions }
    : document.schema
}

export const wireDraft07Schemas = (protocol) =>
  Object.fromEntries(
    Object.entries(wireToolSchemas(protocol)).map(([name, schema]) => [name, draft07WireSchema(schema)])
  )

const operationNames = (mcp) => {
  const descriptors = mcp.voilaOperationDescriptors ?? []
  return descriptors.length > 0
    ? descriptors.map((descriptor) => descriptor.name)
    : Object.keys(mcp.voilaToolkit.tools).sort()
}

const runCliProcess = (args) =>
  new Promise((resolveProcess, reject) => {
    const child = spawn(process.execPath, [join(cliRoot, "dist/bin.cjs"), ...args], {
      cwd: root,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"]
    })
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => {
      child.kill("SIGTERM")
      reject(new Error(`CLI process timed out for ${args.join(" ")}`))
    }, 5_000)
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk)
    })
    child.once("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once("close", (code, signal) => {
      clearTimeout(timer)
      resolveProcess({ code, signal, stderr, stdout })
    })
  })

const cliSamples = async (cli) => {
  const calls = []
  const success = (value) => ({ ok: true, value })
  const failure = (tag, message, authGuidance) => ({
    ok: false,
    error: { _tag: tag, message, ...(authGuidance === undefined ? {} : { authGuidance }) }
  })
  const ports = {
    login: async (options) => {
      calls.push({ kind: "login", options })
      return success({ authenticated: true })
    },
    runOperation: async (name, input, options) => {
      calls.push({ input, name, options })
      if (name === "voila_check_session_health")
        return failure("VoilaAuthRequired", "Session needs login", {
          command: "voila auth login --session /tmp/voila-oracle-session.json",
          instructions: "Run the login command",
          message: "Authentication is required"
        })
      return success({ operation: name, input })
    }
  }
  const cases = [
    ["root-help", []],
    ["search-json", ["search", "milk", "--page-size", "4", "--json", "--session", "/tmp/voila-oracle-session.json"]],
    ["discounts-text", ["discounts", "milk", "--sort", "best-percent", "--session", "/tmp/voila-oracle-session.json"]],
    ["auth-status-json", ["auth", "status", "--json", "--session", "/tmp/voila-oracle-session.json"]],
    ["usage-missing-query", ["search"]],
    ["usage-invalid-quantity", ["cart", "add", "product", "--quantity", "0"]],
    ["unknown-command", ["unknown"]]
  ]
  const results = []
  for (const [name, args] of cases) results.push({ args, name, result: await cli.runCli(args, ports) })
  const processResults = []
  for (const [name, args] of [
    ["help", ["--help"]],
    ["missing-query", ["search"]],
    ["unknown", ["unknown"]]
  ]) {
    processResults.push({ args, name, result: await runCliProcess(args) })
  }
  return { calls, process: processResults, results }
}

const decodeUnknown = (schema, value) =>
  typeof effect.Schema.decodeUnknownEither === "function"
    ? effect.Schema.decodeUnknownEither(schema)(value)
    : effect.Schema.decodeUnknownResult(schema)(value)

const encodeValue = (schema, value) =>
  typeof effect.Schema.encodeEither === "function"
    ? effect.Schema.encodeEither(schema)(value)
    : effect.Schema.encodeResult(schema)(value)

const sdkSamples = async (sdk) => {
  const discountFixture = {
    productGroups: [
      {
        name: "Promotions",
        products: [
          {
            available: true,
            maxQuantityReached: false,
            name: "Oracle Milk",
            packSizeDescription: "2L",
            price: { amount: "5.00", currency: "CAD" },
            productId: "oracle-discount-product",
            promoPrice: { amount: "4.00", currency: "CAD" },
            promotions: [{ label: "Oracle promotion" }],
            quantityInBasket: 0,
            retailerProductId: "ORACLE-1"
          }
        ],
        type: "featured"
      }
    ],
    totalProducts: 1
  }
  const fixtureCases = [
    ["catalog-search", "search-response-milk.json", "parseSearchResponse"],
    ["category-products", "category-products-produce.json", "parseCategoryProductsResponse"],
    ["cart-view", "cart-view-non-empty.json", "parseCartViewResponse"],
    ["cart-mutation", "cart-apply-limited-unavailable.json", "parseCartMutationResponse"],
    ["discounts", undefined, "parseDiscountedProductsResponse"],
    ["slots", "slot-listing-available.json", "parseSlotListingResponse"],
    ["slot-reservation", "slot-reservation-success.json", "parseSlotReservationResponse"],
    ["checkout-summary", "checkout-summary-ready.json", "parseCheckoutSummaryResponse"]
  ]
  const parsed = {}
  for (const [name, file, functionName] of fixtureCases) {
    parsed[name] =
      file === undefined
        ? normalizeResultAsEither(sdk[functionName](discountFixture, { pageSize: 2, query: "milk" }))
        : normalizeResultAsEither(sdk[functionName](await fixture(file)))
  }
  const session = makeSession(sdk)
  const authenticated = sdk.makeAuthenticatedSdkSessionSnapshot(session.session, "authenticated", {
    displayName: "Oracle User",
    emailHint: "oracle@example.invalid"
  })
  const optionalitySchema = sdk.SearchInputSchema
  const slotInputSchema = sdk.SlotListingInputSchema
  const schemaCase = (target, value) => ({
    decode: normalizeResultAsEither(decodeUnknown(target, value)),
    encode: normalizeResultAsEither(encodeValue(target, value))
  })
  const requests = {
    cart: toOracleValue(sdk.makeCartViewRequest()),
    category: normalizeResultAsEither(sdk.makeCategoryProductsRequest({ categoryId: "oracle-category", pageSize: 2 })),
    search: normalizeResultAsEither(sdk.makeSearchRequest({ query: "milk", pageSize: 4 })),
    slot: normalizeResultAsEither(
      sdk.makeSlotListingRequest({
        deliveryDestinationId: "oracle-destination",
        regionId: "oracle-region",
        shippingGroupType: "HOME_DELIVERY"
      })
    )
  }
  return {
    codec: {
      authenticated: normalizeResultAsEither(authenticated),
      decodeAuthenticated: normalizeResultAsEither(sdk.decodeSdkSessionSnapshot(resultValue(authenticated))),
      decodeGuest: normalizeResultAsEither(sdk.decodeSdkSessionSnapshot(session.guest)),
      decodeSession: normalizeResultAsEither(sdk.decodeSessionSnapshot(session.session)),
      guestDiagnostic: sdk.redactSdkSessionSnapshot(session.guest),
      invalidSession: normalizeResultAsEither(sdk.decodeSessionSnapshot({ metadata: {} }))
    },
    parsed,
    requests,
    schemaCases: {
      optionalAbsent: schemaCase(optionalitySchema, { query: "milk", pageSize: 4 }),
      optionalUndefined: schemaCase(optionalitySchema, { pageSize: 4, pageToken: undefined, query: "milk" }),
      refinementFailure: normalizeResultAsEither(decodeUnknown(optionalitySchema, { pageSize: 0, query: " milk " })),
      slotDefault: normalizeResultAsEither(
        decodeUnknown(slotInputSchema, {
          deliveryDestinationId: "d",
          regionId: "r",
          shippingGroupType: "HOME_DELIVERY"
        })
      )
    }
  }
}

export const captureOracleCorpus = async ({ supplemental = false } = {}) => {
  const { cli, mcp, platform, sdk, store, testClock, testClockLayer } = await loadBuiltPackages()
  const cartBody = await readFile(join(sdkRoot, "test/fixtures/cart-view-non-empty.json"), "utf8")
  const tools = operationNames(mcp).map((name) => metadataFromTool(mcp.voilaToolkit.tools[name]))
  await validateDraft07(
    Object.fromEntries(
      tools.flatMap((tool) => [
        [`${tool.name}.input`, tool.inputSchema],
        [`${tool.name}.success`, tool.successSchema],
        [`${tool.name}.failure`, tool.failureSchema]
      ])
    )
  )
  const protocol = await protocolSamples(mcp, sdk, cartBody)
  await validateDraft07(wireDraft07Schemas(protocol))
  const corpus = normalizeNondeterministic({
    capture: { builtFrom: "packages/*/dist", capturedAt: "[normalized]", oracleVersion },
    artifacts: await artifactManifest(root),
    cli: await cliSamples(cli),
    mcp: { protocol, tools },
    sdk: await sdkSamples(sdk),
    stdio: await stdioSamples()
  })

  if (!supplemental) return corpus

  const { captureSupplementalCorpus } = await import("./oracle-supplement.mjs")
  return Object.assign(corpus, {
    supplemental: await captureSupplementalCorpus({ cli, effect, mcp, platform, sdk, store, testClock, testClockLayer })
  })
}

export { canonicalJson, toOracleValue }
