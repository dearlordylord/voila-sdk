# Package Audit

Run the local package audit before publishing or handing a build artifact to another project:

```bash
pnpm package:audit
```

For an actual release, run the full release gate instead:

```bash
pnpm release:check
```

The script builds the package, runs `npm pack --dry-run --json --ignore-scripts`, and checks the tarball file list.

Expected package contents:

- `package.json`
- `README.md`
- `LICENSE`
- `dist/src/**`

The audit fails if the dry run includes:

- compiled tests under `dist/test/`
- source or test files from `src/` or `test/`
- TypeScript build metadata such as `.tsbuildinfo`
- unexpected files outside `dist/src/`
- JavaScript build files without matching `.d.ts` declarations

The audit does not publish. It only verifies the package shape that `npm pack` would use.
