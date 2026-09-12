# Source reading demonstration

The POC answered whether the existing scanner data could support a clearer graph.
Its presentation and history behavior now live in `modules/presentation/source/`.
There is no separate experimental UI implementation to maintain.

This launcher remains useful for reproducing a source view from a frozen scan:

```sh
node experiments/source-reading/run.mjs SNAPSHOT.json VERIFIED-SOURCE-ROOT OUTPUT-DIRECTORY
```

Use an output directory outside the repository/source root. Serve it locally and
open `index.html`. The launcher calls the same `renderSourceHTML` used by
`scan-view` and `build-connected`; it checks analyzed source file hashes before
embedding text. No source code is executed and there are no CDN dependencies.

The recommended graph, occurrence view, grouped evidence, file navigation,
browsing trail, and history regression tests are maintained in `test/source-*`.
For an overview connected to real source, use `experiments/connected-source/demo.mjs`.
