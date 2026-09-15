# Author prompt: provisional application architecture notes

Investigate this repository's pricing, remaining-balance and checkout subsystem.
Write compact notes for a future coding agent investigating related behavior.
Use repository source, configuration and tests as evidence. Do not modify code.

Explain the workflow and connections between application concepts, including
important conditions and exceptions. Organize by workflow, but make individual
claims independently inspectable. Spend the word budget on facts that would be
expensive to reconstruct, especially consequential guards and alternate paths.
Do not produce an exhaustive symbol inventory or a transcript of your search.

For each consequential claim, include:

- **Claim:** one specific statement about behavior or structure.
- **Applies when:** scope, caller/configuration conditions and known exceptions.
- **Evidence:** repository-relative files and symbols, useful line anchors, and
  the inspected revision. Distinguish source inference from executed observations.
- **Challenge:** a concrete search, branch inspection, contrasting input or test
  that could contradict the claim. Say what observation would make it wrong.
- **Limits:** unresolved calls, unexamined integrations, or other uncertainty.

Actively look for counterexamples before finalizing a claim. For boundary
predicates, inspect exact operators and contrasting values. For statements about
all callers or writers, record the search scope and how to repeat that search;
links to existing callers do not establish that no others exist.

Use a short workflow overview to connect claims. Keep the whole document within
1,500 words. Preserve conditions before explanatory prose. If this budget cannot
cover the subsystem, state the omitted scope rather than implying completeness.

Treat every note as provisional. A check that finds no contradiction is limited
support, not proof. Do not claim tests ran unless you actually executed them and
recorded the command and result. Do not infer intended business policy solely
from current implementation. Do not invent evidence or executable checks.

Output only the proposed Markdown document, suitable for
`knowledge/checkout-notes.md`.
