# Use project knowledge from your coding agent — development preview

Waxwing can make the knowledge a repository already has usable by the coding
agent you already run. `init` registers a short project instruction block and a
portable skill for Codex or Claude Code. The agent can then ask a bounded
`context` lookup by name or location and `read` selected records or verified source excerpts,
instead of being handed a directory map.

No command here calls an LLM, fetches remote content, runs a scan, or executes
repository code. Writing files does not prove that an agent session loaded or
followed them. This preview is not in the published `0.2.0` release.

## Set up a project

Every teammate installs a compatible runtime once. Committed project files do
not install npm packages.

```sh
npm install -g @isought/waxwing
cd /path/to/your/repository
waxwing init --agent codex --agent claude --dry-run
waxwing init --agent codex --agent claude
waxwing doctor --format json
```

`init` changes only the selected project. It resolves `--project`, otherwise the
enclosing Git worktree root (including file-based `.git` worktrees), otherwise
the current directory, and prints the chosen root. Select only the hosts you use.

| Host | Instruction block | Project skill |
| --- | --- | --- |
| Codex (`--agent codex`) | `AGENTS.override.md` when present at the root, otherwise `AGENTS.md` | `.agents/skills/waxwing/` |
| Claude Code (`--agent claude`) | Existing `CLAUDE.md` or `.claude/CLAUDE.md`; creates `CLAUDE.md` when neither exists | `.claude/skills/waxwing/` |

The block is under 1 KB, marked with `<!-- waxwing:begin -->` and
`<!-- waxwing:end -->`, and appended while preserving the file's existing bytes
and line endings. The skill invokes `waxwing` on PATH rather than an absolute
package path, so the files can be committed. `.waxwing/integration.json` records
the template version and hashes of the managed content so another machine can
upgrade or detach safely; commit it with the other files.

Waxwing plans every write before applying any. It stops with a conflict, writing
nothing, when:

- the managed block or a skill file was edited, or markers are unbalanced;
- an instruction file is a link leading outside the project;
- a package-bound skill from `waxwing skill install` already occupies the directory;
- the result would exceed Codex's default 32 KiB project instruction limit.

A symlinked `CLAUDE.md` → `AGENTS.md`, or a `CLAUDE.md` that imports `@AGENTS.md`,
receives one shared block. Repeated `init` with the same runtime is a no-op;
a newer template replaces unchanged managed content. `--dry-run` prints the
file list and diff. Multi-file changes are staged with a journal; a failed or
interrupted run is rolled back before the next `init` or `detach` continues.

```sh
waxwing detach --agent claude --dry-run
waxwing detach --agent claude
```

`detach` removes only unchanged managed blocks and files, and reports edited
content it left in place. It never removes models, scans, sites, Graphify output
or `.waxwing/config.json`.

`doctor` reports separately: Node and runtime version, which `waxwing` commands
are on PATH and whether they are this runtime, per-host instruction and skill
state (`installed`, `not-installed`, `modified`, `shadowed`,
`potentially-shadowed`, `stale-template`, `package-bound`), readable knowledge,
problems and repair commands. Host uptake is always `untested`; start a new agent
session after changing these files.

The existing explicit `skill install` mode, bound to one package location, remains
available for personal installations.

## Look up names and locations

```sh
waxwing context --term CheckoutService --format json
waxwing context --at src/checkout/service.ts:118 --format json
waxwing read <ref> --format json
```

`context` is a lookup over recorded knowledge, closer to grep than to a search
engine. It does not accept or interpret a question; the agent turns the question
into concrete input:

- `--term <text>` (repeatable) matches, case-insensitively, a record ID, a name or
  title, a file path ending, part of a name or path, or authored model text.
  Exact matches rank first. File contents are not searched.
- `--at <path:line>` (repeatable; `path:line:column` accepted) returns the
  innermost recorded function, method, class or other type spanning that line,
  then its file. Paths may be
  project-relative, absolute, or a trailing part of the recorded path.

At least one `--term` or `--at` is required. Text that exists only inside code,
such as a CLI command name or an error message, is found with grep first and then
looked up with `--at`. Each candidate reports its `matchBasis`; a match is not
evidence that the record explains the behavior.

Other options: `--source` (a source key or recorded ID, repeatable), `--workspace`
adds a workspace manifest, and `--output <file>` writes the packet for handoff.

| `status` | Meaning |
| --- | --- |
| `context_found` | Candidates matched; `nextActions` suggests reads. |
| `needs_scope` | More than 20 matches across several sources; select `--source` or use a more specific term. |
| `no_match` | Nothing matched; `vocabulary` lists recorded names. A miss is not proof of absence. |
| `no_context` | No readable knowledge artifacts; `searched` shows what was checked. |
| `unsupported_input` | Only unreadable formats, such as Graphify, were found. |
| `budget_too_small` | Only with `--budget`: the response cannot fit; retry with `minimumOutputBytes` or more. |
| `record_found`, `stale_reference` | Results of `read`. |
| `invalid_request`, `runtime_error` | Printed to stderr with exit status 1. |

References (`wx1.…`) are opaque, integrity-checked and bound to their source
location and revision. After the artifact changes, `read` returns
`stale_reference`, with `currentRef` when the record still exists.

`read` returns the record, related references (relationships, workflows and steps
for models; declarations, incoming references and outgoing call occurrences for
source), recorded evidence, and links to existing site pages when a built site
contains the same model. Documents and source excerpts are returned in whole lines;
use `nextActions` with `--from-line` to continue. Source excerpts are labeled `source-byte-verified` when the current bytes equal the
scanned digest. When the file has changed since the scan, `read` still returns the
current lines at the recorded location, labeled `unverified-current-file`; the
declaration may have moved, so rescan to verify again. The source root is
`--source-root`, then `sourceRoots` in the project configuration, then the project
root. Missing and skipped files report `unavailable` with a recovery action, and
the record stays readable.

`nextActions` entries are `{operation, arguments, options}` data. Arguments come
from artifacts and must not be pasted into a shell as unquoted text.

### Budgets

Responses are not capped by default. `--budget <bytes>` (range 1024–1048576)
optionally bounds the **entire UTF-8 response**, including metadata. Whole items
are dropped rather than shortened; `budget.truncated` and `budget.omitted` report
what was left out, and `read` offers `--from-line` to continue. This is not a
token count. `context` still returns at most 20 lexical candidates per request.

## What is discovered

Discovery is read-only and bounded (file count, sniffed bytes, artifact size and a
time budget). It reports what it searched, how each source was registered, and
per-source status: `available`, `duplicate`, `invalid`, `unavailable`,
`unsupported`, `not-indexed` or `skipped`.

- Registered first: `--workspace`, and `.waxwing/config.json` `workspace` and
  `artifacts`. Explicit registration may include ignored or external locations.
- Conventional: JSON files whose `schemaVersion` identifies a Waxwing model,
  source snapshot, workspace, site manifest or collection. In a Git worktree this
  uses `git ls-files` and respects ignore rules; otherwise a bounded walk skips
  dependency and build directories and nested repositories.
- Workspace manifests add their local models. Site manifests link their pages to
  any model with the same digest. Byte-identical model copies collapse into one
  source. Layout JSON and collections are listed but not indexed.
- `graphify-out/graph.json` is recognized and reported as `unsupported` in this
  version; reading it is planned.

```json
{
  "schemaVersion": "0.1-project-config",
  "workspace": "docs/workspace.json",
  "artifacts": ["/shared/knowledge/checkout-scan.json", ".internal/model.json"],
  "sourceRoots": { "checkout-app": "../checkout-at-scan" }
}
```

Discovery identifies data sources; it does not establish relevance, authority or
current behavior. A scan output must still be written outside the scanned tree.

## Measurement

Every protocol response includes `measurement` (durations, source counts, output
bytes). Setting `WAXWING_MEASUREMENT_LOG=/path/to/file.jsonl` appends a local
record of operation, status and measurement for each call. Terms, locations,
references and source text are not recorded, and nothing is sent anywhere.

## Not yet included

- Reading Graphify graphs and other foreign formats.
- A cache for large snapshots; each call loads and validates artifacts.
- Evaluation of whether host sessions discover the skill and whether answers improve.
- MCP transport, hooks that enforce lookups, persistent investigation state and
  shared findings.
