---
name: waxwing
description: Investigate repository behavior and system flow using available Waxwing project knowledge (architecture and sequence models, source snapshots, documentation), with bounded context and verifiable evidence. Also create or update evidence-backed Waxwing architecture and sequence diagrams when the user asks for an explanation artifact.
---

# Waxwing project knowledge

This project skill uses the `waxwing` command installed on this machine
(`{{install}}`). It requires integration protocol `{{protocol}}`; run
`waxwing doctor --format json` if a command below is missing or reports an
incompatible version. Do not claim that validation, context retrieval or a build
succeeded when the runtime is unavailable.

## Investigate behavior

For questions about why or how the repository behaves, read
[references/investigate.md](references/investigate.md). `context` matches
explicit names and locations; it does not interpret English questions. Turn the
question into concrete terms first (reading code or grepping if needed):

```sh
waxwing context --term <name> --at <path:line> --format json
waxwing read <ref> --format json
```

If context is unavailable or irrelevant, continue with normal tools. An
investigation does not require creating a diagram.

## Create or update an explanation

Only when the user asks for an explanation artifact, load contract topics on
demand with `waxwing guide <topic>` (start with `basics`; `guide list` shows all):

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
| Evidence and related models across folders or repositories | `workspace` |
| Context/read statuses, budgets, discovery and project setup | `agent-entry` |

- For a new explanation, read [references/create.md](references/create.md).
- For changes to an existing model or artifact, read
  [references/update.md](references/update.md).

Keep evidence, interpretation, unknowns, and disputes distinct. Connectivity does
not establish chronology. Folder names and imports are investigation leads, not
proof of deployment, ownership, or a network operation. A successful build is not
a publication request or proof that the explanation is true.
