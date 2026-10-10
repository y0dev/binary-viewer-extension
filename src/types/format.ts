/**
 * Declarative binary-format definition types.
 *
 * These types are shared by the extension host and the webview. They describe a
 * format purely as data — there is deliberately no mechanism to embed executable
 * code in a definition (see SECURITY notes in the README).
 */

export type Endianness = 'little' | 'big';

/** Named epochs understood by `timestamp` fields. */
export type TimestampEpoch = 'unix' | 'y2k' | 'gps' | 'mac' | 'filetime';

/** Every scalar type the parser understands out of the box. */
export type ScalarTypeName =
  | 'uint8'
  | 'int8'
  | 'uint16'
  | 'int16'
  | 'uint32'
  | 'int32'
  | 'uint64'
  | 'int64'
  | 'float32'
  | 'float64'
  // convenience aliases
  | 'byte'
  | 'bool'
  | 'boolean'
  | 'char'
  | 'float'
  | 'double';

/** Higher-level field kinds that need extra configuration on the field. */
export type CompositeTypeName =
  | 'bytes' // raw byte array, shown as hex
  | 'hex' // alias for bytes
  | 'binary' // raw bytes shown as bit strings
  | 'ascii' // fixed-length ASCII string
  | 'utf8'
  | 'utf16'
  | 'string' // alias for ascii
  | 'cstring' // terminator-scanned string; size is only known at parse time
  | 'enum'
  | 'flags' // bit-field container
  | 'bitfield'
  | 'timestamp'
  | 'struct'
  | 'array'
  | 'padding';

export type FieldTypeName = ScalarTypeName | CompositeTypeName | string;

/** A single bit or contiguous bit range inside a flags/bitfield field. */
export interface BitSpec {
  name: string;
  /** "0", "3", "1-4" (inclusive, LSB = bit 0). */
  bits: string;
  description?: string;
  /** Optional enum mapping applied to the extracted value. */
  enum?: Record<string, string | number> | EnumEntry[];
  /** If true, render as true/false. Default: true only when the range is 1 bit. */
  boolean?: boolean;
}

export interface EnumEntry {
  value: number | string;
  name: string;
  description?: string;
}

export interface FieldDefinition {
  name: string;
  /**
   * A short, stable identifier for referencing this field from a `countField`
   * or `offsetField` elsewhere — useful when `name` is a long, human-readable
   * label (e.g. `name: "Width Detection Word"`, `id: "widthWord"`) that's
   * awkward to type into a size/offset reference. Referencing a field by
   * `name` keeps working exactly as before; `id` is purely an alternative,
   * checked first. Must be unique across the whole format.
   */
  id?: string;
  /**
   * The data type for a *primitive* field. Omit `type` entirely for a nested
   * structure — a field with a `fields` array and no `type` is treated as a
   * container. A field must define exactly one of `type` or nested `fields`
   * (the bit-field form `{ type: "uint8", fields: [ { bits } ] }` is the one
   * intentional exception).
   */
  type?: FieldTypeName;
  /**
   * Byte offset. At the top level this is absolute from the start of the file;
   * inside a nested structure it is **relative to that structure**. If omitted
   * the field is placed immediately after the previous sibling ("packed").
   */
  offset?: number;
  /**
   * Take this field's position from a name instead of `offset`/packing —
   * checked first against a top-level `constants` entry, then an earlier
   * decoded integer field (by `id` or `name`), same `"+"`-sum syntax as
   * `countField`. Always an **absolute** file offset, regardless of nesting —
   * for pointer-style formats where one field stores another's byte offset
   * elsewhere in the file (e.g. a boot header's "Image Header Table Offset").
   * `offset`, when present, wins.
   */
  offsetField?: string;
  /**
   * Explicit size in bytes. Required for `bytes`/`binary`/string types.
   * Optional for a structure — when given it is the structure's total size;
   * when omitted the size is computed from the largest child end offset (see
   * `sizeAlign` to round that computed size up to a boundary instead).
   */
  size?: number;
  /**
   * For a structure/array/struct-name-reference with no explicit `size`:
   * round the auto-computed size (largest child end) up to the next multiple
   * of this value. For a format that pads each record to a fixed boundary
   * regardless of its actual content length — e.g. a record containing a
   * `cstring` whose length varies, padded to the next 64-byte boundary.
   * No effect when `size` is also set (`size` always wins).
   */
  sizeAlign?: number;
  /** For string types: number of characters/code units. */
  length?: number;
  /**
   * For `cstring`: the byte value that ends the string (consumed, not
   * included in the decoded value). Default `0` (NUL).
   */
  terminator?: number;
  /**
   * For `cstring`: group bytes into `wordSize`-byte chunks and reverse each
   * chunk before scanning/decoding — e.g. `4` for a string packed as
   * byte-reversed 32-bit words (seen in some Xilinx boot formats). The field
   * always consumes whole chunks, so the terminator can land anywhere within
   * the last chunk and the field still consumes that entire chunk. Default
   * `1` (plain byte order, an ordinary C string).
   */
  wordSize?: number;
  /**
   * For `cstring`: give up and report an error if no `terminator` byte is
   * found within this many bytes (a corrupt/non-terminated file can't hang
   * the parser). Default `1024`.
   */
  maxLength?: number;
  /** For `array`: number of elements. Mutually exclusive with `countField`. */
  count?: number;
  /**
   * For `array`: a `"+"`-separated sum of terms to take the element count
   * from — each term a literal integer, a top-level `constants` entry, or an
   * earlier decoded integer field by `id` or `name` (a length prefix; must
   * be parsed before this array — an earlier sibling, or a field in an
   * enclosing structure). A single name is just a one-term sum. `count`,
   * when present, wins.
   */
  countField?: string;
  /** For `array`: the element type (a nested field definition without a name is allowed). */
  items?: FieldDefinition;
  /**
   * For `array`: which element indices the Structure view renders — handy for
   * an array with 50+ elements where you only care about a slice of it. Either
   * `{ start, end }` (0-based, both inclusive, either order) or the shorthand
   * string `"start...end"` (e.g. `"20...35"`). Elements outside the view still
   * count toward the array's size/offsets; only the display is windowed.
   * Independent of `binaryViewer.structure.maxArrayElements`, which still caps
   * the total number of elements shown.
   */
  view?: { start?: number; end?: number } | string;
  /**
   * For `array`: stop adding elements once the field named here — inside the
   * element *just parsed*, matched by `id` or `name` — equals `equals`
   * (default `0`). For a linked-list-style terminator (e.g. a "next header
   * offset" field that's `0` on the last entry), so a fixed/max `count` (or
   * `countField`) doesn't over-report elements that were never really there.
   * The terminating element itself is still included; checked in addition to
   * `count`/`countField`, `maxArrayElements` and the node budget — whichever
   * stops the array first wins, so a corrupt file still can't loop forever.
   */
  until?: { field: string; equals?: number };
  /**
   * Nested content:
   *  - `FieldDefinition[]` — a nested structure (with or without `type: "struct"`).
   *    Child offsets are relative to this structure.
   *  - `BitSpec[]` — bit-field breakdown of an integer container.
   */
  fields?: FieldDefinition[] | BitSpec[];
  /** Per-field endianness override. */
  endianness?: Endianness;
  description?: string;
  /** For `enum` and scalar types with an enum overlay. */
  enum?: Record<string, string | number> | EnumEntry[];
  /** For `timestamp`. */
  timestamp?: {
    /** Underlying integer width in bytes. Default 4. */
    size?: 4 | 8;
    /** 's' (seconds, default) or 'ms'. */
    unit?: 's' | 'ms';
    /**
     * Epoch. One of the named epochs below, or a numeric epoch in ms.
     * When omitted, `binaryViewer.timestamp.defaultEpoch` is used.
     *  - 'unix'     — 1970-01-01 UTC
     *  - 'y2k'      — 2000-01-01 UTC
     *  - 'gps'      — 1980-01-06 UTC (leap seconds ignored)
     *  - 'mac'      — 1904-01-01 UTC (classic Mac / HFS+)
     *  - 'filetime' — 1601-01-01 UTC, value counted in 100-ns ticks (Windows FILETIME)
     */
    epoch?: TimestampEpoch | number;
  };
  /** Display hint: 'hex' | 'dec' | 'bin' | 'auto'. */
  display?: 'hex' | 'dec' | 'bin' | 'auto';
  /** Value multiplier / offset for scaled sensor values: value * scale + bias. */
  scale?: number;
  bias?: number;
  /** Unit label appended to the displayed value (e.g. "°C", "mV"). */
  unit?: string;
}

export interface MagicSpec {
  offset: number;
  /** Space/'0x'-separated hex bytes, e.g. "46 57 01 00" or "0x46 0x57". */
  bytes: string;
  /** Optional bitmask applied before comparison (same length as bytes). */
  mask?: string;
}

/**
 * A named region of the file for the Sections / memory-map view. `start` and
 * `length` accept a number or a hex/decimal string (`"0x8000"`, `"4096"`,
 * `"1000h"`). `flags` and `display` are optional, user-defined columns.
 */
export interface SectionDefinition {
  /** Section title, e.g. "main", ".text", "Bootloader". */
  name: string;
  /** Start address / file offset. */
  start: number | string;
  /** Size in bytes. Either this or `end` must be given. */
  length?: number | string;
  /** End address (exclusive). Alternative to `length`. */
  end?: number | string;
  /** Permission string, typically `rwx` / `r-x` / `rw-` (free-form, shown verbatim). */
  flags?: string;
  /** Whether the section is shown as visible ("Yes" / "No"). Default: true. */
  display?: boolean;
  description?: string;
}

/**
 * A reusable structure body. Referenced from a field by `"type": "<name>"`;
 * the extension inlines it before parsing. `fields` offsets are relative to the
 * referencing field, exactly like an inline nested structure.
 */
export interface StructBody {
  fields: FieldDefinition[];
  /** Explicit total size; otherwise computed from the largest child end. */
  size?: number;
  /** Round the computed size (when `size` is omitted) up to this boundary. */
  sizeAlign?: number;
  endianness?: Endianness;
  description?: string;
}

export interface FormatDefinition {
  /** Unique, human-readable name. Used as the storage key. */
  name: string;
  description?: string;
  version?: string;
  author?: string;
  /** File extensions this format applies to, with or without leading dot. */
  fileExtensions?: string[];
  /** Default endianness for all fields. Default: 'little'. */
  endianness?: Endianness;
  /**
   * Base address the offset / address columns are shown relative to (e.g.
   * `0x08000000` for memory-mapped flash). A number, or a `0x`/decimal/`…h`
   * string. Overrides the `binaryViewer.baseAddress` setting for this format.
   */
  baseAddress?: number | string;
  /** One or more magic-byte signatures. Any match counts. */
  magic?: MagicSpec | MagicSpec[];
  /**
   * Reusable named structures. A field (or an array's `items`) can then set
   * `"type": "<key>"` instead of repeating a `fields` block — handy for large
   * arrays of records.
   */
  structures?: Record<string, StructBody>;
  /**
   * Named constant values a field can reference by name — most usefully as
   * an array's `countField`, for a fixed size that isn't decoded from the
   * file (e.g. `"Rows": 4, "Cols": 8, "Total": "Rows + Cols"`). A value is
   * either a plain number or a string summing other constants/integers with
   * `+`. Never executable code — see `core/FormatConstants`.
   */
  constants?: Record<string, number | string>;
  /** Top-level fields. Optional when `sections` is provided. */
  fields?: FieldDefinition[];
  /** Named regions for the Sections / memory-map view. */
  sections?: SectionDefinition[];
}

/**
 * Where a loaded format came from (affects override precedence and editability).
 * Precedence, lowest to highest: builtin < global < external < workspace.
 * `external` = a folder listed in `binaryViewer.formatDirectories`.
 */
export type FormatSource = 'builtin' | 'global' | 'external' | 'workspace';

export interface LoadedFormat {
  definition: FormatDefinition;
  source: FormatSource;
  /** Absolute path / uri string of the backing file, when applicable. */
  uri?: string;
}
