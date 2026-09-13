# An installable authoring and update workflow

The `waxwing` skill helps an agent turn a reading question into a scoped
architecture or sequence explanation, validate it, build an artifact, and update
it later without starting from scratch. It uses the existing agent's source
access and reasoning. Installing it does not add a scanner or call an LLM.

## Install explicitly

For a committed, project-scoped setup that invokes `waxwing` on PATH, use
[`waxwing init`](agent-entry.md) instead. The explicit installation below binds
one personal skill directory to one package location.

With a Waxwing version that provides `skill install`:

```sh
waxwing skill install /path/to/your/agent/skills/waxwing
```

From this checkout:

```sh
node bin/waxwing.mjs skill install /path/to/your/agent/skills/waxwing
```

Pass the **complete destination skill directory**, not its parent. Choose the
skills location used by your agent, or an isolated directory if you want to
evaluate the workflow first. The command does not discover or alter global
agent configuration, install an npm package, or start a task. Follow your agent's
normal skill discovery/reload behavior after installation. Older published
Waxwing versions may not provide this command; use the matching checkout until
a release containing it is available.

The destination contains `SKILL.md`, creation/update references, agent metadata,
an adapter, the MIT license, and two small binding/ownership manifests. The
source skill under `skills/waxwing` is a packaging template; run the installer
instead of copying that directory without its generated runtime binding.

For an agent that supports named skill invocation:

> Use $waxwing to explain how this repository handles checkout. Start with the
> services, include a workflow, and build a site in a separate output directory.

For an update:

> Use $waxwing to update docs/system/model.json for the new payment retry
> behavior. Preserve the existing identities and rationale, explain what changed,
> and rebuild its site.

The skill chooses a model and scope from the user's question when those choices
are unspecified, preserving meaningful uncertainty. A diagram request normally
includes building and opening the result through the agent's available preview
tools. Source-only and proposal-only requests retain their narrower scope.

## Matched runtime and progressive contract loading

The installed adapter invokes the package that installed it, rather than whatever
`waxwing` happens to be on PATH:

```sh
node /path/to/your/agent/skills/waxwing/scripts/waxwing.mjs check
node /path/to/your/agent/skills/waxwing/scripts/waxwing.mjs guide list
node /path/to/your/agent/skills/waxwing/scripts/waxwing.mjs guide architecture
```

It checks the package location, version, and a content fingerprint of runtime
sources, schemas, skills, and documentation before execution. This also detects
changed checkouts that retain the same package version. It does not fingerprint
`node_modules`; dependency installation remains npm's responsibility. Fingerprints
detect mismatches, not publisher authenticity or correctness of the evidence.

Contract topics are extracted from the complete `AGENT_GUIDE.md`; query and
collection topics come from their maintained docs. The schema contract is not
duplicated in hand-maintained skill references. `guide list` reports available
topics and sizes, so an agent can load relevant sections rather than the whole
manual. Complete fictional examples remain available to demonstrate field shapes.

Moving the installed skill directory is supported. Moving, removing, or updating
its bound package requires reinstalling the skill with the intended package.
The adapter fails before running the requested operation on a mismatch and gives
the reinstall command. It does not fall back to another package or install one.

## Review an update

The workflow first preserves a resolved baseline with `prepare` or `recover`,
outside the generated output. Normal authoring JSON and file-backed Markdown
remain the ongoing inputs when available. After editing, it validates and runs:

```sh
node /path/to/your/agent/skills/waxwing/scripts/waxwing.mjs review-update /work/before.json /project/docs/system/model.json
```

The helper resolves and validates both inputs, then reports:

- Before/after model IDs and content revisions.
- Model identity, diagram type, scope, and other top-level field changes.
- Added, removed, changed, and unchanged record IDs, including workflow steps
  and changes to resolved document contents/assets.

This is an ID inventory, not a full semantic diff. It does not infer renames,
prove that reused IDs denote the same thing, or automatically apply changes.
An unnecessary rename appears as remove/add. The agent inspects those pairs and
explains intentional removals, migrations, and changed behavior using evidence.

Successful validation establishes structural consistency, not truth. The agent
still needs to inspect relevant sources and check that the artifact answers the
question. No empirical claim about unfamiliar-repository authoring quality is
made by the installer or its fixture tests.

## Reinstall and local edits

Run the same install command to refresh an unchanged managed skill. Installation
is staged and replaces the destination with rollback on installation failure.
A nonempty unrelated directory, modified/missing/extra skill files, or symlinks
are rejected before replacement. Preserve custom edits and choose another
destination instead of forcing an overwrite. The command cannot install inside
the runtime package or over a directory containing it.

No change to personal skills is made merely by installing the Waxwing npm
package. The explicit `skill install` command performs the filesystem write.

Module API: `installSkill(directory)` from `@isought/waxwing/skill`.

## Cross-model maintenance

The `workspace` guide topic explains how to locate sources and related models
across repositories and hosted documents. Supply a workspace manifest or link
one from project instructions. The skill uses `workspace affected` as a review
queue, preserves access gaps and task scope, and records evidence-based outcomes
in the update report. See [workspace lineage](workspace.md).
