# Examples

New to authoring formats? Follow the step-by-step
[**Creating a binary format**](../docs/CREATING_A_FORMAT.md) walkthrough — it
builds `wav-header.json` from scratch against `binaries/sample.wav`.

## Format definitions — `formats/`

| File | Matches | Highlights |
| --- | --- | --- |
| `wav-header.json` | `.wav`, magic `52 49 46 46` ("RIFF") | **nested sub-chunks**, `enum`, ASCII tags, `unit` — the walkthrough format |
| `nested-firmware.json` | `.fw`, magic `46 57 01 00` | **multi-level nesting**, a bit-field inside a nested struct, `timestamp`, a `sections` array |
| `mbr.json` | `.mbr`, magic `55 AA` **@ offset 510** | an **array of nested structures**, magic at a non-zero offset |
| `flash-layout.json` | `.fls` / `.flash` | a **sections-only** format (no fields): a 128 KiB MCU flash memory map with `rwx` flags + a display column |
| `firmware.json` | `.fw` / `.img`, magic `46 57 01 00` | `flags` with an enum sub-field, unix timestamp, scaled size |
| `eeprom.json` | `.eeprom` / `.dump`, magic `CA FE`, **big-endian** | MAC address `bytes[6]`, `enum` region, `scale`/`unit` calibration, 32-bit flags |
| `packet.json` | `.pkt` / `.dat` / `.raw`, magic `A5 5A`, **big-endian** | 64-bit millisecond timestamp, 1e-7 lat/lon scaling, status bit-field |

Import any of them with **Binary Viewer: Import Binary Format**, or copy them into
a workspace (see below).

## Sample binaries — `binaries/`

Regenerate with `npm run gen-examples` (or `node scripts/gen-examples.js`).

| File | Try |
| --- | --- |
| `sample.wav` | Auto-detects *WAV / RIFF Header*. Structure view → expand **fmt chunk**, click **SampleRate** to highlight its bytes |
| `nested.fw` | Auto-detects *Nested Firmware (example)*. Expand **Header → Flags** for the bit grid; click **LoadAddress** |
| `disk.mbr` | Import `formats/mbr.json`. Structure view → expand **Partitions[0]**; note the magic is at `0x1FE`, not `0x0` |
| `flash.fls` | Import `formats/flash-layout.json`, then the **Sections** tab — a flash memory map with `rwx` flags; tick *Hide "display: No"* to drop the **Reserved** row |
| `firmware.bin` | Auto-detects *Firmware Image (example)*; click **Load Address** to highlight bytes `0C..0F` |
| `config.eeprom` | Import `formats/eeprom.json`, then Structure view; expand **Feature Bits** |
| `telemetry.pkt` | Import `formats/packet.json`; check the **Timestamp** and scaled **Latitude** |
| `sample.dat` | No format matches — stays in Raw mode. Search ASCII `BINARY VIEWER DEMO`, or Go To `0x400` |

## Workspace format layout — `workspace-setup/`

Copy the `.vscode/` folder into a repository so its proprietary formats travel
with the code and override any global definition of the same name:

```
<your repo>/
  .vscode/
    binary-viewer/
      formats/
        firmware.json
        nested-firmware.json
        wav-header.json
        mbr.json
        flash-layout.json
        eeprom.json
        packet.json
```

Workspace formats load only in **trusted** workspaces. Run **Binary Viewer:
Reload Binary Formats** after adding files (a file watcher usually picks them up
automatically).
