# Release notes

Software versions and experimental schema versions are tracked separately.

## Unreleased

- Render concurrent collection loops for per-item fanout, showing one iteration's
  ordered body with an explicit overlap cue. Unknown or disputed execution remains blocked.

## 0.2.0 — 2026-09-11

- Publish under `@isought/waxwing`, with repository and documentation links pointing
  to `isought/waxwing`. The terminal command remains `waxwing`.
- Update the installed skill runtime check to recognize the new package scope.
- Upgrade instructions: [move from the old npm scope](docs/migrations.md#npm-scope-change-in-020).
  Existing diagram sources need no format migration for this release.

- Explicit workspace lineage registers evidence and model elaboration across
  local paths, separate repositories, and hosted locators. `workspace check`
  validates declarations and local model targets; `workspace affected` produces
  JSON or Markdown review queues with reasons and access/reference gaps.
- The authoring/update skill can consult workspace lineage and record scoped
  review outcomes across abstraction levels. No remote fetching, automatic
  freshness certification, diagram schema change, or model edits are implied.

- `skill install` packages a concise authoring/update skill with explicit
  destination ownership checks and a binding to the supplying Waxwing runtime.
- The skill loads contract sections on demand, preserves a baseline during
  updates, and reports added/removed/changed IDs before rebuilding. Its adapter
  rejects changed or unavailable runtimes instead of silently switching versions.

- `build-collection` packages independent models or existing sites under a shared
  home page, with explicit record/view links and complete per-model recovery.
- Local full-content search across records and document sections, including
  collection-wide results, contextual excerpts, and precise destinations.
- Site starting pages, complete record catalogs, hierarchy breadcrumbs, and
  component-to-workflow links; browser history retains diagram view state.
- Architecture views fit on arrival, with readable component navigation beside
  small overviews and full-size detail on selection.
- Bounded `query` CLI/module operations for search, inspection, neighbors, and
  workflows with scope, revision, qualifications, and evidence.

- A quieter opening view with grouped exports and compact diagram controls.
- Architecture cards show qualified roles and authored description previews;
  qualified or absent existence stays explicit.
- Selecting architecture components emphasizes direct connections and opens
  descriptions, detailed views, and expandable evidence in the inspector.
- Site uncertainty filters include related notes and memberships. Selection
  from Fit opens at readable zoom while preserving explicit manual zoom choices.
- Existing source models, layout coordinates, and recovery contracts are unchanged.

## 0.1.0 — 2026-09-09

First release. Install with `npm install -g @felixfelicis/waxwing@0.1.0`.

### Project and distribution

- MIT license, contributor instructions, bug template, and public roadmap.
- Clean-install CI and isolated npm package smoke checks.
- A source-backed example of Waxwing itself, with a static demo deployment workflow.
- Runtime assets, authoring guide, and example sources included in the npm package.

### Available functionality

- Validate system models, generate layouts, and export inspectable SVG/HTML.
- Architecture views, subgraphs, explicit workflows, and sequence diagrams with
  loops and conditionals.
- Attached Markdown documents and linked multi-page exports.
- Complete source recovery from supported single-file artifacts or a complete
  multi-page export directory.

### Latest improvements

- Zoom keeps the reading area centered in the architecture and site viewers.
- Details reserve a column on desktop and appear in page flow on narrow screens.
- Sequence diagrams name their declared start, mark it visibly, and offer
  **Go to start** at 100% zoom.
- Architecture generation accepts a per-view `--anchor graph-id=node-id` reading
  preference, with a visible cue and **Go to starting node** navigation.
- Before/after anchor comparisons document the tradeoff between foregrounding a
  component and keeping the layout compact.

### Compatibility and migration

**No source migration is required for currently supported specs.** Existing
specs need no starting-node field to keep working. Sequence entry is an optional
source claim; architecture anchors are generation options recorded in JSON 2.

Re-render saved JSON 2 to adopt viewer improvements while keeping coordinates.
Rebuild from JSON 1 to adopt layout changes or choose architecture anchors.
See the [upgrade instructions](docs/migrations.md) for commands and recovery.

These formats are still experimental drafts. Older Waxwing checkouts may reject
JSON 2 containing the new optional `layout.readingAnchorRef`. Keep the previous
export when evaluating an upgrade. Anchor placement can make diagrams wider or
taller; see the [comparison evidence](experiments/reading-anchor/README.md).

### Checks

The implementation snapshot `6ea6db0` passed all 213 tests. Browser checks covered
anchor navigation, reload, inspector layout, and narrow screens. These checks
do not establish better human comprehension for arbitrary architecture graphs.

## Maintaining these notes

For a release, replace **Unreleased** with its version and date, update the
package version and lockfile, run the checks, and tag the tested commit. Start a
new Unreleased section for later work. A versioned release entry should state
whether migration is needed and link to its exact instructions. Preserve old
entries and release tags; corrections should be explicitly identified.
