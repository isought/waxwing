# Investigate repository behavior

Use this when the user asks why or how the project behaves: an API result, an
error, a workflow step, a dependency, or where something is implemented. The
goal is a supported answer, not a diagram. Do not start authoring a model unless
the user asks for an explanation artifact.

## Look up concrete names and locations

`context` is a lookup, like grep over recorded knowledge: it matches the text
you give it, not the meaning of a question. Do not pass the user's sentence.
First turn the question into concrete terms — a function, class, file, component
or workflow name — or a `path:line` you found with grep, a stack trace or an
error report.

```sh
node "<skill>/scripts/waxwing.mjs" context --term CheckoutService --format json
node "<skill>/scripts/waxwing.mjs" context --at src/checkout/service.ts:118 --format json
```

- `--term <text>` (repeatable) matches recorded IDs, names and file paths, and
  the titles and text of authored models, case-insensitively. Exact matches rank
  first. It does not search inside source file contents; grep does that.
- `--at <path:line>` (repeatable; `path:line:column` also works) returns the
  innermost recorded function, class or method spanning that line, and its file.
  Paths are project-relative or absolute.

Typical flow for text that only exists inside code, such as a command name or an
error message: `grep -rn "build-site" src`, then `context --at <printed path:line>`.

Use `--source <key>` to select one reported source, and `--budget <bytes>` to cap a
response (no cap by default).

Act on `status`:

| Status | Meaning and next step |
| --- | --- |
| `context_found` | Candidates matched. Read the most relevant `ref`s; check each `matchBasis`. |
| `needs_scope` | Matches span several sources. Retry once with `--source` or a more specific term. |
| `no_match` | Nothing recorded matched. Pick a name from `vocabulary` or the code and retry once, or continue with normal tools. A miss is not proof of absence. |
| `no_context` | No readable knowledge artifacts. Continue with normal tools. |
| `unsupported_input` | Artifacts exist but this runtime cannot read them. Continue with normal tools. |
| `budget_too_small` | Only with `--budget`: retry with the reported budget, or omit it. |

Do not repeat an unchanged failed lookup. Do not run a repository scan just to
satisfy this workflow; scanning is optional and needs the user's authorization
when it creates new files.

## Read progressively

```sh
node "<skill>/scripts/waxwing.mjs" read <ref> --format json
```

A read returns the selected record, related references, recorded evidence and
existing view links. For source records it returns an excerpt only when current
bytes match the scanned file (`source-byte-verified`). Otherwise it reports
`changed` or `unavailable` with a recovery action. A `stale_reference` means the
artifact changed; use `currentRef` when offered or repeat `context`. Follow
`nextActions` for continuation lines. Each `nextActions` entry is data
(`operation`, `arguments`, `options`), not a shell command to paste unchanged.

## Keep claims honest

- `matchBasis` explains retrieval, not relevance or causation.
- Recorded models carry their own qualifications. Static references and recorded
  connectivity are not execution order or runtime proof.
- Check `scope`, `freshness` and `limitations`. A snapshot at a different commit
  may not describe the current code; a requested revision is never substituted.
- Verify consequential claims in the source or with a runtime check, and report
  what you verified versus what you inferred.
