# Change Log

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
