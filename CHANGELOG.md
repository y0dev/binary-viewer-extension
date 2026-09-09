# Change Log

## 0.2.0 — Nested structures

- Binary format definitions now support **nested structures**: a field with a
  `fields` array and no `type` is a container. Child offsets are **relative to
  the enclosing structure**; the parser resolves absolute offsets. Nesting is
  unlimited and can be freely mixed with flat fields. `type: "struct"` still
  works. Fully backward compatible with existing flat definitions.
- Structure view renders the hierarchy as an expandable tree (session-remembered
  collapse state) with a `Format › Header › ImageInfo › Field` breadcrumb.
  Selecting a container highlights its whole byte range in the raw view.
- Structure `size` is optional — computed from the largest child end offset when
  omitted; nested structures feed the parent calculation.
- The format editor is now a **tree editor**: `+ Add Field` / `+ Add Structure`
  at every level, move into / out of structures, reorder, collapse.
- New validation errors: field with both `type` and `fields`, field with
  neither, negative structure/child offset, overlapping fields, field extending
  beyond a declared structure size, empty structure.
- New builtin/example format `Nested Firmware (example)` + `examples/binaries/nested.fw`.
- More example format definitions with matching binaries: `wav-header.json`
  (nested RIFF sub-chunks), `mbr.json` (an array of nested partition structs,
  magic at offset 510). New step-by-step guide `docs/CREATING_A_FORMAT.md`.
- Marketplace-ready: extension id `devdoesit.binary-structure-inspector`, logo,
  screenshot-led README, `CONTRIBUTING.md` for build instructions.
- Cross-platform install: `@vscode/vsce` (and its optional native `keytar`
  dependency) removed from `devDependencies` — packaging now runs it via `npx`,
  so `npm install` needs no build toolchain on WSL/Linux. Added `.gitattributes`
  (LF for text, `binary` for fixtures/assets), `.nvmrc`, and `engines.node`.

## 0.1.0 — Initial release

### Raw view
- Custom read-only editor (`binaryViewer.hexEditor`) built on the VS Code Custom
  Editor API.
- Virtualized hex/ASCII grid with 8/16/32 bytes per row and a scaled scrollbar
  for files beyond the browser element-height limit.
- Byte + range selection with hex/ASCII synchronization and full keyboard
  navigation.
- Range-based reads through a bounded LRU cache in the extension host; the file
  is never fully loaded into the webview.
- Status bar with offset (hex/decimal), file size, selection length and caret
  value.

### Data inspector
- Per-byte and per-range interpretation as every standard integer/float type in
  little- and big-endian.

### Structure view
- Declarative binary-format engine: scalars, `bytes`/`binary`, strings
  (`ascii`/`utf8`/`utf16`), `enum`, `flags`/`bitfield`, `array`, `struct`,
  `timestamp`, per-field endianness, scale/bias/unit, display hints.
- Structure table with field → raw-bytes highlighting and a bit-field grid.
- Format detection by extension and magic bytes (with optional mask); multi-match
  picker; live format switching.

### Format authoring & storage
- Form-based Binary Format Editor (create / edit / duplicate / delete).
- Global storage under the extension's global-storage folder; workspace formats
  under `.vscode/binary-viewer/formats/*.json` override globals.
- Import / Export / Reload commands.

### Search
- Streaming binary search: hex (with `??` wildcards), ASCII (optional
  case-insensitive), UTF-8, UTF-16, bit patterns. Find next / previous / all.

### Other
- Go To Offset (`0x…`, decimal, `…h`).
- Full light / dark / high-contrast theming via VS Code theme variables.
- Unit tests for parsing, bit fields, format detection, search and large-file
  range reads (1 MB / 10 MB / 100 MB / 1 GB sparse).
