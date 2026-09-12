# Connected source demo

This experiment connects a curated Waxwing build overview to the scanner’s focused source explorer. It uses the current checkout’s `buildModelFiles` path; the historical `examples/waxwing` model keeps its original revision and scope.

Generate into a **new directory outside the repository**:

```sh
node experiments/connected-source/demo.mjs /tmp/waxwing-connected-demo
```

The script scans the repository, verifies the selected records and source comments, creates a model plus optional connection sidecar, and builds a portable site. It prints the overview path, direct source-view path, source focus ID and snapshot ID. Open the overview, select **Application pipeline**, then follow **Explore buildModelFiles**. Follow an overview relationship to enter the relevant callee directly. The source view retains the origin so you can return to the selected overview record.

`createSelfExample(snapshot)` in `fixture.mjs` exports the reproducible model and sidecar generator. It resolves file/function identities and call evidence uniquely, including the distinction between a lexical binding and its awaited-import origin. Missing, ambiguous or stale source records fail instead of quietly choosing a target. Responsibility boundaries remain explicitly curated. The site stores its inputs separately from the example source, and no generated artifacts are committed here.

The scan and its source explorer work independently of this model. The model remains valid without source links. See `reading.md` for the scope, recorded reasons, remaining human question and scan limitations. Snapshot size and memory optimization are deliberately deferred in this integration.
