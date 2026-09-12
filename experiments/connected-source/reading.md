# Follow the build into its source

Start with **Application pipeline** to explore `buildModelFiles`. The function calls `loadAndLayout`, imports the artifact renderers, computes the output contents, then passes them to the file-writing helper. The source view lets you inspect the calls, their local bindings, and their exact evidence.

Selecting **Place model** narrows the next question: which layout entry does this relationship use? Its connection opens `layoutModel`, supported by the call in `loadAndLayout` and the literal awaited import. Selecting **Render SVG / HTML** gives two entries, because one responsibility and one overview relationship can have several relevant implementations.

## Two useful views

The overview groups code into four logical responsibilities. These boundaries and labels were curated for the build question. “Service” in the current architecture vocabulary means a logical responsibility in this example; these are not separate network services.

The source explorer is generated from the scan and works on its own. You can browse files, select a function, follow a focused graph and inspect source evidence without creating an overview or a connection. A connection adds an entry point, context and a route back; it is not a prerequisite for using either level.

## What the lines establish

Source relationships represent syntax, compiler bindings and explicitly qualified static import provenance. A call through a local binding keeps that binding visible even when a literal awaited import identifies its exported origin. These are not an observed execution trace, guaranteed runtime dispatch or a workflow order.

The scan does not fully resolve conditional callees, arbitrary dynamic imports, general value aliases, callbacks or injected browser assets. In particular, this example starts at the application function; it does not pretend the CLI’s conditional callee is a resolved call. External packages remain visible as boundary references, while their implementations are outside the scan.

## Recorded reasons and missing reasons

Two source comments provide recorded rationale: layout imports stay lazy to keep ELK out of preparation, rendering and recovery, and artifact content is prepared before earlier output is replaced. Their notes identify the exact source file revision and line. The comments report intention; they do not prove runtime performance or promise an atomic transaction across several output files.

The intended recovery guarantee for a partly completed multi-file write is left unknown. That is a useful question for a maintainer after the machine has already exposed the implementation. Names and call connectivity cannot supply the missing intended boundary or its reason.

## Evidence belongs to a revision

The model, source snapshot and connection file each carry identities or digests. Source declarations and reference occurrences are pinned to file content and exact spans. The demo verifies local bytes before attaching source text and quoting comments. A Git commit is additional context; it does not stand in for the scanned working-tree bytes.

This first integration accepts the scanner’s current memory use and large snapshot output. It focuses on useful navigation and honest evidence; scan and rendering resource optimization remain separate work.
