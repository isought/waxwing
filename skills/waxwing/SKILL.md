---
name: waxwing
description: Investigate repository behavior and system flow using available Waxwing project knowledge, with bounded context and verifiable evidence. Also create or update evidence-backed Waxwing architecture and sequence diagrams from repositories, documents, or an existing model, then validate and build inspectable artifacts, including collections of separate models.
---

# Waxwing explanations

Turn the user's reading question into a scoped explanation with inspectable
evidence. Choose organization/system architecture, service architecture with
workflows, or a sequence scenario according to the question. Reuse existing
models and canonical IDs when available.

## Runtime and contract

Use this installed skill's `scripts/waxwing.mjs` adapter for commands. Resolve
its path relative to this `SKILL.md`, then invoke it with Node from the user's
working directory. Examples below use `<skill>` for that absolute directory.

```sh
node "<skill>/scripts/waxwing.mjs" check
node "<skill>/scripts/waxwing.mjs" guide basics
```

The adapter uses the package that installed this skill, not an arbitrary CLI on
PATH. If its runtime check fails, follow its reinstall instruction. Do not claim
validation or building succeeded when the runtime is unavailable.

Load `basics`, then only the relevant topics:

| Need | `guide` topic |
|---|---|
| Components, relationships, scoped drill-down views | `architecture` |
| Ordered interactions sharing architecture components | `workflows` |
| One independent interaction scenario | `sequence` |
| Sequence loops or alternatives | `behavior` after `sequence` |
| Exact complete JSON example | `example-architecture`, `example-scenario`, or `example-behavior` |
| Registered Markdown and attachments | `documents` |
| Build options, recovery, or troubleshooting | `pipeline` |
| Several independent models under one home page | `collections` |
| Consult existing knowledge in bounded pieces | `queries` |
| Locate evidence and related models across folders, repositories, or hosted documents | `workspace` |
| Context/read statuses, budgets, discovery and project setup | `agent-entry` |

`guide list` shows the topics and their sizes. These excerpts come directly from
the bound package's complete guide/docs, so schema details are not maintained
twice. Example systems are fictional; use their field shapes, not their facts.

## Choose the workflow

- For a question about why or how the repository behaves, read
  [references/investigate.md](references/investigate.md). Start with one bounded
  `context` lookup; an investigation does not require creating a diagram.
- For a new explanation, read [references/create.md](references/create.md).
- For changes to an existing model or artifact, read
  [references/update.md](references/update.md).

Infer a sensible initial question, level of detail, and output location from the
request and project conventions when unspecified. State meaningful assumptions;
ask only when an unresolved choice materially changes the explanation or access.
An organization is not necessarily one repository, nor is a service. Follow
the user's requested scope without requiring a code scanner.

Keep evidence, interpretation, unknowns, and disputes distinct. Connectivity does
not establish chronology. Folder names and imports are investigation leads, not
proof of deployment, ownership, or a network operation. Existing sources explain
current behavior; historical intent and future proposals require their own basis.

Deliver the source model, requested artifact, and a brief account of the question
answered, evidence inspected, unresolved gaps, and actual validation/preview
results. Open the artifact through an available local preview/file tool. A
successful build is not a publication request or proof that the explanation is true.
