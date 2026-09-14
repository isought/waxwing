# Roadmap

Waxwing is an early, personally maintained project. These priorities describe
direction, not promised dates.

1. **First public release — shipped.** [0.1.0](https://github.com/isought/waxwing/releases/tag/v0.1.0)
   includes verified installation, the agent guide, and a source-backed example
   of Waxwing itself.
2. **Real-world validation.** Have an unfamiliar developer try the workflow,
   then evaluate another public codebase. Record omissions and failure cases.
3. **Improvements from use.** Address authoring friction, diagnostics, and
   diagram readability revealed by those trials before expanding the feature set.
4. **Source analysis foundations.** Separate knowledge, presentation, application
   workflows and interfaces. The [experimental scanner](docs/source-scanning.md),
   included in 0.3.0, extracts JavaScript/TypeScript bindings and baseline
   Tree-sitter syntax for additional languages, with a focused source graph and
   optional links to authored explanations. Lean 4, full Objective-C++, proof
   metadata, candidate mapping discovery and cross-revision review are future work.
   See [coverage and future targets](modules/analysis/README.md).

Source scanning is experimental in 0.3.0. No visual editor or
automatic infrastructure discovery is implemented. Features and limits are described
in the [README](README.md) and [release notes](CHANGELOG.md).
