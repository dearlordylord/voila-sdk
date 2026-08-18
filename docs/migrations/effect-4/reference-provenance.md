# Effect migration reference provenance

Issue #19 uses three immutable, local reference repositories. They are ignored
working material; this tracked note records the reviewed identities and lookup
policy.

| Purpose | Local path | Upstream ref | Commit |
| --- | --- | --- | --- |
| Historical Effect 3 behavior | `.reference/effect-v3.22.1/` | `effect@3.22.1` | `417e0faa80e471d77fc4a67452e68b09ae0ee861` |
| Effect 4 implementation authority | `.reference/effect-v4.0.0-rc.110/` | `effect@4.0.0-rc.110` | `66114151c2b4640bf773f2b3456ce70d679422f6` |
| Migration workflow and symbol map | `.reference/effect-skills/` | reviewed `Effect-TS/skills` commit | `28822c9e19998876a6b0e0d97877442012ed4391` |

Create missing references or verify existing ones with:

```bash
pnpm setup:effect-references
pnpm verify:effect-references
```

The setup command stages new clones in a temporary directory, never rewrites an
existing checkout, and rejects an ambiguous `.reference/effect` path. Both modes
verify origin, exact commit, clean state, package version, and the required
migration documents. The verification mode is network-free.

Use migration evidence in this order:

1. Exact declarations and exports in the installed `4.0.0-rc.110` packages.
2. The pinned RC.110 `MIGRATION.md` and the generated v3-to-v4 symbol map.
3. The smallest relevant guide under the pinned `effect-v3-to-v4` skill.
4. Exact RC.110 source for signatures and runtime semantics.
5. Pinned Effect 3 source only when historical behavior is unclear.

Search the generated symbol map for one API at a time. Do not load the whole map
into an agent context. Exact RC.110 declarations override generic or newer
guidance. Do not pull, edit, or repurpose these repositories; changing a pin is a
dependency decision and must update this note and the setup script together.
