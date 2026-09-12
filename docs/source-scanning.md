# Source scanning — development preview

The scanner reads JavaScript and TypeScript source and produces a separate
`0.1-source-draft` snapshot of files, named declarations, module occurrences and
identifier references. It is useful for locating code and following static
bindings before authoring an explanation. It does not generate architecture
models or establish intent, runtime behavior or proof obligations.

This is the first implementation slice. Kotlin, Java, Python, Go,
Objective-C/Objective-C++, SQL, JSON, shell and **Lean 4** remain initial release
targets; their adapters are not implemented yet. They appear as skipped files
when encountered. JSON manifests and project configuration are not interpreted
by this preview.

## Run it

From this branch's checkout after `npm ci`:

```sh
node bin/waxwing.mjs scan /path/to/repository /tmp/project-scan.json --source-id my-project
node bin/waxwing.mjs scan-check /tmp/project-scan.json
node bin/waxwing.mjs scan-view /tmp/project-scan.json /tmp/project-source.html
node bin/waxwing.mjs scan-query /tmp/project-scan.json search loadModel
```

Use a declaration's returned `id` to retrieve incoming references:

```sh
node bin/waxwing.mjs scan-query /tmp/project-scan.json references DECLARATION_ID
node bin/waxwing.mjs scan-query /tmp/project-scan.json inspect RECORD_ID
node bin/waxwing.mjs scan-query /tmp/project-scan.json imports FILE_ID
```

Open `/tmp/project-source.html` in a browser. It is a standalone source explorer
with file/function search, file imports, external boundary references, incoming
module references, and incoming/outgoing call occurrences. Select a function
then follow a binding or provenance link to its target. Browser back/forward and
fragment links work within the snapshot. Lists show 30 relationships at a time
with a button to reveal more; skipped files are available through a checkbox.
Local identifiers stay in the detailed snapshot and are visible when a binding
link leads to them, but do not crowd the initial file/function list.

Each occurrence provides its exact path, line/column range, UTF-16 offsets,
record ID and file SHA-256. Source text is not embedded or fetched. Match the
source bytes to that hash before inspecting an edited checkout. Named callable
ownership is lexical containment, including code nested inside unnamed callbacks;
it is not a statement that the enclosing function directly executes that call.

These commands are available through the installed skill adapter as well.
`guide scanning` exposes this document. Published older Waxwing releases do not
contain these commands; this document describes the scanner branch.

The output path must be outside the source directory, including through
symlinks. Outputs are computed and validated before an atomic file replacement.
Source text is not embedded. Names, paths, import specifiers and diagnostics may
still contain source information, so review snapshots before sharing them.

## What gets analyzed

- JavaScript: `.js`, `.jsx`, `.mjs`, `.cjs`.
- TypeScript: `.ts`, `.tsx`, `.mts`, `.cts`, including declaration files.
- Named functions, classes, methods/accessors, variables, parameters, properties,
  interfaces, type aliases/parameters, enums/members, namespaces and import bindings.
- Identifier occurrences, direct identifier/member call syntax, constructor
  syntax, imports, re-exports, dynamic imports and unshadowed `require` calls.

The adapter uses the pinned TypeScript **6.0.3** compiler API. This version
provides the in-process parser and checker interface used here; the newer 7.x
package has a different API. See Microsoft's
[compiler API documentation](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API).

The compiler host reads only supplied snapshot files. It does not delegate to
the user's filesystem, load `tsconfig.json`, plugins, package manifests, standard
libraries or external packages, fetch dependencies, or emit/execute source.
Every input is treated as a module, using ESNext syntax and bundler-style module
resolution. Relative `.js` specifiers may resolve to captured `.ts` sources;
that is compiler source resolution, not a claim that a runtime can execute them.

Bindings can follow import aliases and re-exports, lexical shadowing and known
members. Namespace/property inference is limited to the supplied code. Missing
libraries and packages leave many references unresolved. Module occurrences
classify `node:` specifiers as `external-builtin`, bare package-shaped specifiers
as `external-package-specifier`, and unresolved relative paths as
`missing-internal-module`. These describe syntax and the closed scan boundary:
packages are not verified as installed, and a bare specifier might be a project
alias. `#` aliases, absolute paths and URL-like specifiers remain
`unconfigured-module-specifier`. External implementations are never scanned. Overload declarations
and other multiple targets remain candidates; no overload is selected as a
runtime dispatch claim. Type-checking and semantic diagnostics are not run.

For `const { run: local } = await import('./module.js'); local()`, the call's
`resolution` still targets the local variable. That declaration additionally has
`valueProvenance: { kind: 'await-import', moduleRef, importedName, resolution }`.
The provenance resolution names the exported declaration separately. The module
occurrence, local binding and exported declaration each retain source positions.
The view displays both relationships; it never promotes provenance to runtime
execution. Named/default exports, aliases and explicit re-exports are supported.
Overloads and competing star exports remain candidates, including through named
re-export facades. Type-only exports do not provide a value origin.

The supported binding must be a simple `const` object destructuring element with
an identifier local name and an identifier or string property name. The adapter
rejects detected assignments (including destructuring, updates and loop targets),
`let`/`var`, mutable exports, fallback values, rest/nested/computed patterns,
nonliteral imports, syntax-error modules and incomplete export paths. These get
explicit unresolved provenance reasons. Parenthesized/wrapped await expressions,
namespace member tracing, general value aliases and control-flow reasoning remain
outside this slice; bindings without recognized import initializers have no
provenance field. An exported variable is an origin declaration, not proof of
its callable value. No semantic diagnostics or runtime check is implied.

For `const alias = fn; alias()`, the call's binding is `alias`. Following that
value through assignments to identify its eventual callable is separate data-flow
analysis and is not implemented here.

Anonymous callable identities, computed/string member accesses, call results,
reflective calls, project-specific resolution and complete control flow are not
covered. A `call` record is a source occurrence with an optional static binding,
not evidence that the call executes. No intent or architectural meaning is
inferred from code patterns.

## Coverage and bounds

The repository has a repeatable [self-audit](../experiments/source-scan/README.md)
that compares static dependencies with an independent Node/V8 parser, checks
source positions against the original text, and exercises selected call bindings.
Its report also records observed gaps. Passing these checks does not establish
complete declaration/call coverage or runtime correctness.

In Git working trees, discovery includes tracked files and nonignored untracked
files, using their current bytes. It respects Git ignore rules for untracked
files. Repository filesystem-monitor hooks are disabled for discovery. Without
Git discovery, the filesystem walker reports that mode and does not interpret
`.gitignore`.

Both modes exclude directories named `.git`, `.internal`, `.waxwing`,
`node_modules`, `vendor`, `dist`, `build` and `generated`. These are declared
scope exclusions, not assertions that their contents are unimportant. Directory
symlinks, file symlinks and Git submodule directories are not followed.

Defaults, configurable through matching flags or API options:

| CLI flag | API option | Default |
| --- | --- | --- |
| `--max-files` | `maxFiles` | 10,000 discovered file entries |
| `--max-file-bytes` | `maxFileBytes` | 1 MiB per analyzed file |
| `--max-total-bytes` | `maxTotalBytes` | 32 MiB of analyzed source |

Skipped files retain a reason: unsupported language, symlink, nonregular file,
invalid UTF-8, binary content, unavailable source, or a byte limit. Excluded
directory contents are not enumerated. File-count/discovery failures set
`coverage.discoveryComplete: false`; remaining paths are unknown. Successful
discovery does not mean every file or every language construct was analyzed.

Syntax diagnostics retain ranges. Recovered declarations/occurrences may still
be listed, but bindings involving syntax-error files stay unresolved. A valid
snapshot can contain parse errors and skipped files: CLI success means a usable,
internally consistent snapshot was produced, not that coverage is complete.

The scan samples files sequentially; it is not an atomic repository snapshot.
`source.gitHead`, when available, records context only. File digests describe the
actual sampled bytes, including uncommitted changes. The scanner does not run
builds to check whether those sources describe a deployed system.

## Records and identity

The [schema](../schemas/source-snapshot.schema.json) describes the payload.
`scan-check` also validates IDs, digests, unique paths/records, reference targets,
container relationships and ranges. It validates the snapshot's consistency;
without the original source bytes it cannot re-establish the claimed evidence.

- `source.id` identifies the repository/source space. Choose a unique, durable
  `--source-id` when combining repositories. Its default is the directory name;
  that default is not globally unique.
- File IDs derive from `source.id` and normalized relative path. Paths use `/`,
  remain case-sensitive, and cannot escape the source root.
- Declaration and reference IDs additionally include the file content digest,
  occurrence range and kind. Moving the checkout or changing a view label does
  not change them. Editing a file changes its occurrence IDs; cross-revision
  identity/rename matching is deliberately not inferred.
- The snapshot ID hashes its complete recorded content, including producer,
  coverage and diagnostics. Input ordering and timestamps do not introduce drift.
- Positions use zero-based UTF-16 offsets, one-based lines/columns and exclusive
  ends. File content hashes use UTF-8 bytes; byte offsets are not interchangeable
  with these positions.
- A reference resolution is `resolved` with one target, `ambiguous` with multiple
  candidates, or `unresolved` with no targets. Every outcome carries its basis or
  unresolved reason. Same-named declarations do not automatically connect.

The snapshot records source containment, not organizational hierarchy. Future
architecture evidence links can refer to a snapshot ID plus record ID; this
branch does not implement those mappings or merge source records into existing
architecture/sequence schemas. Lean code/proof extraction will need its own
appropriate declarations and verification evidence, including elaboration and
axiom/incomplete-proof status.

## Library APIs

```js
import { analyzeSources } from '@isought/waxwing/analysis';
import { validateSourceSnapshot, querySourceSnapshot, sourceNavigation } from '@isought/waxwing/source';
import { scanRepository, scanRepositoryToFile, loadSourceSnapshot, renderSourceFile } from '@isought/waxwing/scan';

const snapshot = await analyzeSources([
  { path: 'math.ts', content: 'export function twice(n: number) { return n * 2; }' },
  { path: 'main.ts', content: "import { twice } from './math.js'; twice(3);" },
], { sourceId: 'example' });
const result = validateSourceSnapshot(snapshot);
const matches = querySourceSnapshot(snapshot, 'search', 'twice', { limit: 10 });

const repository = await scanRepository('/path/to/repository', { sourceId: 'my-project' });
await scanRepositoryToFile('/path/to/repository', '/tmp/scan.json', { maxFiles: 2000 });
const saved = loadSourceSnapshot('/tmp/scan.json');
await renderSourceFile('/tmp/scan.json', '/tmp/source.html');
const navigation = sourceNavigation(saved); // supplied records only
// Pure presentation API: renderSourceHTML(saved) from @isought/waxwing/source-view
```

Analysis receives strings and does no repository I/O. Application APIs own
discovery and output. Source validation/query APIs work without the analysis
implementation or compiler. Queries support `limit` (1–1,000), `offset` and a
character `budget` (64–1,000,000) for serialized result records. They never split
records: an oversized first record returns no results and a minimum required
budget. Metadata is additional. The input snapshot is still loaded in full;
this is bounded result retrieval, not a database index or streaming store.
`functions FILE_ID` lists named functions/methods/classes; `outgoing FILE_ID` lists
calls/constructs in that file, while `outgoing DECLARATION_ID` selects the nearest
named callable owner. `references ID` includes both compiler-binding matches and
occurrences whose bindings have recorded provenance to that ID. It returns the
original occurrences with their unchanged binding resolutions; inspect the
binding declaration to read its provenance. `sourceNavigation` provides a full
projection with each relationship's `reference`, `callerRef` and separately
qualified `provenance`. It is not bounded. The HTML embeds this projection, not
the full snapshot, and is not an architecture artifact for `recover`.

The compiler is loaded lazily for analysis. Its pinned package is nevertheless
an installed dependency, adding installation size; no separate compiler process
or per-scan network service is required. Large projects need measured memory/time
budgets before expanding this preview's limits or publishing broader coverage.

## Connect a system view to source

`build-connected` publishes the normal system site alongside a standalone source
explorer, with optional qualified links between them:

```sh
waxwing build-connected model.json scan.json links.json output --source-root /path/to/repository
# A dash means no connections. Both views remain useful.
waxwing build-connected model.json scan.json - independent-output
```

Select a component or relationship, then its implementation link. The source
view opens at the recorded file or function; source navigation keeps the context
and provides a return link to that system record. Opening **Explore code** directly
starts independently. Multiple connections may point to the same source entry.
A connection supplies navigation and its stated basis; it does not establish all
claims on the component or prove runtime execution.

Connections live in a separate `0.1-source-links-draft` document, with `modelId`,
the canonical `modelDigest`, `snapshotId`, and `links`. Each link has an `id`,
`subject` (`kind: node|edge`, `graphRef`, `ref`), `entryRef`, `evidenceRefs`, `label`,
`basis` (`status`, `explanation`, `sourceRefs`), and `rationaleNoteRefs`. Source
references in the basis point to the authored model's source registry. Rationale
references point to relevant model notes with `topic: rationale`; their existing
qualification and provenance remain visible. Never invent intent from names or
call connectivity. Missing recorded rationale is a gap for a person to explain.

`validateSourceLinks(model, snapshot, links)` and `projectSourceLinks(...)` are
available from `@isought/waxwing/source-links`. An invalid or stale connection
set is disabled with diagnostics; the independent viewers continue to work.
There is no automatic rebinding across revisions. Graph membership and exact
source identities are checked, including links on relationships.

The optional `--source-root` captures analyzed source files whose bytes still
match the snapshot's SHA-256. Changed, missing, or symlinked files get diagnostics
and no excerpts. Those files' recorded graph relationships remain navigable.
No external library implementations are read. The portable export contains the
full source snapshot, optional connections, and verified text in the source HTML.
Keep the managed directory together; it can be rebuilt or moved like other sites.
`recover` still recovers the original authored model.

Library composition uses `renderSite(layout, { source: { snapshot, links,
sourceTexts, evidenceDiagnostics } })`, or `buildConnectedSiteFiles(modelFile,
snapshotFile, linksFileOrNull, outputDirectory, { sourceRoot })` from
`@isought/waxwing/connected`. `captureSourceTexts` performs the filesystem work;
presentation accepts verified bytes without reading the scanned repository.

Run the repository example with `npm run demo:connected -- /tmp/waxwing-connected`.
It scans Waxwing's current working tree and connects a curated build overview to
its real source declarations. The abstraction is explicitly authored; the scan
supplies checked code identities and static relationships. This is the first
connected slice, with broader discovery of candidate architectural mappings and
cross-revision review still to follow. Large scan memory/output optimization
remains deferred.

This first connection draft targets architecture graph nodes and edges. Workflow
pages retain independent source access but do not offer a contextual source
return. Connected sites currently stay separate from collection regeneration;
`build-collection` rejects them explicitly to avoid discarding source evidence.

## Reading and navigating source

`scan-view` and the source explorer exported by `build-connected` share one
maintained viewer. For a function or method, **Recommended** starts with resolved
internal callable connections. Repeated caller–target pairs share an edge and
count; selecting that edge opens the supporting occurrences without replacing
the graph. Explicit resolved imported-value provenance may connect directly to
an exported callable, with the intermediate binding and import still inspectable.
These arrows describe static relationships, not execution order or runtime dispatch.

**Other calls** groups occurrences without a resolved internal callable target.
This includes parameter bindings, uncertain candidates, unresolved members and
some external/standard APIs; the viewer does not label them all as built-ins.
**All occurrences** exposes the original binding/origin graph, including its
uncertainty. Complete source records remain in the evidence lists in either mode.
Source excerpts are optional and only embedded after matching snapshot bytes.

The browsing trail records navigation, not an inferred execution path. Returning
to a visited record restores its expanded limit, graph mode, other-call disclosure
and scroll position. Browser Back/Forward and reload restore state only for the
same snapshot and connection context. Search starts a new trail. File callers
show paths and open the file's module relationships and functions. Evidence links
can still open their exact occurrence, including explicitly mapped identifiers.

Neighborhoods start at eight connections/occurrences and expand to 40. Existing
edges to visited records and mapped connection evidence receive priority;
omissions remain counted and the evidence lists retain all records. Small panels
use a vertical layout without changing graph meaning. No clustering, new parser,
callback inference, or dependency implementation scanning is introduced by this
presentation change.

Connected entry points retain their recorded explanation, rationale and return
link while navigating source. Missing/stale connections continue to disable only
the bridge; standalone source exploration remains available.
