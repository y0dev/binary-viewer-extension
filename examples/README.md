# Examples

## Format definitions — `formats/`

| File | Matches | Highlights |
| --- | --- | --- |
| `firmware.json` | `.fw` / `.img`, magic `46 57 01 00` | flags with an enum sub-field, unix timestamp, scaled size |
| `eeprom.json` | `.eeprom` / `.dump`, magic `CA FE`, **big-endian** | MAC address `bytes[6]`, `enum` region, `scale`/`unit` calibration, 32-bit flags |
| `packet.json` | `.pkt` / `.dat` / `.raw`, magic `A5 5A`, **big-endian** | 64-bit millisecond timestamp, 1e-7 lat/lon scaling, status bit-field |

Import any of them with **Binary Viewer: Import Binary Format**, or copy them into
a workspace (see below).

## Sample binaries — `binaries/`

Regenerate with `node scripts/gen-examples.js`.

| File | Open in | Try |
| --- | --- | --- |
| `firmware.bin` | Binary Viewer | Structure view auto-detects the builtin *Firmware Image (example)*; click **Load Address** to highlight bytes `0C..0F` |
| `config.eeprom` | Binary Viewer | Import `formats/eeprom.json`, then Structure view; expand **Feature Bits** |
| `telemetry.pkt` | Binary Viewer | Import `formats/packet.json`; check the **Timestamp** and scaled **Latitude** |
| `sample.dat` | Binary Viewer | No format matches — stays in Raw mode. Search ASCII `BINARY VIEWER DEMO`, or Go To `0x400` |

## Workspace format layout — `workspace-setup/`

Copy the `.vscode/` folder into a repository so its proprietary formats travel
with the code and override any global definition of the same name:

```
<your repo>/
  .vscode/
    binary-viewer/
      formats/
        firmware.json
        eeprom.json
        packet.json
```

Workspace formats load only in **trusted** workspaces. Run **Binary Viewer:
Reload Binary Formats** after adding files (a file watcher usually picks them up
automatically).
