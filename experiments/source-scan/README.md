# Scan our own repository

Run from a working checkout after installing dependencies:

```sh
node --experimental-vm-modules experiments/source-scan/audit.mjs /tmp/waxwing-self-audit
```

Choose an output directory outside the repository. It receives `snapshot.json`,
`audit.json`, `report.md` and compact `preview-data.json`. Existing files with those
names are replaced. The snapshot describes the current working tree, including
the experiment itself and other nonignored uncommitted files.

This experiment checks the scanner against independent evidence:

- Node/V8 parses every analyzed JavaScript module to enumerate static imports and
  re-exports. It never links or evaluates those modules. Specifier sets are
  compared in both directions, and relative paths are resolved independently.
- Original bytes establish file hashes and lengths. Source text establishes
  line/column positions and identifier text.
- Source snippets and expected targets, selected by reading the implementation,
  exercise direct imports, renamed imports, re-export facades, recursion, local
  helpers, and the limited meaning of dynamic-import variable bindings. A separate set of
  manually grounded provenance expectations checks export origins without
  changing those lexical-binding expectations. The generated view must retain
  those same provenance paths.

Unexpected differences make the command fail. Snippet selectors must remain
unique; source changes require reviewing the corresponding expectation.

The current self-test assumes JavaScript ESM and explicit relative file
extensions, as used by this repository. A new language or resolution convention
must get an independent oracle; it must not be silently dropped from the audit.

This is not a full call-graph benchmark. No complete independent declaration or
call inventory, dynamic-import completeness oracle, runtime execution trace, or
TypeScript project assessment is included. It checks files within the scanner's
reported discovery scope, without independently proving file-discovery coverage.

Known gaps are reported alongside successful checks. In particular, a resolved
call to a local binding does not establish which function value runs. Conditional
callees and generated/browser-injected source need more analysis. The compact
preview data represents file dependencies, not architectural relationships or
intent. `scan-view` now produces a dedicated source navigation view. Open `source.html`,
search for `pipeline`, select `modules/application/pipeline.mjs`, then
`loadAndLayout`. Its `layoutModel` call should retain the local variable binding
and separately link to `modules/presentation/layout/index.mjs:17`. Follow that
export link to see incoming references, including the call at pipeline line 36;
follow “Import evidence” to the literal import at line 34. Expand evidence and
verify locations against the working tree. Try a module such as `node:fs` to
inspect a boundary with no scanned implementation.

Targeted tests in `test/source-provenance.test.mjs` independently specify
expected bindings for aliases/default exports, shadowing, mutations, defaulted
and nested patterns, type-only exports, overloads and star ambiguity. Run
`node --test test/source*.test.mjs` for these and the application/contract checks.
The HTML is checked through the normal CLI and installed package adapter too.
