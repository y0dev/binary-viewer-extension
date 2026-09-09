# Binary Viewer & Structure Inspector

A Visual Studio Code extension for inspecting binary files. It combines a fast,
virtualized **hex/binary viewer** (UltraEdit-style layout) with a
**user-defined binary structure decoder** aimed at embedded engineers working
with firmware images, EEPROM/flash dumps, device configuration blobs, packet
captures, memory dumps, and other proprietary binary formats.

Built on the VS Code **Custom Editor API** — not a `TextDocument` editor — so it
opens multi-hundred-MB and multi-GB files without loading them into memory.

---

## Features

### Raw hex view
- Classic `Offset | Hex bytes | ASCII` layout, monospaced, precisely aligned.
- 8 / 16 / 32 bytes per row (default configurable in settings).
- Virtualized rendering — only visible rows exist in the DOM, so scrolling a 1 GB
  file stays smooth.
- Byte and range selection, synchronized between the hex and ASCII columns
  (click a byte, its ASCII cell highlights, and vice-versa).
- Keyboard navigation (arrows, Page Up/Down, Home/End, Ctrl+Home/End, Shift to
  extend the selection).
- Status bar: current offset (hex + decimal), file size, selection length, and
  the value under the caret.

### Data inspector
- Toggleable side panel. For the caret byte: hex, binary, octal, signed/unsigned,
  ASCII. For the following bytes / current selection: `int8…int64`,
  `uint8…uint64`, `float32`, `float64`, in **both** little- and big-endian.

### Structure view
- Decodes the file with a **declarative** binary-format definition and shows an
  expandable `Name | Offset | Type | Value` tree.
- **Nested structures** — a field with a `fields` array and no `type` is a
  container; child offsets are relative to it and resolved to absolute
  automatically. Nesting is unlimited and mixes freely with flat fields.
- Collapse/expand containers (remembered for the session) and a
  `Format › Header › ImageInfo › Field` breadcrumb for deep hierarchies.
- Click a field to select and highlight its bytes in the raw view; selecting a
  container highlights its whole byte range.
- Bit-field breakdown with a `Bit 7…0` grid and per-bit values / enums.
- Automatic format detection by file extension and magic bytes; if several match,
  you pick one. Change the format at any time without reopening the file.

### Search & navigation
- Binary search: hex pattern (`FF 00 A5 10`, `??` wildcards), ASCII text
  (optional case-insensitive), UTF-8, UTF-16, and bit patterns (`10101010`).
- Find next / previous / all, streamed over the file so huge files don't block.
- **Go To Offset** accepting `0x1000`, `4096`, or `1000h`.

### Format authoring
- A form-based **Binary Format Editor** (create, name, set endianness, add/remove/
  reorder fields, offsets, types, sizes, descriptions, enums, bit fields, arrays,
  strings, timestamps).
- Import / export definitions as JSON. Reload on demand.
- Formats resolve with precedence **workspace → global → builtin**, so a repo can
  ship `.vscode/binary-viewer/formats/*.json` that override the globals.

Read-only by design in this version. The architecture leaves room for safe
editing later.

---

## Getting started

```bash
npm install
npm run compile     # bundles the extension + both webviews, then type-checks
```

Press <kbd>F5</kbd> in VS Code (the **Run Extension** launch config) to open an
Extension Development Host with the `examples/binaries` folder loaded.

Open a binary file with **Explorer → right-click → Open With → Binary Viewer**,
or run **Binary Viewer: Open With Binary Viewer** from the command palette. The
extension registers as an *optional* editor for `.bin .hex .img .dat .fw .rom
.dump .raw .eeprom .nvram` — it never takes over a file type automatically.

### Package a VSIX

```bash
npm run package     # produces binary-viewer-0.1.0.vsix
```

---

## Commands

| Command | Description |
| --- | --- |
| `Binary Viewer: Go To Offset` | Jump to a hex/decimal offset (<kbd>Ctrl/Cmd+G</kbd>) |
| `Binary Viewer: Search` | Open the in-editor binary search bar (<kbd>Ctrl/Cmd+F</kbd>) |
| `Binary Viewer: Find Next / Previous` | <kbd>F3</kbd> / <kbd>Shift+F3</kbd> |
| `Binary Viewer: Toggle Structure View` | Switch Raw ⟷ Structure (<kbd>Ctrl/Cmd+Alt+S</kbd>) |
| `Binary Viewer: Toggle Inspector` | Show/hide the data inspector (<kbd>Ctrl/Cmd+Alt+I</kbd>) |
| `Binary Viewer: Show Field in Raw View` | Reveal the selected structure field's bytes |
| `Binary Viewer: Select Binary Format` | Apply / change / clear the structure format |
| `Binary Viewer: Create / Edit / Duplicate / Delete Binary Format` | Manage definitions |
| `Binary Viewer: Import / Export Binary Format` | JSON interchange |
| `Binary Viewer: Reload Binary Formats` | Re-scan global + workspace definitions |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `binaryViewer.bytesPerRow` | `16` | Bytes per row in the raw view (8/16/32) |
| `binaryViewer.defaultEndianness` | `little` | Inspector / format default |
| `binaryViewer.showInspectorByDefault` | `true` | Show inspector on open |
| `binaryViewer.blockSizeBytes` | `65536` | Range-read / cache granularity |
| `binaryViewer.cacheWindowBytes` | `8388608` | Max host-side cache per file |
| `binaryViewer.autoDetectFormat` | `true` | Detect a format on open |
| `binaryViewer.maxSearchResults` | `5000` | Cap for *Find All* |

---

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how the pieces fit together.
- [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md) — day-to-day usage.
- [`docs/FORMAT_DEFINITIONS.md`](docs/FORMAT_DEFINITIONS.md) — the format schema,
  every data type, bit fields, enums, arrays, timestamps, magic detection.
- [`examples/`](examples/) — sample format definitions and matching binaries.

## Security

Format definitions are **pure data**. There is no expression language and no code
execution path — a malicious `.json` can at worst describe a wrong layout.
Workspace-defined formats are only loaded in **trusted** workspaces; raw hex
viewing and global/builtin formats work everywhere.

## Testing

```bash
npm test                  # unit tests (parsing, bit fields, detection, large files)
npm run test:integration  # downloads VS Code and runs the extension host suite
```

## Author

Devontae Reid — [www.devontaereid.com](https://www.devontaereid.com)

Source: [github.com/y0dev/binary-viewer-extension](https://github.com/y0dev/binary-viewer-extension)

## License

MIT — see [LICENSE](LICENSE).
