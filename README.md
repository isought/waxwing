# Waxwing

**Give your codebase an explanation people can explore.**

Your coding agent explains a system. Later, you need to retrace a workflow,
check a claim against the code, or help someone else understand it.
The answer is somewhere in the conversation.

With Waxwing, you and your agent can turn that explanation into an interactive
map: follow a workflow, look inside a component, and inspect the code references
behind a claim. Share it as an HTML file anyone can open in a browser.

**[Explore the demo →](https://isought.github.io/waxwing/graphs/overview.html)** ·
[Try it on your code](#try-it-on-your-code) · [Documentation](#go-deeper)

[![Waxwing's architecture overview — open the interactive demo](docs/images/waxwing-overview.png)](https://isought.github.io/waxwing/graphs/overview.html)

The demo explains Waxwing itself. Select **Layout engine**, inspect its source
references, then open **Inside architecture layout** to look closer. Switch to
[the build workflow](https://isought.github.io/waxwing/workflows/build.html) to
follow the steps from input to output. This is a curated explanation of
[a pinned source revision](examples/waxwing/README.md).

## Try it on your code

You need **Node.js 20.19.0 or newer** and a coding agent that can read your
repository and run terminal commands.

Install the published release:

```sh
npm install -g @isought/waxwing@0.3.0
```

Open your repository with your agent and give it one question. For a web service,
start with this prompt; replace the request question with something you want to
understand about your own project:

```text
Use Waxwing to explain how this repository handles an incoming request.

Run npm root -g, then read @isought/waxwing/AGENT_GUIDE.md inside the
printed directory. Use that guide and the installed waxwing command.

Inspect the relevant code. Map the main components and request workflow,
link claims to their supporting source, and leave unknowns explicit.
Validate the model, then use waxwing build to write the interactive HTML
diagram to ./waxwing-output.
Open the result, or tell me where to find it.
```

Open `waxwing-output/diagram.html`. Follow the request, select a component, and
check a source reference against the code. Share that HTML file when it answers
your question—viewers need no installation, server, or account. The file includes
the model and linked document contents, so check those before sharing private work.

**Your agent reads and explains the code; Waxwing builds the explorable output.**
Waxwing's renderer does not call an LLM. Validation checks that the model is
consistent; you still need to check the explanation against its sources.

For repeat use, [install the Waxwing skill](docs/agent-skill.md) in your agent's
skills directory. It supports creating explanations and updating existing ones.

<details>
<summary>Want to build an example locally first?</summary>

After installing Waxwing, run:

```sh
waxwing build-site "$(npm root -g)/@isought/waxwing/examples/waxwing/model.json" ./waxwing-demo --direction DOWN
```

Open `waxwing-demo/index.html`. This uses macOS/Linux shell syntax. On Windows,
run `npm root -g` and substitute its printed path for `$(npm root -g)`.

</details>

## Help shape it

Waxwing is an early, personally maintained open-source project. The formats are
still experimental. [Current limits](docs/features.md#mvp-boundaries) and the
[roadmap](ROADMAP.md) describe where it stands.

**Tried it and got stuck?** [Open an issue](https://github.com/isought/waxwing/issues)
with what you wanted to understand and where the process stopped. Confusing
instructions and unhelpful output are useful feedback too. For code and docs
changes, see [Contributing](CONTRIBUTING.md).

## Go deeper

- [Examples, commands, and source recovery](docs/features.md)
- [Agent authoring guide](AGENT_GUIDE.md) and [installable skill](docs/agent-skill.md)
- [Multi-page sites](docs/site-export.md) and [collections of explanations](docs/collections.md)
- [Model queries for agents](docs/model-queries.md) and [updates across repositories](docs/workspace.md)
- [JavaScript API](docs/modules.md)
- [Release notes](CHANGELOG.md) and [migration guidance](docs/migrations.md)

### Experimental source scanning

The [experimental source scanner](docs/source-scanning.md) indexes source evidence
separately from authored architecture models. JavaScript/TypeScript use compiler
bindings; other supported languages use Tree-sitter syntax extraction.
With Waxwing 0.3.0 installed, run:

```sh
waxwing scan /path/to/repository /tmp/project-scan.json --source-id my-project
waxwing scan-query /tmp/project-scan.json search loadModel
waxwing scan-view /tmp/project-scan.json /tmp/project-source.html
```

The source explorer includes a focused static graph. An optional connected site
opens relevant implementation entries from system components or relationships,
with exact source evidence and qualified recorded rationale. Try it on Waxwing:

```sh
npm run demo:connected -- /tmp/waxwing-connected
```

Open the generated `site/index.html`, choose a component, and follow its
implementation link. Each level remains independently useful when no connection
is recorded. The [connected example](experiments/connected-source/README.md)
describes what is curated and what the scanner establishes.

It reports unresolved bindings and skipped files. Source snapshots remain
separate from authored architecture models. Baseline syntax profiles cover Python,
Java, Kotlin, Go, C/C++, C#, Rust, Ruby, Swift, Objective-C, SQL, JSON, and shell.
Syntax-only references remain unresolved; support is not equivalent across languages.
Lean 4 and full Objective-C++ are future work. See the [coverage table](docs/source-scanning.md)
for limits. Scanning is experimental and is not included in 0.2.0.

### Work on Waxwing

From a source checkout:

```sh
git clone https://github.com/isought/waxwing.git
cd waxwing
npm ci
npm test
npm run test:package
```

`test:package` installs a packed archive in a temporary directory and exercises
its CLI, module imports, and source recovery. It needs npm registry access.

[MIT licensed](LICENSE). [Third-party notices](THIRD_PARTY_NOTICES.md).
