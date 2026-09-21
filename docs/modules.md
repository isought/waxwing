# Independently usable modules

Waxwing is one npm package with subpath exports. Modules are separate code
entry points, not separate services or separately published packages. In a
consuming Node.js project, run `npm install @isought/waxwing@0.3.0`; imports below then
resolve locally. A global CLI installation alone does not expose library imports.
Within a source checkout, run `npm ci` before using these examples.
The experimental analysis, source, scan, source-view, connected, and source-links
exports were added in 0.3.0 and are unavailable in 0.2.0.

## Model

For a separate cross-model evidence/lineage index, see the
[`@isought/waxwing/workspace` API](workspace.md#module-api). It validates
declared references and produces potential review scope without merging models,
fetching remote evidence, or scanning repositories.

```js
import { validateModel } from '@isought/waxwing/model';

const result = validateModel(json1);
// { ok, diagnostics, summary, unresolved, qualifications, limits }
```

Uses Ajv and the model schema. It does not load the layout engine, render an
artifact, fetch evidence, or require a conversation. Invalid shapes return
diagnostics without the success-only summary fields.

## Layout

For a local model with Markdown file references, first call the optional
[document loader](documents.md):

```js
import { loadModel } from '@isought/waxwing/documents';
const { model, inputFiles } = loadModel('/path/to/model.json');
```

It returns complete canonical JSON 1 and a list of physical input paths. The
following layout API does not read files; supply `model` as its JSON 1 input.

```js
import { layoutModel, validateLayout } from '@isought/waxwing/layout';

const json2 = await layoutModel(json1, {
  groupingPerspectiveRef: 'system-structure',
  direction: 'RIGHT',
});
const result = validateLayout(json2, { expectedModel: json1 });
// Valid results include advisory warnings; these do not change result.ok.
```

The grouping reference is an ID from your own model; it is not a built-in
ownership/system enum. Omitting it selects no frames. Only `RIGHT` and `DOWN`
placement are supported initially. Invalid models, unsupported options, or
failed geometry throw an error, with `diagnostics` when available. Source
models are copied and remain unchanged.

ELK supplies geometry only. The adapter converts its coordinates into absolute
canvas coordinates and subjects the result to Waxwing's preservation checks.
It never invents a primary path or changes operation direction.

## Render

```js
import { renderSVG, renderHTML } from '@isought/waxwing/render';

const svg = renderSVG(json2);
const html = renderHTML(json2);
const editorial = renderHTML(json2, { skin: 'editorial' });
```

Accepts compatible JSON 2 produced by any implementation. The renderer invokes
validation but does not load or execute ELK. It resolves labels and claims from
the model embedded in JSON 2 and returns strings; it does not write files.

To build your own renderer, consume `nodes[].box`, `groups[].box`, and
`edges[].points`/`label`, resolving `ref` against `json2.model`. All system meaning
is available there. Preserve that source payload and its qualifications if your
exports claim Waxwing's recoverability guarantee.

The [viewer reference](viewer.md) documents skins, `selectHighlights` from
`@isought/waxwing/render`, and `inspectReadability` from `@isought/waxwing/layout`. These helpers
operate independently of the HTML controls; their results do not alter source
facts or geometry.

## Artifacts

```js
import { extractLayout, recoverModel, recoverArtifact } from '@isought/waxwing/artifacts';

const json2 = extractLayout(svgOrHtmlText);
const json1 = recoverModel(json2);
const sameModel = recoverArtifact(svgOrHtmlText);
```

`extractLayout` also accepts a JSON 2 object or its JSON text. Extraction rejects
missing or multiple payloads. `recoverModel` returns a defensive copy. These
functions use validators but neither the renderer templates nor ELK.

## Sequence diagrams

`@isought/waxwing/sequence` exports `validateSequenceModel`, `layoutSequence`,
`validateSequenceLayout`, `renderSequenceSVG`, and `renderSequenceHTML`.
It does not load ELK. The general model/layout/render/artifact entry points also
dispatch on `diagramType: "sequence"`, so existing CLI stage names work.
The source contract and geometry differ from architecture diagrams; see the
[sequence API and rules](sequence.md). Documents and complete source recovery
retain their existing behavior.

The same API accepts the [behavior version](sequence-behavior.md), with nested
loop/if blocks and direct-child body orders. Its JSON 2 adds block headers and
body regions; validation preserves source containment as well as order.
Behavior documents can also attach to a block. Version 1 scenarios keep their
original meaning and schema; neither version is converted automatically.

Both drafts accept the additive [entry declaration](sequence-entry.md). Its
participant placement and visible start cue derive from source claims; existing
artifacts without entry metadata remain supported without invented defaults.

## Relational storage and ERDs

The 0.4 prerelease adds `@isought/waxwing/relational`. This subpath is not available
in 0.3.0; use the matching prerelease archive or this source checkout.

```js
import {
  validateRelationalModel, relationalRecords, foreignKeyCardinality,
  extractPostgresSchema, fromPostgresSnapshot,
  layoutRelational, validateRelationalLayout,
  renderRelationalSVG, renderRelationalHTML,
} from '@isought/waxwing/relational';

const validation = validateRelationalModel(model);
const layout = await layoutRelational(model);
const svg = renderRelationalSVG(layout);
const html = renderRelationalHTML(layout);
```

The generic model/layout/render/artifact APIs also dispatch relational models
without converting them to architecture records. Complete relational JSON 1 is
embedded and recoverable from SVG/HTML. `relationalRecords` returns inspectable
tables, columns, constraints, indexes and associations with their original source
records; FK cardinality remains qualified by evidence, nullability and key facts.

`extractPostgresSchema(query, { schemas })` runs one parameterized read-only catalog
statement through a caller-supplied query function and returns a normalized
`postgres-catalog-1` snapshot. `fromPostgresSnapshot(snapshot, { id, title, ... })`
validates and converts that snapshot to a `relational-1` model with stable IDs.
It does not execute migrations or infer application references. See the complete
[relational contract and acquisition limits](relational.md).

## CLI boundary

`bin/waxwing.mjs` delegates to `modules/interfaces/cli.mjs`, which dynamically
loads the operations required for each command. Run
`node bin/waxwing.mjs --help` for command syntax. The old
`scripts/validate-model.mjs` and `lib/validate-model.mjs` remain compatibility
entry points for the initial prototype.

`validate`, `prepare`, `layout`, and `build` resolve explicitly registered
Markdown files. `prepare` saves canonical JSON 1 without laying it out. Existing
canonical models need no preparation. Render/recover do not load source files.

Application file workflows write outputs via a temporary sibling file and rename.
Render and layout failures leave a previous output unchanged; inputs cannot be overwritten
by an output. `build` computes all content before writing, but its three file
replacements are individually atomic, not a filesystem transaction across the
whole bundle. Concurrent editing/writing is not coordinated by the MVP.

## Source layout

```text
modules/
  knowledge/
    architecture/  JSON 1 validation, graph references and projections
    sequence/      Scenario/behavior meaning, entry and order validation
    relational/    Relational records, reference validation and FK cardinality
    workflow/      Architecture participation and interaction validation
    documents/     Markdown parsing, resolved links and asset validation
    query/         Bounded retrieval of recorded knowledge
    records/       In-memory model update inventories
    workspace/     Manifest validation and potential review scope
    source/        Source snapshot validation, identity and bounded queries
    shared/        Qualified claims, canonical serialization and diagnostics
  presentation/
    layout/        ELK adapter, geometry validation and readability checks
    render/        SVG/HTML output, viewer assets and artifact recovery
    sequence/      Drawing constraints, geometry and sequence viewer
    relational/    Table/column geometry and ERD inspector
    workflow/      Drawing constraints, geometry and workflow rendering
    documents/     Document HTML and navigation URLs
    site/          Page composition, assets and search presentation
    source/        File/function navigation and source evidence HTML
    workspace/     Markdown review reports
    shared/        Display text and drawing metrics
  application/     File loading, build/render/recover workflows, site writes,
                   collection builds and update review coordination
  interfaces/      CLI arguments/results and skill installation/guide access
  analysis/        Source extraction and PostgreSQL catalog normalization; compilers loaded lazily
  model/, ...      Existing module paths retained as compatibility entry points
schemas/       JSON 1 and JSON 2 contracts
bin/           Stable executable entry point
examples/      fictional evidence, JSON 1, generated artifacts
test/          contract, preservation, rendering, and independent CLI tests
```

### Dependency direction

These boundaries separate responsibilities; they do not rank models by size or
force repositories, services and views into one hierarchy.

| Responsibility | May import other responsibility implementations |
| --- | --- |
| Knowledge | None |
| Analysis (planned) | Knowledge |
| Presentation | Knowledge |
| Application | Analysis, knowledge, presentation |
| Interfaces | Application, analysis, knowledge, presentation |

Each responsibility may also import its own modules. Only interfaces may use
the packaged skill adapter. New implementation code imports the owning module
directly, never an old compatibility entry point. The public npm subpaths stay
unchanged; their exports can combine several responsibilities for existing
callers. Internal subdirectories remain private; the new source APIs are
documented in the scanner guide.

Knowledge functions operate on supplied records. Validators read bundled JSON
schemas at initialization, but do not open user models, fetch evidence, import
viewers or load ELK. Markdown parsing uses markdown-it; HTML customization and
document URLs belong to presentation. A valid model can still be undrawable;
drawing blockers belong with the presentation that imposes them.

Application functions own explicit input/output operations and coordination.
For example, `application/pipeline.mjs` resolves documents, validates and lays
out a model, renders artifacts, and writes outputs. It returns results or throws;
CLI flags, console messages and exit codes belong to interfaces. Presentation
can read its bundled schemas/templates/assets but does not write user outputs.

`test/module-boundaries.test.mjs` checks literal imports/re-exports across these
boundaries and runs all knowledge modules from an isolated copy with the other
responsibilities absent. Existing API and CLI tests exercise the compatibility
entry points. Viewer JS and CSS live beside their presentation implementations;
their old unexported asset paths are no longer present.

To replace layout, produce JSON 2 and pass it to the renderer. To replace
rendering, consume JSON 2 directly. Neither requires adopting the future
ingestion layer. Splitting dependency installation into separately published
packages can follow later if needed.

### Source analysis and future interfaces

The [source scanner preview](source-scanning.md) implements JavaScript/TypeScript
extraction into a separate source snapshot. `@isought/waxwing/analysis` accepts
in-memory sources, `@isought/waxwing/scan` handles repository I/O, and
`@isought/waxwing/source` validates and queries snapshots without a compiler.
The [analysis notes](../modules/analysis/README.md) retain the initial language
targets, including Lean 4; the remaining adapters and proof checking are still
planned. Source/code/proof models should remain
specialized and connect to explanatory models through explicit evidence and
identity mappings. Diagram IDs and exported URLs do not define code identity.

A repository may contain several services; a service may span repositories.
Likewise a reading tree or document sequence is one view over relationships,
not a constraint on all stored knowledge. The existing workspace index remains
a declared lineage index, not an extracted code graph.

See [design principles](design-principles.md) for the machine/human interaction
rule that applies across source analysis, authoring and future apps. Existing
examples with pinned source revisions describe those revisions; their old module
names are not a claim about the current internal directory layout.


## Graphs across abstraction levels

`@isought/waxwing/graphs` exports `graphsOf(model)`, `rootGraph(model)`, and
`projectGraph(model, graphRef)`. Projection is an internal adapter input for
layout, not a complete source export. Pass the full model to `layoutModel`;
it produces one validated geometry record per graph and embeds the complete
original source once.

`renderHTML(json2)` includes all graphs and documents. `renderSVG(json2)` draws
the root graph. `renderSVG(json2, { graphRef })` selects another graph while
retaining the complete source. The CLI equivalent is
`waxwing render layout.json detail.svg --graph graph-id`.
See [subgraphs](subgraphs.md) for model selection, mappings, and version rules.

## Architecture workflows

`@isought/waxwing/workflow` exposes `workflowsOf(model, graphRef?)`,
`workflowParticipants(workflow)`, `workflowDiagnostics(model)` and
`workflowDrawingDiagnostics(model, workflow)`. These inspection helpers expect
a structurally valid architecture model and do not load ELK. Use `validateModel`
for untrusted JSON 1; it includes workflow semantic validation.

Use the existing `layoutModel(model, options)` for complete JSON 2, including
connectivity and workflow geometry. `validateLayout` checks both. Render a
standalone workflow SVG with:

```js
renderSVG(layout, { workflowRef: 'checkout-run', skin: 'standard' });
```

`graphRef` and `workflowRef` are mutually exclusive. `renderHTML(layout)` includes
all graphs, workflows and documents. Equivalent CLI selection:

```sh
node bin/waxwing.mjs render /tmp/layout.json /tmp/workflow.svg --workflow checkout-run
```

Module separation remains intact: render/validation do not import ELK, and
artifact recovery retains the complete architecture source, including every
workflow and document. See the [contract](architecture-workflows.md).

Connected source exports compose `knowledge/source-links` (qualified optional
connections and identity validation), `presentation/source` (independent source
graphs and evidence), `presentation/site` (system navigation), and
`application/connected` (source-byte capture and managed publication). The native
architecture and source schemas remain independent. Source connections are a
separate sidecar, not module ownership or a required hierarchy.
