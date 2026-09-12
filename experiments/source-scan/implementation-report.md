# Source navigation and import provenance — 2026-09-11

Implemented in the isolated `917b/waxwing` worktree. The supplied scanner patch
matched SHA-256 `cf1b8e04c45d920390bf4cb186f9a648ec438f4dfe21a6e07829b0d2aeb74687`
and applied cleanly after `git apply --check` to base
`ea59940c8daee7c438ecd1fc3e1d95a76cb60c85`. Dependencies were installed with
`npm ci`. The parent checkout was only read. All changes remain uncommitted;
there was no PR, push, merge or deployment.

## Working example

```sh
node bin/waxwing.mjs scan . /tmp/waxwing-snapshot.json
node bin/waxwing.mjs scan-view /tmp/waxwing-snapshot.json /tmp/waxwing-source.html
```

Open the HTML, search `pipeline`, select `modules/application/pipeline.mjs`,
then `loadAndLayout`. Its call at line 36 binds to the local `layoutModel`
variable at line 34. A separately qualified provenance link reaches the exported
function at `modules/presentation/layout/index.mjs:17`. Follow the export to
see incoming calls, or “Import evidence” to inspect the literal module occurrence
at pipeline line 34. Every location includes UTF-16 coordinates and a file hash.

The normal CLI and installed skill adapter expose `scan-view`, and bounded
`scan-query` adds `functions` and `outgoing`. `references` includes occurrences
through recorded import provenance while retaining their original lexical
bindings. Public APIs separate `sourceNavigation` (knowledge), `renderSourceHTML`
(presentation), and `renderSourceFile` (application). The full detailed snapshot
remains available. The HTML embeds a projection and is not an authored
architecture artifact or a complete snapshot recovery format.

## Supported provenance and limits

Simple immutable `const` object destructuring from a literal awaited import
supports renamed/default exports and re-export facades. Each binding keeps its
module occurrence and export name. Overloads and competing star exports remain
ambiguous, including through named facades. Mutable bindings/exports, detected
writes (including assignment patterns and loops), type-only exports, defaults,
rest/nested/computed patterns and incomplete paths stay explicitly unresolved.
Shadowed locals are identified by compiler symbols, not matching names.

This locates exported declarations; it does not prove dispatch, callability,
execution or control flow. General value aliases, parenthesized/wrapped await
forms, namespace-member provenance, anonymous callable identities, conditional
callees and browser asset/injected-scope relationships remain incomplete.
Named caller ownership is lexical containment and can include anonymous callback
bodies; it is not a claim of immediate execution by the enclosing function.

External built-ins and package-shaped module specifiers are separate boundary
references with no scanned implementation. Missing relative modules and
unconfigured aliases/URLs remain separate uncertainties. Bare specifiers can be
project aliases; packages are not verified as installed. No tsconfig, package
manifest, standard-library loading or runtime/type-checking was added.

## Validation

- `npm test`: 270/270 passed, including 22 source-specific tests.
- `npm run test:package`: passed against an installed npm archive, including
  all public exports and `scan-view` through the installed skill adapter.
- Responsibility-boundary checks and isolated knowledge-module checks passed.
- Independent Node/V8 audit: 130 JS files; 524 distinct per-file static
  dependencies; 314 relative target paths; 210 external boundaries; 87,110
  source-position endpoints; all identifier occurrence texts and analyzed-file
  hashes/lengths checked. Zero discrepancies or syntax errors.
- All 26 existing manually grounded lexical-binding samples passed unchanged;
  all four additional export-provenance samples and their navigation projection
  records passed. The targeted fixture suite covers additional negative cases.
- Actual browser checks: file/function search; pipeline function selection;
  exported `layoutModel` navigation and incoming lazy-import call; pagination;
  import-evidence link and expansion (pipeline offsets [1503, 1537), line 34);
  separate external boundary section; source-only initial file list. The
  function view was visually inspected; no browser errors were recorded.

The final audit snapshot is `snapshot-da2fcd97638a74da25aea3d05dfbda46c9de02a8478d7a5df145481c76322710`.
The snapshot contains 236 discovered files (130 analyzed, 106 skipped), 8,411
named declarations and 35,144 reference occurrences. These counts are not
coverage/accuracy scores. The independent audit remains limited to JS ESM static
imports, source positions and sampled bindings; it does not prove discovery
completeness, all call coverage or runtime behavior.

Scan, validation and formatted serialization: 1575 ms;
peak process RSS 651.4 MiB; snapshot 28.77 MiB.
View generation after the independent audit: 541 ms;
HTML 8.82 MiB; cumulative process peak RSS
716.7 MiB (includes earlier scan/audit work). These are
single local observations, not scaling benchmarks or acceptance thresholds.

## Product and architecture follow-up

No decision blocks this implementation. Cross-revision matching, configurable
project resolution, evidence bridges to authored models, anonymous/conditional
call semantics and richer source-text navigation remain future decisions.
Human domain terminology, intended boundaries and goals are still human inputs;
no architecture or intent is inferred from connectivity. Resource optimization
is explicitly deferred. No language or parser migration was undertaken.
