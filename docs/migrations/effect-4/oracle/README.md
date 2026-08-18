# Immutable Effect 3 oracle

`baseline.json` is the pre-cutover behavioral corpus for issue #19. It was
captured from freshly built `packages/*/dist` artifacts while the workspace
used Effect 3. The capture command refuses to overwrite an existing baseline.
The immutable envelope hash is
`26d53bbd2414fb084cbf8c8dcbfaae4707fd80d2e0964d82661560a9b6f8ab5a`.

Capture is guarded twice: all three publishable package artifact trees must
have a dist tree newer than their source tree, and every resolved `effect`
dependency must be exactly `3.22.1`. This prevents a post-cutover or partially
built workspace from creating a second baseline. RC.110 HTTP samples use the
public `effect/unstable/http` client against
`@effect/platform-node`'s `NodeHttpServer.layerTest`; there is no live Voila
HTTP fallback.

```bash
node scripts/oracle-capture.mjs
node scripts/oracle-verify.mjs
```

The verifier captures a fresh corpus, compares it to the baseline using
leaf-level structural paths, and requires every difference to be present in
the reviewed `allowlist.json`. Exact entries include the old and new values,
so an entry becomes stale when a migration change disappears. The current
allowlist has four explicit protocol-rendering entries and narrow hashed
groups for the reviewed artifact/schema/Result differences; any new or
unreviewed leaf still fails parity.

Each reviewed exact entry must provide `path`, `before`, `after`, a non-empty
`rationale`, and at least one `evidence` reference (for example an RC.110
declaration or migration-guide path). The reviewed allowlist also uses narrow
prefix groups for repeated artifact, internal-schema, and rendered-`Result`
differences. Every group records its exact member count and canonical
structural-diff hash. Duplicate or overlapping groups, stale counts/hashes,
and unclassified leaves fail verification; there is no root-level catch-all.

The corpus contains MCP tool metadata and strict Draft-07 schemas, HTTP and
stdio protocol samples, CLI command and rendering samples, SDK fixture decodes
and encodes, session diagnostics, and built artifact hashes, sizes, entry points,
bundle composition, and dependency metadata. The MCP schemas are checked in
both forms: internal Effect tool schemas remain evidence, while the schemas
actually returned by the wire `tools/list` response are validated as Draft-07.
When RC.110 emits a Draft-2020-12 `$defs` document, only the validator copy is
converted to Draft-07; the captured wire response remains unchanged in the
protocol sample.
Normalization is path-scoped to the capture marker and the four SDK session
codec cookie paths; unrelated timestamps are never normalized implicitly. Array
order is retained. Cookies, CSRF values, and account values in the fixtures are
synthetic and never come from a live session.

The original immutable baseline predates the additive `cli.process` and
`artifacts[].bundleCompositionStatus` probe fields, and its
`bundleComposition` entries are empty arrays where source maps were not emitted.
The current corpus deliberately keeps the CLI process samples and reports missing source maps with an explicit
`{ status: "unavailable", reason: "source-map-not-emitted" }` value instead of
an empty composition array. Those paths are a
documented baseline gap represented by a reviewed prefix group; do not rewrite
the baseline to add them. Additional SDK/session/CLI cases are also a
follow-up coverage task, not part of this capture repair.

The current built workspace has four protocol rendering differences against
the original baseline: invalid-input text and cause-message rendering, plus
the missing-argument defect and error-message rendering. Earlier intermediate
captures had four additional protocol leaves, but those now match the
baseline; they are intentionally not retained as stale allowlist entries.
All other `$.mcp.protocol` leaves remain exact and unclassified changes fail
closed. If the migration requires the earlier eight-leaf shape, first restore
the corresponding externally observable behavior and recapture the current
diff; do not broaden a protocol prefix group.

## Supplemental v2 baseline

`baseline-v2.json` is a second immutable envelope. It supplements the original
baseline; it does not rewrite, replace, or change `baseline.json` or its hash.
The v2 capture was made from detached Effect 3 revision
`6a60dda87aae6a79ef284e4a6daa5c77b33d2519`, with the same fresh-dist and exact
`effect@3.22.1` guards. Its content hash is
`08b728419ce5eafe0a671e8bebeccf8ae22c78ecd7c724c3d37fa96858dbc137`.

The v2-only `supplemental` section records completed-order listing, order
details, and order-item aggregation through injected SDK transports; CLI
representative help plus JSON/text operation failure channels and exit codes;
and session lineage, authenticated-to-guest downgrade refusal, CAS conflict
winner, CSRF rotation, deterministic TestClock deadline/interruption, and
underlying-request cancellation. All values are synthetic and summarized at
the public boundary; no live Voila request or session secret is used.

```bash
ORACLE_WORKSPACE_ROOT=/tmp/voila-effect3-oracle.f7AdCx \
  node scripts/oracle-capture-v2.mjs \
  --output docs/migrations/effect-4/oracle/baseline-v2.json
node scripts/oracle-verify-v2.mjs
```

`allowlist-v2.json` starts empty by design. The v2 verifier captures the
current built workspace and fails closed on unclassified, stale, duplicate, or
overlapping reviewed differences until each Effect 4 change is examined. The
capture provenance (revision/effect guard) is migration metadata and is checked
separately from behavioral parity, so an unchanged detached Effect 3 build
verifies without a provenance allowlist entry.
Running it from the current Node 20 host may stop at the known bundled
`undici`/WebIDL runtime incompatibility; run the verifier under the package's
supported Node 22/24 engine when performing parity contraction.

Do not regenerate this file after the dependency cutover to make parity pass.
Review each reported structural path against the RC.110 declarations/source,
then add a precise allowlist entry or restore the old externally observable
behavior.
