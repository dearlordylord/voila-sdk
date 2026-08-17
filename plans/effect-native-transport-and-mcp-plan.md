# Plan: Make the Voila Transport and MCP Server Effect-Native

> Source issue: https://github.com/dearlordylord/voila-sdk/issues/14
> Decisions recorded in the issue (Effect 3.22, `@effect/platform` for HTTP, `@effect/ai` for the MCP server) are settled and are not reopened here. This plan answers the remaining question the issue left open — *what it costs* — and sequences the landing.
>
> **Sequencing note**: the issue suggests expand → migrate → contract so nothing breaks mid-flight. The owner has since called this: the project is greenfield, breaking is allowed, and **no legacy or compatibility code is to be written**. This plan therefore migrates *in place*: every module flips to its final Effect shape directly, and the promise-shaped code is deleted in the same change that replaces it — no twin exports, no deprecation shims, no parallel surfaces. The only temporary mixed state is inside `operations.ts`, whose *existing* `Effect.tryPromise` wrappers shrink batch by batch and are deleted with the last one; nothing new is written to be thrown away.

The store, the session file cycle, and the session port are already Effect. This plan removes the two remaining promise-shaped layers — the SDK's transport and operations below, the MCP edge above — so the only promise crossing left in the workspace is the outermost CLI entry point, whose contract is promise-shaped by nature.

## Research Findings: `@effect/ai` MCP Server (verified against `@effect/ai@0.37.0`, published 2026-07-13)

Verified against the published npm tarball and the Effect-TS/effect repository. Peer dependencies: `effect ^3.22.0`, `@effect/platform ^0.97.0`, `@effect/rpc ^0.76.0`, `@effect/experimental ^0.61.0` — matches the workspace's Effect 3.22 exactly.

- **No `@modelcontextprotocol/*` anywhere.** The server is built on `@effect/rpc`; the only runtime dependency is `find-my-way-ts`. Dropping the official SDK packages is satisfied by design.
- **Tools**: `Tool.make(name, { description, parameters, success, failure, failureMode })` from `@effect/ai/Tool`, where `parameters` is a `Schema.Struct` fields object and `success`/`failure` are Effect Schemas. Grouped with `Toolkit.make(...)`; handlers attached via `toolkit.of(handlers)` producing a Layer. Annotations are Context references: `.annotate(Tool.Title, ...)`, `Tool.Readonly`, `Tool.Destructive`, `Tool.Idempotent`, `Tool.OpenWorld`.
  - **Gotcha**: the annotation defaults follow MCP conventions — `Destructive` defaults to `true`, `OpenWorld` to `true` — and all four hints are *always* emitted on `tools/list`. Every Voila tool must annotate all four hints explicitly, or read-only tools will be advertised as destructive.
- **Server**: `McpServer.layerStdio({ name, version, stdin, stdout })` (NDJSON-RPC over stdio) and `McpServer.layerHttp({ name, version, path })` (JSON-RPC POST route mounted on `@effect/platform`'s `HttpRouter`; serve with `@effect/platform-node`'s `NodeHttpServer`). Register tools with `McpServer.toolkit(layer)` / `registerToolkit`.
- **Error mapping**: a handler's typed failure channel becomes `CallToolResult { isError: true, content: [{ type: "text", text: JSON.stringify(error) }], structuredContent: error }` — not a protocol error. This preserves the current failure-as-tool-result contract if the failure schema is the redacted failure result.
- **Protocol revisions**: latest is **2025-06-18**; supported list is `["2025-06-18", "2025-03-26", "2024-11-05", "2024-10-07"]`. Initialize negotiates: echoes the client's version if supported, otherwise replies with the latest. Our current tests request `2025-11-25` (served by the official SDK v2 packages) — the negotiated version will become `2025-06-18`. See Contract Deltas below.
- **Known gaps**: no `outputSchema` advertisement on `tools/list` (we don't advertise one today — no loss); HTTP mode keeps session state in an in-memory `Map` (Effect-TS/effect#6752 — matches our current per-session in-memory map, so no regression); no SSE GET stream on HTTP (we run `enableJsonResponse: true` today — no regression); the 3.x `@effect/ai` line is stable but its API is being folded into Effect 4 as `effect/unstable/ai` — record this in the ADR as accepted upgrade risk.
- **References**: [McpServer.ts](https://github.com/Effect-TS/effect/blob/%40effect%2Fai%400.37.0/packages/ai/ai/src/McpServer.ts), [Tool.ts](https://github.com/Effect-TS/effect/blob/%40effect%2Fai%400.37.0/packages/ai/ai/src/Tool.ts), [Toolkit.ts](https://github.com/Effect-TS/effect/blob/%40effect%2Fai%400.37.0/packages/ai/ai/src/Toolkit.ts), [API docs](https://effect-ts.github.io/effect/docs/ai/ai), [tim-smart/effect-mcp](https://github.com/tim-smart/effect-mcp) (working example, on Effect 4 — read for shape, not for imports).

## Contract Deltas the Implementer Must Land (test adaptations with justification)

The acceptance criteria require every tool still served, over stdio and HTTP, with annotations intact — covered by the protocol tests. Three pinned behaviors in `packages/voila-mcp/test/mcp-server.test.ts` belong to the *old library*, not to our contract, and change with the swap:

1. **"Input validation error" message** (`mcp-server.test.ts:203`). Produced by the official SDK's validation layer. `@effect/ai` surfaces parameter decode failures differently. Adapt the assertion to the new library's message, keeping the intent: HTTP 200, `result.isError: true`, no session/transport touched. If `@effect/ai` instead answers with a JSON-RPC protocol error for undeodable params, keep the test at whichever layer rejects the input and note the behavior in the ADR. **Resolved by Milestone 0.**
2. **Protocol version negotiation** (`mcp-server.test.ts:8,47,87`). Tests request `2025-11-25` and send it as the `mcp-protocol-version` header on subsequent calls. Under `@effect/ai` the server negotiates down to `2025-06-18`. The test client must read the negotiated version from the initialize response and echo *that* in later headers — this is what real clients do, so the test becomes more faithful, not less. **Spike must confirm the server tolerates a mismatched header or the test must use the negotiated value.**
3. **JSON Schema shape of `inputSchema`** (`mcp-server.test.ts:156-171`). Pins `$schema: 2020-12`, `additionalProperties: false`, integer bounds, and `properties: {}` for the empty-input tool. `@effect/ai` generates `inputSchema` from the tool's parameters schema via Effect's `JSONSchema` — the exact emitted shape (draft marker, `additionalProperties`, empty-struct rendering) must be confirmed by the spike. If it differs in ways that don't change what clients can send (e.g. missing `$schema` marker), adapt the pin; if it differs in ways that do (e.g. missing `additionalProperties: false` or lost bounds), that's a real gap — escalate before proceeding (it shapes sequencing, not the decision, per the issue).

Everything else in the protocol tests — tool names, annotations, `/health`, per-session isolation, failure-as-result — is our contract and must survive unchanged.

## Architectural Decisions

These apply to every milestone below.

- **The transport becomes an Effect port in the SDK, replacing the promise interface outright.** `VoilaTransport` (`packages/voila-sdk/src/voila/http-client.ts:31-33`) is redefined from a promise-of-either interface to a `Context.Tag` whose service is `request: (request: VoilaTransportRequest) => Effect.Effect<VoilaTransportResponse, VoilaTransportError>`. The SDK gains no new runtime dependency: it stays a pure port plus pipeline, consuming the transport from the environment. House DI rules (no mocks) mean tests provide stub layers via `Layer.succeed`. The old interface is deleted in the same PR; all call sites flip with it.
- **Transport failures are typed, small, and redacted by construction.** New `VoilaTransportError` union, plain tagged literals in the existing SDK style (no `Data.TaggedError` classes — match surrounding code):
  - `VoilaRequestDeadlineExceeded` — the request was abandoned at its deadline. Carries `timeoutMs`, never the URL, cookies, or token.
  - `VoilaConnectionFailure` — the request never got a response (refused, DNS, reset). Static message.
  - `VoilaResponseReadFailure` — the response body could not be read (a stalled body fails here, exactly as today where `response.text()` sits inside the same guarded region, `node-env.ts:214`).
  Deadline-exceeded is distinguishable from connection-refused in tool output and CLI output because they are different `_tag`s flowing through the existing `redactError` (`operations.ts:140-150`), which already whitelists `_tag`/`message`/`status`.
- **`VoilaNetworkFailure` and `GuestBootstrapNetworkFailure` are deleted, not renamed.** They exist only as the collapse of the untyped either (`http-client.ts:92-95`, `guest-bootstrap.ts:139-149`). The new pipeline raises the typed transport tags instead — either by adding them to the `VoilaSdkError` union (preferred; keeps per-op error types shaped as they are) or by widening each operation's error channel to `VoilaSdkError | VoilaTransportError`. `redactError`'s collapse-to-`VoilaOperationFailed` behavior stays as the last line of defense for genuinely unknown throws.
- **The node transport implementation stays in `packages/voila-mcp`, and the fetch implementation is deleted when it lands.** Today the fetch implementation lives in `node-env.ts:191-222`; its Effect-native replacement takes its place, built on `@effect/platform`'s `HttpClient` (`@effect/platform-node`'s `NodeHttpClient`). The SDK remains platform-agnostic. `HttpClient` failure values (`RequestError`/`ResponseError`) are mapped to the `VoilaTransportError` tags above without interpolating the cause.
- **The deadline is an `Effect.timeoutFail` on the request effect, driven by the Effect Clock.** `RequestDeadlinePort`/`timeoutDeadline` (`node-env.ts:184-189`) are deleted in the same PR that lands the Effect transport; `defaultRequestTimeoutMs` survives as plain transport configuration. Because `@effect/platform`'s clients wire interruption to request cancellation, an Effect-level timeout both interrupts the waiting fiber *and* aborts the underlying request — the issue's cancellation requirement comes for free, and tests drive it with `TestClock` instead of the controlled-`AbortController` stubs in `node-env.test.ts:40-67` (those stubs are deleted with the port).
- **The request pipeline flips directly.** `requestVoilaJson` (`http-client.ts:177-243`) becomes `Effect<VoilaJsonResult<A>, VoilaSdkError, VoilaTransport>` in Milestone 1, before any operation migrates. The CSRF check, same-origin check, cookie-jar restore, status classification, Set-Cookie fold-back, and JSON/schema decode keep their exact order and error tags; the `Either` threading becomes the Effect error channel. No parallel promise pipeline is kept.
- **Operations flip to `Effect`, in place, in batches.** Each SDK operation becomes `(session, input) => Effect.Effect<VoilaJsonResult<A>, OpError, VoilaTransport>` in its assigned batch, and `operations.ts` is updated in the same PR to compose the flipped operations directly. Operations not yet migrated keep working through the `Effect.tryPromise` wrapper that *already exists* at `operations.ts:223` — that wrapper set shrinks batch to batch and is deleted with the last batch. No new compatibility code is written at any point.
- **The session cycle is untouched.** `OperationSessionPort.withSession` and `updateSessionFileCarrying` are already Effect and already run the network call inside the guarded window (ADR-0002: the Set-Cookie fold-back is why). Effect-native operations compose directly inside `withSession`; serialization of concurrent tool calls on one session path is preserved.
- **The MCP server becomes a `Toolkit` over the existing schemas.** Tool parameters come from `operation-schemas.ts` as-is (they are already the source of truth); titles/descriptions come from `operation-descriptors.ts` as-is; annotations are the two existing constant sets (`mcp-server.ts:30-41`) expressed as `Tool.Readonly`/`Tool.Destructive`/`Tool.Idempotent`/`Tool.OpenWorld` annotations. Handlers return `Effect<SuccessResult, FailureResult>` where the failure is the existing redacted failure-result shape, so `@effect/ai`'s failure mapping reproduces today's `{ content: [{ type: "text", text: <pretty JSON> }], isError }` contract.
- **The HTTP edge is an `HttpRouter` app.** `McpServer.layerHttp` mounted at the configured path, plus explicit routes reproducing `GET /` and `GET /health` (`mcp-http-server.ts:91-95`) and the 404 fallthrough, served by `NodeHttpServer`. Session state stays in-memory per `@effect/ai`'s own map — the hand-rolled session map, initialize sniffing, and `mcp-session-id` routing in `mcp-http-server.ts` are deleted, not ported.
- **`bin.ts` runs on the Effect runtime.** The MCP entry composes layers and uses `NodeRuntime.runMain` (or `Layer.launch`); SIGINT/SIGTERM shutdown comes for free from the runtime. No `runPromise` in the MCP package. The CLI's `bin.ts`/`ports.ts` keeps exactly one `Effect.runPromise` at its outermost edge (`ports.ts:12-26` becomes the single crossing).
- **Playwright stays promise-shaped at its boundary.** `BrowserLoginPort.captureSession` wraps an external promise-shaped library; it is wrapped once in `Effect.tryPromise` with a typed catch. This is a legitimate surviving boundary, like the CLI entry.

## Global Acceptance Gate

Every landed step, not only the last:

- `pnpm check-all` passes (build, package boundaries, typecheck incl. `effect-tsgo --strict`, circular, complexity, lint incl. jscpd 2%, fixture audit, harness tests, 99% coverage on covered packages).
- No test mocks, no type casts, no ambient clock reads (the `voila/no-test-mocks`, `voila/no-type-assertion`, `voila/no-clock-read` oxlint rules keep this honest); time-dependent code takes the Effect Clock.
- `packages/voila-sdk/src/**` carries the 99% coverage burden (voila-mcp/voila-cli src are excluded) — every SDK batch lands with its tests rewritten in the same PR.
- `max-lines` (420, non-test files) is an architecture signal: split along module boundaries (`mcp-toolkit.ts` vs `mcp-server.ts` vs `mcp-http-server.ts`), never compress.
- No secrets in errors, logs, fixtures, or tool output; new error tags use static messages.
- **No legacy**: no deleted name survives in any file, export, or test after its milestone lands. Verify by grep, not memory.
- Version bumps and doc updates land in the final milestone, before `pnpm release:publish`.

## Milestone 0: Verification Spike — Pin Down `@effect/ai` Behavior

Timeboxed, throwaway code (a script under `scripts/` or a scratch branch; nothing merges). Resolves every Contract Delta above before any production file moves.

**Input**
- This plan's Research Findings and Contract Deltas.
- `@effect/ai@0.37.0` source, already verified against the tarball.

**Output**
- A findings note appended to this plan (or `docs/adr/` scratch) answering, with reproduced output:
  1. The exact `tools/list` `inputSchema` `@effect/ai` emits for `ProductListOperationInputSchema` (does it carry `$schema`, `additionalProperties: false`, `maximum: 24`?) and for an empty-parameters tool (does it render `properties: {}`?). Effect's `JSONSchema.make` default target vs explicit `target: "jsonSchema2020-12"` matters here — check what `@effect/ai` uses internally.
  2. What a schema-violating `tools/call` returns: tool result with `isError: true`, or JSON-RPC protocol error? What message?
  3. Initialize with `protocolVersion: "2025-11-25"`: negotiated response version, and whether post-initialize requests bearing a mismatched `mcp-protocol-version` header are accepted or rejected.
  4. `tools/call` with `arguments` omitted entirely for a parameterless tool: accepted?
  5. Interruption: does interrupting a fiber awaiting an `@effect/platform` `HttpClient` request abort the underlying socket? (Confirm with a hanging local server and an aborted-signal assertion.)
  6. Stdio testability: can a test drive `layerStdio` with in-process streams, or does `@effect/ai` ship a client usable in tests, or do we spawn `tsx src/bin.ts` as a child process? Pick the approach for Milestone 4's stdio protocol test.

**Expected artifacts**
- Findings appended to this plan; Contract Deltas updated from "risk" to "fact".

**Verification**
- Every numbered question has a reproduced, written answer. Where an answer contradicts a protocol-test pin, the planned test adaptation is written down.

---

## Milestone 1: Transport and Pipeline, Effect-Native

One PR-sized step that replaces the transport contract, the pipeline, and the node implementation together — the operation layer keeps compiling because its existing `Effect.tryPromise` wrapping absorbs the new Effect-shaped calls until Milestones 2–3 remove it.

### Issue 1.1: `VoilaTransportError` and the Effect transport port

**Input**
- `packages/voila-sdk/src/voila/http-client.ts` (current `VoilaTransport`, `VoilaTransportRequest/Response`).
- Architectural Decisions above.

**Output**
- New module `packages/voila-sdk/src/voila/transport-error.ts`: the `VoilaTransportError` union (`VoilaRequestDeadlineExceeded`, `VoilaConnectionFailure`, `VoilaResponseReadFailure`), static messages, schema-derived if serialized anywhere.
- `VoilaTransport` redefined as a `Context.Tag` (new module, e.g. `transport.ts`) with `request` returning `Effect<VoilaTransportResponse, VoilaTransportError>`. The promise interface is deleted, not kept.
- Exported from `src/index.ts`.

**Expected artifacts**
- `packages/voila-sdk/src/voila/transport-error.ts`, `packages/voila-sdk/src/voila/transport.ts` (names may follow house convention), index exports; the old interface and its tests gone.
- Unit tests: error union shape, redaction (no URL/header material in any variant), tag service round-trip with a stub layer.

**Verification**
- Tests prove each error variant carries no request URL, cookie, or token material.
- Grep proves the promise-shaped `VoilaTransport` is gone.
- `pnpm check-all` passes.

### Issue 1.2: `requestVoilaJson` flips to Effect

**Input**
- `http-client.ts:177-243` (`requestVoilaJson`), the `VoilaSdkError` union (`:50-59`), header/cookie helpers (`:133-151`), blocked-response detection (`:133-141`).
- Issue 1.1.

**Output**
- `requestVoilaJson(schema, session, request, cookieJarPort?)`: `Effect<VoilaJsonResult<A>, VoilaSdkError, VoilaTransport>` — same steps in the same order. CSRF/origin/jar/decode failures enter the Effect error channel with their existing tags; transport failures arrive already typed from the port and flow through without collapsing. `VoilaNetworkFailure` is deleted from the union here; per-op error types keep their shape via the union extension (see Architectural Decisions).
- Every operation in `voila-sdk` still calls `requestVoilaJson`, so this PR also flips the *internal* call style of operations (they can return the Effect directly even before their public signatures are re-typed in Milestone 2 — or Milestone 2's signature flip rides along here if the diff stays reviewable; implementer's call, one rule: no promise surface left behind).

**Expected artifacts**
- `http-client.ts` rewritten; `test/voila/http-client.test.ts` (456 lines of stub-transport cases) rewritten against the Effect pipeline using `@effect/vitest` (`it.effect`, `Layer.succeed` stub transports) — headers, set-cookie folding, blocked/unauthorized/non-2xx classification, malformed JSON, schema mismatch, and each typed transport failure.

**Verification**
- Every behavioral assertion that existed for the promise pipeline exists for the Effect pipeline; typed transport failures surface with their own tags.
- Coverage stays ≥99% on the SDK. `pnpm check-all` passes.

### Issue 1.3: Effect-native node transport with Clock-driven deadline; deadline port deleted

**Input**
- `packages/voila-mcp/src/node-env.ts:168-232` (deadline port, fetch transport), `test/node-env.test.ts`, `test/session-port.test.ts:124-141` (controlled-deadline stubs).
- `@effect/platform`, `@effect/platform-node` added as voila-mcp dependencies (the issue notes #15 removed them unused from the CLI; here they are added where actually used).

**Output**
- `makeEffectVoilaTransport(config, httpClient?)` in `node-env.ts` (or a new `node-transport.ts` if `node-env.ts` approaches the line limit): builds the `VoilaTransport` tag's implementation on `HttpClient`, maps `RequestError`/`ResponseError` to `VoilaConnectionFailure`/`VoilaResponseReadFailure` with static messages, and applies `Effect.timeoutFail({ duration: config timeout (default `defaultRequestTimeoutMs`), onTimeout: () => VoilaRequestDeadlineExceeded })`.
- User-Agent and request-identity headers carried over exactly (see `test/live/request-identity.smoke.ts` for the pinned header set).
- Deleted in the same PR: `makeFetchVoilaTransport`, `fetchVoilaTransport`, `RequestDeadlinePort`, `timeoutDeadline`, and their controlled-deadline test stubs.

**Expected artifacts**
- New transport module + tests in `packages/voila-mcp/test/`: a hanging stub request cancelled by `Effect.timeout` under `TestClock` (no wall-clock), an aborted-underlying-request assertion (canceler-set flag), deadline vs connection-refused tag distinguishability.
- `test/live/request-identity.smoke.ts` updated to the Effect transport.

**Verification**
- Tests prove: `TestClock.adjust` past the deadline fails the request with `VoilaRequestDeadlineExceeded`; the underlying request's canceler ran; a simulated refused connection fails with `VoilaConnectionFailure`; neither error contains URL, cookie, or token material.
- Grep proves `RequestDeadlinePort`, `timeoutDeadline`, and `makeFetchVoilaTransport` are gone everywhere.
- `pnpm check-all` passes.

---

## Milestone 2: SDK Operations, Batch by Batch

Each batch flips its operations to the final Effect signature `(session, input) => Effect<Result, OpError, VoilaTransport>`, rewrites their tests with `@effect/vitest`, and updates `operations.ts` in the same PR to compose the flipped operations directly. The pre-existing `Effect.tryPromise` wrappers around not-yet-flipped operations shrink batch to batch; no wrapper is added, and none survives the last batch. Batch boundaries follow the existing module families; order is lowest-blast-radius first.

### Issue 2.1: Catalog reads

`searchProducts` (`catalog-search.ts:73`), `getCategoryProducts` (`category-products.ts:61`), `getDiscountedProducts` (`discounted-products.ts:278`).

### Issue 2.2: Cart

`getCart` (`cart-view.ts:90`), `applyCartDeltas` / `addCartItems` / `removeCartItems` (`cart-mutation.ts:73,127,135`). Cart-write rules from AGENTS.md are unchanged: UUIDs, quantity deltas, `limitedItems`/`unavailableData`/pricing notices surfaced.

### Issue 2.3: Delivery context and slots

`getDeliveryDestinations`, `getDeliveryDestination` (`delivery-destinations.ts:118,144`), all of `shopping-context.ts` (`:186,212,238,264,279,319`), `getSlotListings`, `reserveSlot` (`slots.ts:225,251`). The confirmation-literal input contracts (`confirmSlotReservation: Schema.Literal(true)` etc.) are untouched.

### Issue 2.4: Checkout review and order history

`getCheckoutSummary` (`checkout-summary.ts:129`), `getCompletedOrders` (`order-history.ts:115` — its extra `CompletedOrdersGraphqlError`/`CompletedOrdersUnavailable` tags survive), `getOrderDetails`, `getCompletedOrderItems` (`order-details.ts:312,349`).

### Issue 2.5: Session-adjacent operations

`bootstrapGuestSession` (`guest-bootstrap.ts:135` — its private try/catch collapse at `:139-149` is replaced by the typed transport errors; `GuestBootstrapNetworkFailure` is deleted), `checkSessionHealth` (`session-health.ts:234` — internal result-union protocol preserved), `loginWithBrowser` (`browser-login.ts:97` — `BrowserLoginPort` stays promise-shaped, wrapped once in `Effect.tryPromise` with typed catch), `loadSdkSessionSnapshot` / `SessionStoragePort` (`session-storage.ts:15-33` — port becomes Effect-shaped).

**Input (all batches)**
- Milestone 1; per-file test suites in `packages/voila-sdk/test/voila/`.

**Output (each batch)**
- The listed operations return `Effect` with unchanged success values and error tags (minus the deleted collapse tags); their tests rewritten against stub transport layers; `operations.ts` dispatch composing them natively.

**Expected artifacts (each batch)**
- The listed source files, their tests, `operations.ts` dispatch updates. No compatibility exports, no deprecation comments.

**Verification (each batch)**
- Existing per-op test assertions all pass against the Effect signature; no `tryPromise` wrapper remains around a flipped operation in `operations.ts`.
- `pnpm check-all` passes.

---

## Milestone 3: Operation Layer and CLI

### Issue 3.1: Effect-native operation layer

**Input**
- `packages/voila-mcp/src/operations.ts` — `runSessionEffect` (`:181-189`, the crossing ADR-0003 marks for removal), `runSessionOperation` (`:223`), health path (`:241`), `redactError` (`:140-150`), result constructors (`:121-130`), `updateSdkSession` (`:155-164`).
- Milestone 2 complete (every operation Effect-shaped; the last `tryPromise` wrappers deleted with batch 2.5).

**Output**
- `runVoilaOperation(name, input, env)` returns `Effect<OperationExecutionSuccess, OperationExecutionFailure>` (the `ok: true/false` halves of today's `OperationExecutionResult`, so the CLI can still union them and the MCP toolkit can use the failure channel). `runSessionEffect` is deleted. Input parsing, authGuidance attachment, redaction, and session fold-back are unchanged in behavior.
- `OperationEnvironment` becomes Layer-expressible: the session port stays as-is; the transport enters as the `VoilaTransport` tag. `node-env.ts` constructs both as layers.
- CLI: `ports.ts` `runNodeOperation` runs the returned Effect with the workspace's one sanctioned `Effect.runPromise(Effect.either(...))` at the entry edge and unions the either back into `OperationExecutionResult`; `cli.ts` is untouched.

**Expected artifacts**
- `operations.ts`, `node-env.ts`, `sdk-operation-inputs.ts` (only if signatures demand), `packages/voila-cli/src/ports.ts`; `operations.test.ts`, `order-operations.test.ts`, `session-port.test.ts` migrated to `@effect/vitest`.

**Verification**
- Grep proves no `runPromise`/`tryPromise` remains in `packages/voila-mcp/src` except inside the browser-login boundary; the only `runPromise` in the workspace's operation path is `packages/voila-cli/src/ports.ts` (plus the pre-existing CLI auth-login sites, which stay).
- Registry assertions (`operations.test.ts:204-234`), redaction tests (`:542-580`), and authGuidance tests pass unchanged in intent.
- `pnpm check-all` passes.

### Issue 3.2: Cancellation test, clock-driven

**Input**
- Existing pattern: `session-port.test.ts:205-226` ("releases the session lock when an operation's request is abandoned") and the lock-ensuring tests `cas-file-store/test/state-file-locks.test.ts:111-126`.
- Issues 1.3, 3.1.

**Output**
- The lock-release test re-expressed: a stub transport whose request effect hangs in `Effect.async` with a canceler that records interruption; the operation run under the transport's Effect timeout; `TestClock.adjust` fires the deadline; assertions: failure tag is `VoilaRequestDeadlineExceeded`, the canceler ran (the *request* was cancelled, not only the fiber), the session-file lock is released, and a follow-up `withSession` proceeds immediately. No wall-clock waits anywhere.

**Verification**
- The test fails if the canceler is not wired (e.g. if implemented with `Effect.promise` instead of `Effect.async`), proving it tests request cancellation rather than fiber abandonment.
- `pnpm check-all` passes.

---

## Milestone 4: MCP Server Swap to `@effect/ai`

### Issue 4.1: Toolkit and server layers

**Input**
- Milestone 0 findings (Contract Deltas resolved); Milestone 3.
- `mcp-server.ts` (13 `registerTool` blocks, annotation constants `:30-41`, `stringifyResult`/`makeToolResult` `:54-59`), `operation-descriptors.ts`, `operation-schemas.ts`, `mcp-http-server.ts`, `bin.ts`.
- New dependencies on voila-mcp: `@effect/ai`, `@effect/platform`, `@effect/platform-node` (already added in 1.3), plus peers `@effect/rpc`, `@effect/experimental` if pnpm doesn't hoist them.

**Output**
- New `mcp-toolkit.ts`: one `Tool.make` per descriptor, parameters from `operation-schemas.ts`, all four annotations explicit on every tool (read-only set: `Readonly true, Destructive false, Idempotent true, OpenWorld true`; mutation set: the inverse for `voila_reserve_slot`, `voila_add_cart_items`, `voila_remove_cart_items`), titles via `Tool.Title`, descriptions verbatim from the registry. Handlers call the Milestone-3 `runVoilaOperation`; the failure schema is the redacted failure-result shape so `isError` and the text content match today's contract. Success/failure values keep the 2-space-indented JSON text form if the spike shows clients/tests care; otherwise rely on `@effect/ai`'s `JSON.stringify` and keep tests substring-based.
- `mcp-server.ts` rewritten: layer composition — `McpServer.toolkit(toolkitLayer)` provided with the operation environment layer, `McpServer.layerStdio({ name: mcpName, version })` for stdio. `mcpName` (`io.github.dearlordylord/voila-mcp`) and `PKG_VERSION` injection are preserved. The old `createVoilaMcpServer`/`startStdioServer` exports are replaced, not kept — voila-mcp's own surface breaks with the major-style version bump, and the CLI does not consume those exports.
- `mcp-http-server.ts` rewritten: `HttpRouter` with `McpServer.layerHttp` at the configured path, explicit `GET /` and `GET /health` routes reproducing today's JSON (`{ name: mcpName, status: "ok" }`), 404 fallthrough; served via `NodeHttpServer.layer` on the configured host/port. Same env-var config surface (`MCP_TRANSPORT`, `MCP_HTTP_HOST`, `MCP_HTTP_PATH`, `MCP_HTTP_PORT`/`PORT`, defaults unchanged).
- `bin.ts` rewritten on `NodeRuntime.runMain`; signal handling from the runtime.
- Deleted in the same PR: `mcp-input-schema.ts` (the JSON Schema bridge), the hand-rolled session map and `mcp-session-id` routing, and `@modelcontextprotocol/node` + `@modelcontextprotocol/server` from `package.json` (and with them, transitively, `hono`).

**Expected artifacts**
- The three rewritten/new source files, updated `bin.ts`, `package.json` dependency swap.
- `mcp-server.test.ts` updated per the Milestone-0-resolved Contract Deltas (validation message, negotiated protocol version echoed by the test client, JSON Schema pins confirmed or adjusted) — and extended with a **stdio protocol test** using the approach chosen in Milestone 0, asserting the same 13 tool names and both annotation sets over stdio.

**Verification**
- Protocol tests prove all 13 tools listed over HTTP *and* stdio, with annotations intact and per-session isolation preserved; `/health` answers as today.
- Grep proves `@modelcontextprotocol` appears in no `package.json`, import, or lockfile entry.
- `pnpm smoke:request-identity` and a manual stdio handshake against a guest session pass.
- `pnpm check-all` passes.

---

## Milestone 5: Document and Version

### Issue 5.1: Docs for the broken surface

**Input**
- Milestones 1–4 complete; the promise surface is already gone (verify by grep, not memory).

**Output**
- `docs/public-api.md` rewritten for the Effect surface (every operation signature, the transport tag, the error taxonomy).
- Usage examples in `packages/voila-sdk/README.md` and `packages/voila-mcp/README.md` updated to Effect.
- `docs/mcp-readiness.md` refreshed (its tool list is already stale at 9 of 13 — fix while there).

**Verification**
- Every signature in `docs/public-api.md` matches the shipped types; `pnpm check-all` passes.

### Issue 5.2: ADR and versioning

**Input**
- `docs/adr/0003-single-session-path-and-in-memory-guest.md:12` (the "crossing confined to `runSessionEffect` and marked for removal" sentence), ADR-0001/0002 for format.
- Milestone 0 findings (for the accepted-risk record).

**Output**
- New `docs/adr/0004-effect-native-transport-and-mcp.md`: decision taken (Effect transport port, typed transport failures, `@effect/ai` server, Clock-driven deadlines), the protocol-delta adaptations from Milestone 0 with justification, and the accepted risk that `@effect/ai` 0.x migrates to `effect/unstable/ai` in Effect 4.
- ADR-0003's consequences paragraph edited so the crossing note no longer describes the code (the crossing is gone, not "marked for removal").
- Version bumps per AGENTS.md publish rules (0.x breaking → minor): `@firfi/voila-sdk` → 0.2.0, `@firfi/voila-mcp` → 0.2.0, `@firfi/voila-cli` → 0.2.0 (its ports signature changes). Keep `server.json` ↔ voila-mcp name/version in sync (`verify-registry-metadata` enforces this).

**Verification**
- `pnpm check-all` and `pnpm package:audit` pass; `release:check` is green so the user's one-command publish path (`pnpm release:publish`) is all that remains.

---

## Acceptance-Criteria Traceability

| Issue #14 criterion | Landed by |
|---|---|
| Transport and operations expose Effect, typed failures | 1.1–1.3, 2.1–2.5 |
| MCP server is `@effect/ai`'s, no JSON Schema bridge | 4.1 (bridge deleted) |
| Every tool still served over stdio and HTTP, annotations intact | 4.1 + extended protocol tests |
| Only `runPromise` at the outermost CLI entry | 3.1 |
| Deadline failure tag distinguishable from refused connection, no secrets | 1.1, 1.3 (+ redaction tests) |
| Effect timeout cancels the request; lock released; clock-driven test | 1.3, 3.2 |
| Deadline port from #13 gone | 1.3 |
| `@modelcontextprotocol/*` not a dependency | 4.1 (grep-verified) |
| Public API doc, examples, versioning | 5.1, 5.2 |
| ADR recorded; ADR-0003 note updated | 5.2 |
| `pnpm check-all` green at each landed step | Global Acceptance Gate |

## Risks and Watch-Items

- **JSON Schema emission** is the highest-severity unknown (Milestone 0, question 1). If `@effect/ai` cannot emit the pinned 2020-12 shape with `additionalProperties: false`, the options are adapting the protocol pin (preferred if client-visible behavior is unchanged) or a thin post-processing layer on `tools/list` output — escalate to the issue before building the latter.
- **Parameter-decode failure shape** (Milestone 0, question 2) may move from tool-result to protocol error; either is defensible, but the choice is recorded in ADR-0004.
- **`@effect/ai` is 0.x** and its API is moving to Effect 4's `effect/unstable/ai`. Pin the exact version; record the upgrade path in ADR-0004.
- **jscpd 2%**: 13 similar `Tool.make` blocks may approach the duplication threshold the same way today's 13 `registerTool` blocks do not (they pass today). If jscpd trips, factor the annotation sets and handler plumbing, not the per-tool schema wiring.
- **`effect-tsgo --strict`** may surface inference friction in heterogeneous toolkit/handler types; budget time in 4.1.
- **Do not** let the HTTP rewrite drop the `/health` endpoint or change default host/port/path — deployment guidance (`glama.json`, README) depends on them.
