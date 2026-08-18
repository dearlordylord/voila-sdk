# Effect 4 migration ledger

Issue: [#19](https://github.com/dearlordylord/voila-sdk/issues/19)
Historical cohort: `effect@3.22.1`
Target cohort: `4.0.0-rc.110`

This ledger records the controlled-red migration inventory and the exact source
for constructed replacements. It is evidence, not a compatibility layer.

## Pre-cutover checkpoint

| Evidence | Result |
| --- | --- |
| `pnpm setup:effect-references` | pass; created the three exact pinned repositories through staged clones |
| `pnpm verify:effect-references` | pass; origins, commits, tags, clean state, versions, and migration documents verified |
| `pnpm check-all` on Effect 3 | pass; 500 tests, 99.81% statements, 99.41% branches, 99.80% functions, 99.86% lines |

The immutable behavioral oracle is captured before dependency cutover and is
never regenerated to accommodate Effect 4 output.

## Lookup decisions

| Effect 3 surface | RC.110 replacement | Authority |
| --- | --- | --- |
| `@effect/ai/{McpServer,Tool,Toolkit}` | `effect/unstable/ai` barrel | generated import map, lines 96, 102-103 |
| `@effect/platform/*` generic HTTP modules | `effect/unstable/http` barrel/modules | generated import map, including lines 131-134 |
| `McpServer.layerHttp` / `layerStdio` | same names plus an explicit non-empty `McpProtocol` adapters array | generated symbol map, lines 4943-4949, and exact RC.110 declarations |
| Effect 3 stateless MCP HTTP route | one centralized stateless HTTP compatibility adapter over RC.110 `McpSchema` and the shared tool registry | Effect 3 `McpServer.layerHttp` is stateless, while RC.110 `layerHttp` requires session ids after initialization; the adapter retains stateless clients, all baseline MCP handlers and version negotiation, HTTP/origin/media behavior, and adopts RC.110's explicit 2025-06-18 batch rejection |
| `Context.Tag(id)<Self, Shape>()` | `Context.Service<Self, Shape>()(id)` | `migration/services.md` |
| `Effect.catchAll` / `catchAllCause` / `catchAllDefect` | `Effect.catch` / `catchCause` / `catchDefect` | `migration/error-handling.md` |
| `Effect.fork` | `Effect.forkChild` | `migration/forking.md` |
| `Effect.iterate` | explicit stateful sequential loop inside `Effect.gen`; no public direct replacement | generated symbol map, line 9717, and `migration/annotations/effect__Effect.yaml` |
| `Effect.timeoutFail` | `Effect.timeoutOrElse` with an `Effect.fail` fallback | generated symbol map, lines 9837-9839 |
| `Effect.unsafeMakeSemaphore` | `Semaphore.makeUnsafe` | generated symbol map, line 9861 |
| `Either` for pure parse/data results | `Result` | issue #19 and RC.110 Schema/Result declarations |
| `Schema.decodeUnknownEither` / `encodeEither` | pure `decodeUnknownResult` / `encodeResult`; `Exit` only where Cause is required | issue #19 and exact RC.110 Schema declarations |
| variadic `Schema.Literal`, `Union`, `Tuple`, `TemplateLiteral` | array-based `Literals`, `Union`, `Tuple`, `TemplateLiteral` | `migration/schema.md` |
| `Schema.Record({ key, value })` | `Schema.Record(key, value)` | `migration/schema.md` |
| `Schema.extend` | `mapFields(Struct.assign(...))` or `fieldsAssign` | `migration/schema.md` |
| `Schema.optionalWith` | deliberate `optionalKey`, `optional`, or decoding-default codec chosen per old contract | `migration/schema.md` optionality decision tree |
| v3 checks such as `finite`, `minLength`, `positive` | `.check(Schema.isFinite())`, `.check(Schema.isMinLength(...))`, `.check(Schema.isGreaterThan(0))` | generated map and `migration/schema.md` |
| recursive v3 `Cause` inspection | flat `cause.reasons` and reason guards | `migration/cause.md` |
| `Scope.extend` | `Scope.provide` | `migration/scope.md` |
| `NodeHttpClient.layer` | `NodeHttpClient.layerNodeHttp`; retain the node:http/node:https backend rather than intentionally switching to Undici | generated symbol map, line 6265, and `migration/annotations/effect__platform-node__NodeHttpClient.yaml` |
| stdio server EOF | launch `McpServer.layerStdio` in an owned child fiber, await its `Exit`, and treat its documented interruption-only EOF shutdown as success; process signals still interrupt the parent runtime | exact RC.110 `RpcServer.makeProtocolStdio` source and clean pnpm/npm consumer process smoke |

Add each non-mechanical or behavior-sensitive replacement here as it is used.

## Controlled-red inventory

The exact RC.110 manifests and lockfile were installed before this inventory.
The current Node 20 host correctly reports an engine warning because the target
policy begins at Node 22.22.2; supported-matrix evidence is collected with the
exact Node 22 and 24 runtimes instead.

| Gate | Initial post-cutover result |
| --- | --- |
| SDK TypeScript | controlled red: 1,072 diagnostics across schema constructors/checks, `Either`, schema generic shapes, service tags, and dependent tests |
| Workspace TypeScript | stopped at the SDK, the first dependency package, so MCP/CLI were not yet measured against stale SDK declarations |
| Build | blocked by the same SDK compilation inventory |
| Effect diagnostics | blocked on TypeScript migration; no diagnostic suppression added |
| Tests | blocked on TypeScript transformation/import failures; no test or threshold changes made |
| Lint/format/duplication | source migration not yet complete; unchanged gates retained |
| Package audit and clean consumers | blocked until build artifacts can be regenerated |

The SDK's initial diagnostic distribution was: TS18046 158, TS2305 2,
TS2314 7, TS2322 14, TS2339 98, TS2345 87, TS2366 1, TS2375 10,
TS2379 24, TS2488 2, TS2551 591, TS2554 26, TS2560 1, TS2678 2,
TS2698 2, TS2739 2, TS2740 9, TS2741 1, and TS7006 35.

`atomic-file-store@0.2.1` declares `effect >=3` but its Effect subpath is
compiled against v3 (`Context.TagClass`, v3 Schema, `Effect.catchAll`, and
`Effect.unsafeMakeSemaphore`). The session-store batch migrates that dependency
to native RC.110 code through a reviewed package patch or replaces only its
Effect adapter with a v4-native integration; retaining its v3 runtime is not an
option because the cohort must remain singular.

## Layer and fiber ownership audit

| Resource | RC.110 ownership decision |
| --- | --- |
| `StateFileLocks` | `makeSessionPort` allocates one table and explicitly provides that same service to every cycle for the port. CLI login allocates one table for its process. Tests allocate a fresh table per test and share it only with child fibers inside that test. |
| Guest session `Ref` | allocated once by `makeSessionPort`; it is process-local session state and is never hidden in a module-global layer. |
| `VoilaTransport` | the operation environment owns the configured layer; the Node client is scoped by the Effect provide and every response body read is inside the request deadline and client scope. Test transports are fresh DI layers. |
| `VoilaOperations` | provided once at the MCP composition root; toolkit handlers request the service explicitly through `Context.Service`. |
| HTTP server / stdio | transport resources are acquired by the RC.110 server layers and remain scoped to `Layer.launch`; custom stdio streams are injected as one explicit `Stdio` service. |
| Child fibers | migrated to `Effect.forkChild`; tests join or interrupt them inside the owning test scope. No session or network work uses detached daemon fibers. |

Effect 4 layer memoization therefore does not merge independent test lock
tables or guest state, while each live process deliberately shares the one
stateful instance that serializes its session-file cycles.

## Parity contraction

The final oracle comparison records every structural path whose observable
meaning differs. Unclassified, duplicate, and stale reviewed exceptions fail
verification.

## Final validation

| Evidence | Result |
| --- | --- |
| Exact runtime cohort | one `effect@4.0.0-rc.110` cohort; `@effect/platform-node` and `@effect/vitest` also exact RC.110 |
| `pnpm check-all`, Node 22.22.2 | pass; 36 harness tests and 509 package tests, 99% coverage thresholds retained |
| `pnpm check-all`, Node 24.15.0 | pass; same build, type, diagnostics, cycle, lint, fixture, oracle, and coverage gates |
| Immutable oracle v1 / supplemental v2 | pass; baseline hashes `26d53bbd2414fb084cbf8c8dcbfaae4707fd80d2e0964d82661560a9b6f8ab5a` and `08b728419ce5eafe0a671e8bebeccf8ae22c78ecd7c724c3d37fa96858dbc137` |
| Package audit | SDK, MCP, and CLI pass tarball metadata, dependency, content, and executable checks |
| Clean consumers | SDK, MCP, and CLI pass under pnpm and npm on both supported Node lines, with only RC.110 in the runtime cohort |
| Read-only live smoke | request identity passed with sanitized output; packaged guest CLI catalog search returned a product through the shipped Node transport; the bare-fetch SDK helper remained safely WAF-blocked with a typed error |

No live cart mutation or checkout/order placement was run.

## Self-review disposition

The outer standards review noted the residual cross-process race between the
raw-byte CAS comparison and atomic rename in the session file adapter. This is
the same landing algorithm used by the pre-migration `atomic-file-store@0.2.0`,
and ADR-0001 explicitly records and accepts that millisecond-scale residual
window while rejecting cross-process lockfiles. Changing that concurrency
contract during this compatibility migration would be an unrelated
architecture/product decision, so the finding is documented rather than
implemented here. Exclusive creation, in-process serialization, drop on a
detected conflict, lineage protection, and guest-downgrade refusal remain
covered and unchanged.
