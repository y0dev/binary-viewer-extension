# Contributing / building from source

## Prerequisites

- **Node.js 18+** (20 recommended — see `.nvmrc`). `npm install` runs a
  `preinstall` check and stops with upgrade instructions on anything older —
  handy on WSL/Ubuntu, which still ships Node 12/14.
- VS Code 1.85+

No native toolchain is required. `npm install` pulls only pure-JS dev
dependencies plus `esbuild` (which fetches a small prebuilt binary for your
platform). The packaging tool (`@vscode/vsce`) is **not** a dependency — it runs
on demand via `npx` from `npm run package`.

## Setup

```bash
npm install
npm run compile      # esbuild bundles (extension + both webviews) + tsc type-check
npm test             # unit tests
```

Press <kbd>F5</kbd> in VS Code — the **Run Extension** launch config opens an
Extension Development Host with `examples/binaries/` loaded.

### WSL / Linux / macOS notes

- **Do not share `node_modules` between Windows and WSL.** If you cloned onto a
  Windows drive (`/mnt/c`, `/mnt/f`, …) and ran `npm install` from Windows, the
  `esbuild` binary in `node_modules` is the Windows build and Node under WSL
  can't exec it (`"You installed esbuild for another platform"`). Fix:

  ```bash
  rm -rf node_modules && npm install     # run this inside WSL
  ```

  Better: clone into the Linux filesystem (`~/src/...`), not `/mnt/...`.
- `npm ci` also works — the lockfile carries every platform's optional
  `@esbuild/*` package, so it resolves the right one on any OS/arch.
- The **built extension** (`dist/extension.js`) is plain bundled JavaScript with
  no native modules, so a packaged `.vsix` installs and runs anywhere VS Code
  does, including Remote-WSL, Remote-SSH, Dev Containers and github.dev/web.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run compile` | Bundle with esbuild, then `tsc --noEmit` for host + webview |
| `npm run watch` | esbuild in watch mode |
| `npm run lint` | ESLint over `src/` |
| `npm test` | Unit tests (parsing, bit fields, nested structures, detection, search, large-file range reads 1 MB → 1 GB sparse) |
| `npm run test:integration` | Downloads a VS Code build and runs the extension-host suite |
| `npm run package` | Production bundle + `npx @vscode/vsce package` → `binary-structure-inspector-<version>.vsix` |
| `npm run gen-fixtures` | Regenerate large test fixtures (`--huge` also makes 100 MB + 1 GB sparse) |
| `npm run gen-examples` | Regenerate the committed example binaries in `examples/binaries/` |
| `npm run gen-icon` | Regenerate `media/icon.png` (pure Node, no image deps) |
| `npm run gen-screenshots` | Re-render `docs/images/*.png` from the `docs/mockups/*.html` mockups via headless Chrome/Edge (set `CHROME_PATH` if not auto-found) |

## Layout

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). In short:

- `src/core/` — pure, dependency-free binary logic (data types, bit fields,
  parser, format schema, detection, search matcher). Unit-testable without an
  extension host.
- `src/binary/` — Node `fs` range reader + bounded cache + streaming search.
- `src/formats/` — format discovery, storage, precedence.
- `src/editor/`, `src/commands/`, `src/formatEditor/` — extension host.
- `src/webview/` — the hex/structure UI (bundled separately by esbuild).

## Tests

Unit tests live in `test/unit/` and run in plain Node (no VS Code) because the
`core/` and `binary/` modules never `import 'vscode'` at module load. Integration
tests in `test/integration/` need `@vscode/test-electron`.

## Releasing

1. Bump `version` in `package.json`, update `CHANGELOG.md`.
2. `npm test && npm run package`.
3. `npx @vscode/vsce publish` (requires the `devdoesit` Marketplace publisher and
   a PAT; needs Node 20+).

## Publisher note

The Marketplace extension id is `devdoesit.binary-structure-inspector`
(`binary-viewer` was already taken). The internal contribution ids
(`binaryViewer.*` commands / settings / `binaryViewer.hexEditor` view type) are
intentionally left as-is so existing user settings and keybindings keep working.
