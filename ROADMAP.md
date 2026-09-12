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
   workflows and interfaces. The [scanner preview](docs/source-scanning.md) now
   extracts JavaScript/TypeScript source records and bindings, with a focused
   source graph and optional links to authored explanations. Broader adapters,
   proof metadata, candidate mapping discovery and cross-revision review follow.
   [Initial release targets](modules/analysis/README.md) include Lean 4.

The published 0.2.0 release predates this scanner preview. No visual editor or
automatic infrastructure discovery is implemented. Features and limits are described
in the [README](README.md) and [release notes](CHANGELOG.md).
