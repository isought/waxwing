# Third-party dependencies

Waxwing uses the following direct dependencies, pinned in `package-lock.json`:

- **Ajv 8.17.1** — JSON Schema validation; MIT license.
  [Upstream](https://github.com/ajv-validator/ajv).
- **elkjs 0.12.0** — automatic graph layout. Upstream declares
  `EPL-2.0 OR GPL-3.0-or-later`; see the license files supplied with the package.
  [Upstream and licenses](https://github.com/kieler/elkjs).
- **markdown-it 15.0.1** — Markdown parsing and HTML generation; MIT license.
  [Upstream and license](https://github.com/markdown-it/markdown-it).
- **TypeScript 6.0.3** — JavaScript/TypeScript source parsing and static symbol
  binding; Apache-2.0 license. [Upstream and license](https://github.com/microsoft/TypeScript).

Transitive dependencies retain their own license notices in their distributed
packages. TypeScript runs only when analyzing source; it is not embedded in source
snapshots or viewers. No third-party library code is embedded in generated SVG/HTML; ELK,
Ajv, and markdown-it run during generation/validation. The standalone viewer uses project-authored
JavaScript and CSS.

Archify informed the design discussion. No Archify source has been copied or
bundled. Waxwing's own source is provided under the MIT license in LICENSE.
