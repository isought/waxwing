# Source analysis boundary

`index.mjs` routes supplied source strings through the tested language registry.
`javascript.mjs` uses the pinned TypeScript compiler with a closed in-memory host.
`tree-sitter.mjs` shares parsing/traversal/records across grammar-specific rules in
`tree-sitter-profiles.mjs`. Each analyzed file records its backend and capabilities.
See the [scanner guide](../../docs/source-scanning.md) for the coverage table.

Analysis depends on `knowledge` and remains usable without presentation or a
conversation. Application APIs own repository discovery; analysis reads only
supplied source strings and its installed parser assets. Unknown languages stay
skipped. A grammar being installed does not enable a profile automatically.

Before adding further adapters, extend concrete fixtures for snapshot identity,
declarations, reference occurrences, resolution results and coverage. Syntax
recognition, resolved relationships and semantic verification must be reported
separately. An unresolved reference is a retained observation, and unsupported
syntax or incomplete coverage must be visible rather than treated as absence.
An import/reference occurrence does not automatically establish runtime behavior.

Code and proof records use specialized contracts. Their mappings to
architectural explanations must be explicit and may be many to many. Code
identity must survive changes to display labels and reading views; identity
across source revisions needs an explicit matching/review policy. The current
source draft binds occurrence IDs to file digests/ranges. Optional architecture evidence mappings exist; cross-revision continuity still
requires explicit review.

## Initial targets

- Kotlin and Java.
- Python, JavaScript, TypeScript and Go.
- Objective-C and Objective-C++.
- SQL, JSON and shell scripts.
- **Lean 4, from the first scanner release.**

SQL dialects, shell variants and the supported Objective-C++/C++ surface remain
open scope decisions. Evaluate available parsing and semantic tools against
small independently checked fixtures before claiming language support. Compare
coverage and relationship precision with the competitor on the same examples;
counting recognized extensions is not an acceptance criterion.

For Lean, evaluate elaborated declaration and proof information in addition to
syntax. Track what verification actually ran, unresolved/failed elaboration,
and relevant axioms or incomplete proofs. A referenced lemma is not necessarily
mathematically necessary. Supporting Lean must not imply that ordinary prose or
architectural claims have been proved.

Follow the [design principles](../../docs/design-principles.md): complete useful
machine work, expose evidence and limits, and ask humans for consequential gaps
in terminology, intended boundaries, goals and assumptions.
