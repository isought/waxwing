# Feature walkthroughs

System architecture diagrams whose meaning can be inspected, reconstructed,
and updated by humans and agents.

> If you cannot recreate it, you do not understand it.

The pipeline implements **JSON 1 → JSON 2 → SVG / HTML**, with separate
module entry points and recovery of the complete source model from either
export. The contracts are experimental drafts, not stable releases. The walkthroughs below use fictional evidence; the README also links a real
model of Waxwing itself.

For many workflows, publish separate linked pages with a generated contents page:

```sh
node bin/waxwing.mjs build-site /path/to/model.json /path/to/export
# Try the included example:
npm run demo:site
```

Open `export/index.html`. The source files can live anywhere; the generated
`graphs/`, `workflows/`, `documents/`, `assets/`, and `source/` structure is fixed.
Move/publish the whole directory. See the [publishing rules](site-export.md)
and [three-workflow demo](../examples/multi-page/README.md). Existing `build` still
produces a single self-contained HTML, SVG, and JSON 2.

## Give your agent one file

Use **[AGENT_GUIDE.md](../AGENT_GUIDE.md)** as the complete external handoff for
constructing JSON 1 or running the pipeline. It includes a copyable kickoff,
all supported source contracts, evidence/uncertainty rules, subgraphs, workflows,
sequence loops/alternatives, Markdown links, complete executable examples,
CLI/API commands, and troubleshooting. No other Markdown file is required.

Give the agent that file, access to your system sources, the Waxwing checkout
path, an output directory, and the reading question. Choose whether it should
stop at JSON 1 or build the diagrams. The specialized documents below remain
available for focused reference and implementation history.

## Try it

With Node.js 20.19.0 or newer:

```sh
npm ci
npm run demo
```

Open [the generated HTML](../examples/subgraphs/generated/diagram.html)
directly in a browser; it needs no server or account. Click a node, edge, group,
or open question to inspect its claims and sources. Use **100%** for readable
text and scroll to pan, or **Fit** for an overview. The viewer includes dark
and light themes and downloads for JSON 1, JSON 2, and SVG. Use **Highlight** to
inspect direct relationships, operation types, and recorded uncertainty;
**Readability** reports potential visual ambiguity. The **Style** selector offers
Standard, Engineering, and Editorial skins. See the [viewer rules](viewer.md)
for exact warning thresholds, highlight behavior, and styling boundaries.

The default demo includes **two graph levels and an attached Markdown document**
in that one HTML file. Try this short walkthrough:

1. Select **Order Processing**, then **Explore Inside Order Processing** to
   open the subgraph with its API, queue, worker, and database.
2. Select **Documents** in the header, then **Reading the two levels**. Its links
   navigate back into either graph and to specific nodes and relationships.
3. Return to the overview and select **Repair order**. Its inspector includes
   the attached document and the disputed correspondence in the child graph.

Start with the [complete fictional demo](../examples/subgraphs/README.md), its
[JSON 1](../examples/subgraphs/model.json), or its
[generated JSON 2](../examples/subgraphs/generated/layout.json).
The original single-graph example remains available with `npm run demo:basic`.

## Attach Markdown documents

Documents can attach to a node, an edge, or the graph. Keep `.md` files in your
existing folders, register their paths and attachments in the model, and build:

```sh
node bin/waxwing.mjs build examples/documented-orders/model.json examples/documented-orders/generated --group system-structure
```

Open [the document example](../examples/documented-orders/generated/diagram.html).
Select **Documents**, or select Order Worker and open its attached guide. The
HTML includes all registered Markdown and supported local images; it does not
need the source folders to display them.

The [document and linking rules](documents.md) define exactly what to expect:

- No required directory layout. Registration paths are relative to the model;
  links inside Markdown are relative to that Markdown file.
- Register each local document explicitly. The tool generates navigation from
  typed references; no HTML route configuration is needed.
- Missing destinations, broken headings, and unsupported local assets fail the
  build. Raw HTML is literal text, and remote images do not load automatically.
- Edit files and regenerate. Exported content is a complete snapshot, including
  original Markdown and resolved links.

Single-graph documents use JSON 1 `0.3-draft` and JSON 2 `0.2-draft`.
Subgraphs use JSON 1 `0.4-draft` and JSON 2 `0.3-draft`. Older models remain supported.

## Explore different abstraction levels

```sh
npm run demo:subgraphs
```

Open [the subgraph example](../examples/subgraphs/generated/diagram.html). Select
Order Processing and explore its detailed graph. Breadcrumbs return to the
overview. The child shows one known correspondence, an unknown internal payment
caller, and a disputed administrative route; none is silently resolved.

Graphs select components and relationships from one shared registry, explicitly
distinguish internals from external context, and record how parent edges map to
detailed edges. Documents work at every level. The [subgraph rules](subgraphs.md)
cover identity, scope, mappings, references, grouping, and current limits.

## Follow repeated participation through architecture

```sh
npm run demo:workflow
```

Open [the orchestration demo](../examples/orchestration/generated/diagram.html).
Use **View** to switch from connectivity to the explicit checkout workflow:
Checkout → Orchestrator → Stock → Orchestrator → Pricing → Orchestrator → Payment.
The three Orchestrator appearances share **one canonical component**. Select one
for its participation and evidence; the attached Markdown links both views and
a reply. **Workflow entry & order** shows the scoped start and unknown trigger.

This uses JSON 1 `0.5-draft` and JSON 2 `0.4-draft`. Deterministic code derives
appearances from explicit source interactions; ELK places them. Replies refer
to their requests without inventing reverse dependencies. The first version
supports one continuous linear scenario, with readable 100% zoom and scrolling.
The wider path is a tradeoff; **Fit** is an overview, not always readable text.
See the [workflow contract](architecture-workflows.md),
[reproduction and measurements](../examples/orchestration/README.md), and
[layout warning signs](layout-warning-signs.md).

## Try a basic sequence diagram

```sh
npm run demo:sequence
```

Open [the sequence demo](../examples/sequence/generated/diagram.html): Checkout
times out, payment succeeds, then Checkout retries. It includes five individually
identified steps, order evidence, an explicit unknown about retry handling, and
attached Markdown. Messages, replies, and local events have defined meanings.

Sequence JSON 1 describes one scenario with an explicit order claim. It is not
generated by rearranging architecture dependencies. Unknown/disputed ordering
is retained as valid source; the basic renderer reports a limitation instead of
choosing an order. See the [sequence contract](sequence.md) and
[ingestion prompt](../prompts/ingestion/sequence.md).

To describe loops and alternative paths in current behavior:

```sh
npm run demo:sequence:markets
```

Open [the market collector demo](../examples/sequence-markets/generated/diagram.html).
For each market, it chooses a live or closing quote, then saves the selected
quote. A nested **IF / ELSE** frame shows the alternatives inside a **LOOP**
frame; completion appears after the loop. Select a block header for evidence,
explicit unknowns, and attached Markdown. See the
[behavior contract](sequence-behavior.md) for the source format and limits.
Both existing demos remain: `npm run demo` builds the architecture with subgraphs
and documents, and `npm run demo:sequence` builds the single retry scenario.

Both sequence demos declare **where their scoped workflow starts**, with an
explicitly unknown upstream trigger. The entry participant is placed leftmost
and the starting step is marked. Select **Workflow entry** to inspect the evidence.
Other columns do not imply execution order. The [entry rules](sequence-entry.md)
cover unknown/disputed entries and compatibility with models that omit this field.

## Explicit entry and exit points

To construct JSON 1 from code, existing documents, and human clarification,
start with the [single-file agent guide](../AGENT_GUIDE.md). It provides the
copyable kickoff, complete authoring rules, and pipeline commands in one place.
It uses the existing schema and validator; there is no built-in crawler or
`ingest` CLI command yet.

```text
Your own producer
       |
       v
    JSON 1 ── model validation
       |
  automatic layout
       |
       v
    JSON 2 ──────────────────> your own renderer
       |
  deterministic rendering
       |
       v
    SVG / HTML
       |
  source recovery
       |
       v
    complete JSON 1
```

| Entry point | Responsibility |
|---|---|
| `@isought/waxwing/model` | Validate JSON 1 without laying out or rendering. |
| `@isought/waxwing/documents` | Load registered Markdown files and assets into complete JSON 1. |
| `@isought/waxwing/graphs` | Inspect graph selections and adapt a graph for layout. |
| `@isought/waxwing/layout` | Generate and validate JSON 2; ELK supplies automatic geometry. |
| `@isought/waxwing/render` | Render a valid JSON 2 without running the layout engine. |
| `@isought/waxwing/artifacts` | Extract embedded JSON 2 and recover JSON 1. |
| `@isought/waxwing/site` | Render, write, and recover a fixed multi-page export with automatic navigation. |
| `@isought/waxwing/collection` | Package separate models or existing sites with a parent page, shared search, and explicit reading links. |
| `@isought/waxwing/query` | Search, inspect, and retrieve bounded model relationships/workflows with scope and evidence. |
| `@isought/waxwing/skill` | Install the authoring/update skill in an explicit destination, bound to this runtime and its contract. |
| `@isought/waxwing/workflow` | Inspect architecture workflow scope, participation, and drawing blockers without loading ELK. |
| `@isought/waxwing/sequence` | Independently validate, lay out, and render a sequence scenario or structured behavior. |
| `@isought/waxwing/analysis` | Analyze supplied JS/TS source strings into a source snapshot (development preview). |
| `@isought/waxwing/scan` | Discover local repository files and write/load source snapshots. |
| `@isought/waxwing/source` | Validate, query and project source navigation without loading the compiler. |
| `@isought/waxwing/source-view` | Render standalone source-specific file/function navigation HTML. |

These are subpath exports of one npm package. They can be imported
independently; separately published packages are not part of the initial release. See
[module usage](modules.md) for JavaScript examples.

## CLI

Each stage can also run as a separate command:

```sh
node bin/waxwing.mjs validate examples/order-processing/model.json
node bin/waxwing.mjs layout examples/order-processing/model.json /tmp/layout.json --group system-structure
node bin/waxwing.mjs check-layout /tmp/layout.json
node bin/waxwing.mjs render /tmp/layout.json /tmp/diagram.svg
node bin/waxwing.mjs render /tmp/layout.json /tmp/diagram.html
node bin/waxwing.mjs recover /tmp/diagram.html /tmp/recovered-model.json
```

Layout defaults to a flat diagram with no grouping. `--group` explicitly selects
a named model perspective; only established memberships in established groups
become enclosing frames. Other claims remain available in the inspector and
embedded model. `--direction RIGHT|DOWN` changes placement, not relationships. Workflow views
follow their explicit source order in that reading direction.

For an architecture reading starting point, add `--anchor graph-id=node-id` to
`layout`, `build`, or `build-site` (repeat for different views). For example,
`--anchor services=orchestrator` puts Orchestrator first in the multi-page demo's
connectivity view. This is a presentation preference; all operation arrows and
source claims remain intact. See [reading anchors](reading-anchors.md) and
the [before/after experiment](../experiments/reading-anchor/README.md).

Agent-facing setup and retrieval (`init`, `doctor`, `detach`, `discover`,
`context`, `read`) are described in [agent entry](agent-entry.md).

## What is preserved

JSON 1 holds system facts, qualified interpretations, provenance references,
scope, and abstraction. Unknowns and disputes are valid content. It contains no
coordinates.

JSON 2 contains the **complete JSON 1**, its digest, and geometry linked by
semantic IDs. Validation checks model preservation, element coverage, edge
direction, authorized grouping, and basic geometry. SVG and HTML carry the
same JSON 2 payload for recovery. Key order and whitespace may change during
serialization; the parsed JSON 1 value is preserved.

Validation checks structure and internal consistency. It does not establish
whether supplied sources are truthful, current, or complete. A digest is not
an authenticity signature, and source recovery does not certify that someone
has not edited an exported SVG's visible markup.

## MVP boundaries

- Current implementation only; no future-state topology.
- Source ingestion is currently an [agent prompt workflow](../prompts/ingestion/README.md),
  with investigation, a checklist, and human clarification. An automated ingestion
  service and real-system evaluation are not implemented yet.
- No visual editing, automatic factual repair, or live infrastructure discovery.
- Subgraph mappings preserve boundary operations; arbitrary internal workflow
  correspondence and recursive graph-file loading are not implemented.
- Layout and rendering use deterministic code; neither calls an LLM.
- Geometry uses conservative text metrics. Validation can reject difficult
  layouts; it does not silently omit or rewire content to make them fit.

## Development and documents

[Release notes](../CHANGELOG.md) describe the 0.2.0 release.
[Upgrade and migration instructions](migrations.md) explain when to
re-render, rebuild, or recover an existing spec. Software releases and schema
versions are tracked separately; software 0.2.0 uses experimental draft formats.

```sh
npm test
```

- [Philosophy](../philosophy.md): semantic reconstruction, honesty, and portability.
- [JSON 1](json-1.md): the current model contract and review decisions.
- [Ingestion prompts](../prompts/ingestion/README.md): construct JSON 1 from sources,
  with explicit qualifications and an evidence review.
- [JSON 2](json-2.md): geometry, preservation, and recovery.
- [Modules](modules.md): import paths, CLI, and extension boundaries.
- [Viewer](viewer.md): advisory warnings, semantic highlighting, and skins.
- [Architecture workflows](architecture-workflows.md): repeated participation with canonical identity.
- [Layout warning signs](layout-warning-signs.md): patterns to investigate, without an automatic tool switch.
- [Sequence diagrams](sequence.md): basic scenarios, explicit ordering, and current limits.
- [Design](../design.md): broader direction and deferred work.
- [Third-party dependencies](../THIRD_PARTY_NOTICES.md).
- [Verification and browser limitations](verification.md).
- [Pipeline reading experiment](../experiments/pipeline-reading/README.md): a reproducible comparison of dependency placement and processing order, including the width tradeoff.
- [Current layout decision](decisions/001-deterministic-layout.md): keep JSON 1 → JSON 2 deterministic, with criteria for revisiting the choice.
- [Documents](documents.md): implemented Markdown authoring, attachment, reference, and export rules.
- [Subgraphs](subgraphs.md): implemented abstraction levels and boundary mappings.
- [Original documents/subgraphs proposal](documents-and-subgraphs.md): historical design discussion.

Archify remains a design reference for structured specifications, SVG/HTML
presentation, and validation. No Archify code has been copied into this MVP.

The source preview now includes a focused static graph and an optional connected
site: system component/operation → relevant source entry → exact evidence and
recorded rationale → original system context. Direct source browsing remains
available without a system mapping. See [source scanning](source-scanning.md).

The source explorer now offers a recommended internal-call graph, an occurrence
view, grouped evidence and expandable other calls. A browsing trail and browser
history preserve exploration context, including service-to-source return links.
See [source scanning](source-scanning.md#reading-and-navigating-source).

The hybrid scanner retains JS/TS compiler bindings and adds tested Tree-sitter
syntax profiles for Kotlin, Java, Python, Go, Objective-C, SQL, JSON, Bash, C,
C++, C#, Rust, Ruby and Swift. `.mm` has only the Objective-C surface; Lean is
still unsupported. File coverage identifies the backend and capabilities.
Syntax-only targets remain unresolved; the viewer shows observed occurrences
and extracted declarations. See the [coverage table](source-scanning.md).
