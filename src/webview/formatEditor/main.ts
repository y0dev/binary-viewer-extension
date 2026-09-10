import { el, clear } from '../dom';
import { FORMAT_EDITOR_CSS } from './styles';
import { parseArrayShorthand } from '../../core/FieldSyntax';
import type { FormatDefinition, FieldDefinition, MagicSpec, BitSpec } from '../../types/format';
import type {
  FormatEditorFromHost,
  FormatEditorToHost,
  FormatEditorInit,
} from '../../types/messages';

interface Api {
  postMessage(msg: FormatEditorToHost): void;
}
declare function acquireVsCodeApi(): Api;
const vscode = acquireVsCodeApi();
const post = (m: FormatEditorToHost) => vscode.postMessage(m);

const style = document.createElement('style');
style.textContent = FORMAT_EDITOR_CSS;
document.head.append(style);

const app = document.getElementById('app')!;

let init: FormatEditorInit | null = null;
let seq = 1;
const uid = () => `e${seq++}`;

/** A node in the working tree: a primitive field, a nested structure, or an array. */
interface EditNode {
  id: string;
  kind: 'field' | 'struct' | 'array';
  name: string;
  offset: string;
  /** field: data type or a structure name. array: the element type. */
  type: string;
  /** array only: element count. */
  count: string;
  size: string;
  length: string;
  endianness: string;
  description: string;
  advanced: string;
  advancedError?: string;
  /** Structured enum value→label rows (for `enum` type or an enum overlay). */
  enumRows: { value: string; label: string }[];
  /** Structured `timestamp` config; '' means "leave to the default". */
  tsSize: string;
  tsUnit: string;
  tsEpoch: string;
  // struct-only
  children: EditNode[];
  collapsed: boolean;
}

/** A reusable structure definition (the `structures` map). */
interface EditStruct {
  id: string;
  name: string;
  description: string;
  children: EditNode[];
  collapsed: boolean;
}

interface Model {
  name: string;
  description: string;
  version: string;
  author: string;
  fileExtensions: string;
  endianness: 'little' | 'big';
  magicOffset: string;
  magicBytes: string;
  structs: EditStruct[];
  tree: EditNode[];
  /** Raw JSON text for the `sections` array (memory-map view). '' == none. */
  sectionsJson: string;
  sectionsError?: string;
  /** 'form' = the visual tree editor; 'json' = edit the whole definition as text. */
  mode: 'form' | 'json';
  /** The full definition as text, authoritative while `mode === 'json'`. */
  jsonText: string;
  jsonError?: string;
  /** True when the loaded definition has fields the form can't fully represent. */
  formLossy: boolean;
}

let model: Model;

window.addEventListener('message', (ev: MessageEvent<FormatEditorFromHost>) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    init = msg;
    model = toModel(msg.format);
    render();
  } else if (msg.type === 'validationResult') {
    showErrors(msg.errors);
  } else if (msg.type === 'saved') {
    showErrors([]);
    flashSaved();
  }
});

post({ type: 'ready' });

// ---- model <-> definition ----------------------------------------------

const KNOWN_KEYS = new Set([
  'name',
  'type',
  'offset',
  'size',
  'length',
  'endianness',
  'description',
  'enum',
  'timestamp',
]);

type EnumRow = { value: string; label: string };

function enumToRows(e: FieldDefinition['enum']): EnumRow[] {
  if (!e) {
    return [];
  }
  if (Array.isArray(e)) {
    return e.map((x) => ({ value: String(x.value), label: String(x.name ?? '') }));
  }
  return Object.entries(e).map(([k, v]) => ({ value: k, label: String(v) }));
}

function rowsToEnum(rows: EnumRow[]): Record<string, string> | undefined {
  const map: Record<string, string> = {};
  for (const r of rows) {
    const key = r.value.trim();
    if (key !== '') {
      map[key] = r.label;
    }
  }
  return Object.keys(map).length ? map : undefined;
}

function looksLikeBitSpecs(fields: unknown): boolean {
  return (
    Array.isArray(fields) &&
    fields.length > 0 &&
    typeof (fields[0] as Partial<BitSpec>).bits === 'string'
  );
}

function isNestedStructure(f: FieldDefinition): boolean {
  if (!Array.isArray(f.fields)) {
    return false;
  }
  if (looksLikeBitSpecs(f.fields)) {
    return false;
  }
  // typeless container, or explicit type:"struct"
  return !f.type || f.type === 'struct';
}

function emptyNode(kind: EditNode['kind']): EditNode {
  return {
    id: uid(),
    kind,
    name: kind === 'struct' ? 'NewStruct' : kind === 'array' ? 'items' : 'field',
    offset: '',
    type: 'uint8',
    count: kind === 'array' ? '4' : '',
    size: '',
    length: '',
    endianness: '',
    description: '',
    advanced: '',
    enumRows: [],
    tsSize: '',
    tsUnit: '',
    tsEpoch: '',
    children: [],
    collapsed: false,
  };
}

/** A field node preset to an enum, ready for value rows. */
function enumNode(): EditNode {
  const n = emptyNode('field');
  n.name = 'kind';
  n.type = 'enum';
  n.size = '4';
  n.enumRows = [
    { value: '0', label: '' },
    { value: '1', label: '' },
  ];
  return n;
}

function emptyStruct(): EditStruct {
  return { id: uid(), name: 'Record', description: '', children: [emptyNode('field')], collapsed: false };
}

function cloneNode(n: EditNode): EditNode {
  return {
    ...n,
    id: uid(),
    enumRows: n.enumRows.map((r) => ({ ...r })),
    children: n.children.map(cloneNode),
  };
}

function fieldToNode(f: FieldDefinition): EditNode {
  if (isNestedStructure(f)) {
    const node = emptyNode('struct');
    node.name = f.name ?? '';
    node.offset = f.offset === undefined ? '' : String(f.offset);
    node.size = f.size === undefined ? '' : String(f.size);
    node.endianness = f.endianness ?? '';
    node.description = f.description ?? '';
    node.children = (f.fields as FieldDefinition[]).map(fieldToNode);
    return node;
  }
  const shorthand = parseArrayShorthand(f.type);
  const STRING_OR_SIZED = new Set(['char', 'ascii', 'utf8', 'utf16', 'string', 'bytes', 'hex', 'binary', 'padding']);
  if (f.type === 'array' || (shorthand && !STRING_OR_SIZED.has(shorthand.base))) {
    const node = emptyNode('array');
    node.name = f.name ?? '';
    node.offset = f.offset === undefined ? '' : String(f.offset);
    if (shorthand) {
      node.count = String(shorthand.count);
      node.type = shorthand.base;
      node.size = f.items?.size !== undefined ? String(f.items.size) : '';
    } else {
      node.count =
        f.count !== undefined ? String(f.count) : typeof f.countField === 'string' ? f.countField : '';
      node.type = f.items?.type ?? 'uint8';
      node.size =
        f.items?.size !== undefined ? String(f.items.size) : f.size !== undefined ? String(f.size) : '';
    }
    node.endianness = f.endianness ?? '';
    node.description = f.description ?? '';
    return node;
  }
  const node = emptyNode('field');
  const advanced: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f)) {
    if (!KNOWN_KEYS.has(k)) {
      advanced[k] = v;
    }
  }
  node.name = f.name ?? '';
  node.type = f.type ?? 'uint8';
  node.offset = f.offset === undefined ? '' : String(f.offset);
  node.size = f.size === undefined ? '' : String(f.size);
  node.length = f.length === undefined ? '' : String(f.length);
  node.endianness = f.endianness ?? '';
  node.description = f.description ?? '';
  node.enumRows = enumToRows(f.enum);
  if (f.timestamp) {
    node.tsSize = f.timestamp.size === undefined ? '' : String(f.timestamp.size);
    node.tsUnit = f.timestamp.unit ?? '';
    node.tsEpoch = typeof f.timestamp.epoch === 'string' ? f.timestamp.epoch : '';
  }
  node.advanced = Object.keys(advanced).length ? JSON.stringify(advanced, null, 2) : '';
  return node;
}

/**
 * True when the visual tree editor can round-trip every field. The form has no
 * UI for an array whose element is itself an array or an inline structure
 * (multi-dimensional arrays, `items: { fields: [...] }`) — those must be edited
 * as JSON so no detail is silently dropped.
 */
function formCanRepresent(def: FormatDefinition | null): boolean {
  if (!def) {
    return true;
  }
  const STRING_OR_SIZED = new Set(['char', 'ascii', 'utf8', 'utf16', 'string', 'bytes', 'hex', 'binary', 'padding']);
  const itemIsComplex = (items: FieldDefinition | undefined): boolean => {
    if (!items) {
      return false;
    }
    if (items.type === 'array') {
      return true;
    }
    const sh = parseArrayShorthand(items.type);
    if (sh && !STRING_OR_SIZED.has(sh.base)) {
      return true;
    }
    return Array.isArray(items.fields) && !looksLikeBitSpecs(items.fields);
  };
  const walk = (fields: FieldDefinition[] | undefined): boolean => {
    for (const f of fields ?? []) {
      const sh = parseArrayShorthand(f.type);
      const isArray = f.type === 'array' || (sh && !STRING_OR_SIZED.has(sh.base));
      if (isArray && itemIsComplex(f.items)) {
        return false;
      }
      if (f.items && !walk([f.items])) {
        return false;
      }
      if (Array.isArray(f.fields) && !looksLikeBitSpecs(f.fields) && !walk(f.fields as FieldDefinition[])) {
        return false;
      }
    }
    return true;
  };
  if (!walk(def.fields)) {
    return false;
  }
  for (const body of Object.values(def.structures ?? {})) {
    if (!walk(body.fields)) {
      return false;
    }
  }
  return true;
}

function starterJsonText(): string {
  return JSON.stringify(
    { name: 'New Binary Format', endianness: 'little', fields: [{ name: 'magic', type: 'uint32', offset: 0 }] },
    null,
    2,
  );
}

function toModel(def: FormatDefinition | null): Model {
  const magic: MagicSpec | undefined = def
    ? Array.isArray(def.magic)
      ? def.magic[0]
      : def.magic
    : undefined;
  const lossy = !formCanRepresent(def);
  return {
    name: def?.name ?? 'New Binary Format',
    description: def?.description ?? '',
    version: def?.version ?? '',
    author: def?.author ?? '',
    fileExtensions: (def?.fileExtensions ?? []).join(', '),
    endianness: def?.endianness ?? 'little',
    magicOffset: magic ? String(magic.offset) : '',
    magicBytes: magic?.bytes ?? '',
    structs: Object.entries(def?.structures ?? {}).map(([name, body]) => ({
      id: uid(),
      name,
      description: body.description ?? '',
      collapsed: false,
      children: (body.fields ?? []).map(fieldToNode),
    })),
    tree: (def?.fields ?? []).map(fieldToNode),
    sectionsJson:
      def?.sections && def.sections.length
        ? JSON.stringify(def.sections, null, 2)
        : '',
    mode: lossy ? 'json' : 'form',
    jsonText: def ? JSON.stringify(def, null, 2) : starterJsonText(),
    jsonError: undefined,
    formLossy: lossy,
  };
}

function num(s: string): number | undefined {
  const t = s.trim();
  if (t === '') {
    return undefined;
  }
  const n = t.toLowerCase().startsWith('0x') ? parseInt(t, 16) : Number(t);
  return Number.isFinite(n) ? n : undefined;
}

function nodeToField(node: EditNode): FieldDefinition {
  if (node.kind === 'struct') {
    const f: FieldDefinition = {
      name: node.name.trim(),
      fields: node.children.map(nodeToField),
    };
    const off = num(node.offset);
    if (off !== undefined) {
      f.offset = off;
    }
    const sz = num(node.size);
    if (sz !== undefined) {
      f.size = sz;
    }
    if (node.endianness === 'little' || node.endianness === 'big') {
      f.endianness = node.endianness;
    }
    if (node.description.trim()) {
      f.description = node.description.trim();
    }
    return f;
  }

  if (node.kind === 'array') {
    const items: FieldDefinition = { name: 'item', type: node.type.trim() };
    const elemSize = num(node.size);
    if (elemSize !== undefined) {
      items.size = elemSize;
    }
    const countNum = num(node.count);
    const countField = node.count.trim();
    const f: FieldDefinition = {
      name: node.name.trim(),
      type: 'array',
      items,
    };
    if (countNum !== undefined) {
      f.count = countNum;
    } else if (countField) {
      // A non-numeric value names an earlier field to take the length from.
      f.countField = countField;
    } else {
      f.count = 0;
    }
    const off = num(node.offset);
    if (off !== undefined) {
      f.offset = off;
    }
    if (node.endianness === 'little' || node.endianness === 'big') {
      f.endianness = node.endianness;
    }
    if (node.description.trim()) {
      f.description = node.description.trim();
    }
    return f;
  }

  const f: FieldDefinition = { name: node.name.trim(), type: node.type.trim() };
  const off = num(node.offset);
  if (off !== undefined) {
    f.offset = off;
  }
  const sz = num(node.size);
  if (sz !== undefined) {
    f.size = sz;
  }
  const len = num(node.length);
  if (len !== undefined) {
    f.length = len;
  }
  if (node.endianness === 'little' || node.endianness === 'big') {
    f.endianness = node.endianness;
  }
  if (node.description.trim()) {
    f.description = node.description.trim();
  }
  const enumMap = rowsToEnum(node.enumRows);
  if (enumMap) {
    f.enum = enumMap;
  }
  if (node.tsSize || node.tsUnit || node.tsEpoch) {
    const ts: NonNullable<FieldDefinition['timestamp']> = {};
    if (node.tsSize === '4' || node.tsSize === '8') {
      ts.size = Number(node.tsSize) as 4 | 8;
    }
    if (node.tsUnit === 's' || node.tsUnit === 'ms') {
      ts.unit = node.tsUnit;
    }
    if (node.tsEpoch) {
      ts.epoch = node.tsEpoch as NonNullable<FieldDefinition['timestamp']>['epoch'];
    }
    if (Object.keys(ts).length) {
      f.timestamp = ts;
    }
  }
  node.advancedError = undefined;
  if (node.advanced.trim()) {
    try {
      const extra = JSON.parse(node.advanced);
      if (extra && typeof extra === 'object') {
        Object.assign(f, extra);
      }
    } catch (e) {
      node.advancedError = (e as Error).message;
    }
  }
  return f;
}

let lastGoodDef: FormatDefinition = { name: 'New Binary Format', fields: [] };

function buildDefinition(): FormatDefinition {
  if (model.mode === 'json') {
    model.jsonError = undefined;
    try {
      const parsed = JSON.parse(model.jsonText);
      const def = (Array.isArray(parsed) ? parsed[0] : parsed) as FormatDefinition;
      lastGoodDef = def;
      return def;
    } catch (e) {
      model.jsonError = (e as Error).message;
      return lastGoodDef;
    }
  }
  const def: FormatDefinition = {
    name: model.name.trim(),
    fields: model.tree.map(nodeToField),
    endianness: model.endianness,
  };

  const structs: Record<string, { fields: FieldDefinition[]; description?: string }> = {};
  for (const s of model.structs) {
    const key = s.name.trim();
    if (!key || s.children.length === 0) {
      continue;
    }
    structs[key] = { fields: s.children.map(nodeToField) };
    if (s.description.trim()) {
      structs[key].description = s.description.trim();
    }
  }
  if (Object.keys(structs).length) {
    def.structures = structs;
  }
  if (model.description.trim()) {
    def.description = model.description.trim();
  }
  if (model.version.trim()) {
    def.version = model.version.trim();
  }
  if (model.author.trim()) {
    def.author = model.author.trim();
  }
  const exts = model.fileExtensions
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (exts.length) {
    def.fileExtensions = exts;
  }
  if (model.magicBytes.trim()) {
    def.magic = {
      offset: Number(model.magicOffset.trim() || '0') || 0,
      bytes: model.magicBytes.trim(),
    };
  }

  model.sectionsError = undefined;
  if (model.sectionsJson.trim()) {
    try {
      const parsed = JSON.parse(model.sectionsJson);
      if (Array.isArray(parsed)) {
        def.sections = parsed;
      } else if (parsed && Array.isArray(parsed.sections)) {
        def.sections = parsed.sections;
      } else {
        model.sectionsError = 'expected a JSON array of { name, start, length, flags?, display? }';
      }
    } catch (e) {
      model.sectionsError = (e as Error).message;
    }
  }

  // A sections-only format has no fields.
  if (def.fields && def.fields.length === 0 && def.sections && def.sections.length) {
    delete def.fields;
  }
  return def;
}

// ---- tree operations -------------------------------------------------

interface Location {
  list: EditNode[];
  index: number;
}

function locateIn(id: string, list: EditNode[]): Location | null {
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) {
      return { list, index: i };
    }
    const deeper = locateIn(id, list[i].children);
    if (deeper) {
      return deeper;
    }
  }
  return null;
}

function locate(id: string, list?: EditNode[]): Location | null {
  if (list) {
    return locateIn(id, list);
  }
  const inTree = locateIn(id, model.tree);
  if (inTree) {
    return inTree;
  }
  for (const s of model.structs) {
    const hit = locateIn(id, s.children);
    if (hit) {
      return hit;
    }
  }
  return null;
}

function moveNode(id: string, delta: number): void {
  const loc = locate(id);
  if (!loc) {
    return;
  }
  const j = loc.index + delta;
  if (j < 0 || j >= loc.list.length) {
    return;
  }
  [loc.list[loc.index], loc.list[j]] = [loc.list[j], loc.list[loc.index]];
  changed();
}

function deleteNode(id: string): void {
  const loc = locate(id);
  if (!loc) {
    return;
  }
  loc.list.splice(loc.index, 1);
  changed();
}

function duplicateNode(id: string): void {
  const loc = locate(id);
  if (!loc) {
    return;
  }
  const copy = cloneNode(loc.list[loc.index]);
  copy.name = copy.name ? `${copy.name}_copy` : 'field_copy';
  loc.list.splice(loc.index + 1, 0, copy);
  changed();
}

/** Move a node into the immediately-preceding sibling, if that sibling is a struct. */
function indentNode(id: string): void {
  const loc = locate(id);
  if (!loc || loc.index === 0) {
    return;
  }
  const prev = loc.list[loc.index - 1];
  if (prev.kind !== 'struct') {
    return;
  }
  const [node] = loc.list.splice(loc.index, 1);
  prev.collapsed = false;
  prev.children.push(node);
  changed();
}

/** Move a node out of its parent struct, placing it right after that struct. */
function outdentNode(id: string): void {
  // Find the node's list and, separately, which struct owns that list.
  const found = findWithParent(id, model.tree, null);
  if (!found || !found.parent) {
    return; // already at the top level
  }
  const { parent } = found;
  const parentLoc = locate(parent.id);
  if (!parentLoc) {
    return;
  }
  const idx = parent.children.findIndex((c) => c.id === id);
  const [node] = parent.children.splice(idx, 1);
  parentLoc.list.splice(parentLoc.index + 1, 0, node);
  changed();
}

function findWithParent(
  id: string,
  list: EditNode[],
  parent: EditNode | null,
): { node: EditNode; parent: EditNode | null } | null {
  for (const n of list) {
    if (n.id === id) {
      return { node: n, parent };
    }
    const deeper = findWithParent(id, n.children, n);
    if (deeper) {
      return deeper;
    }
  }
  return null;
}

function addChild(structId: string, kind: EditNode['kind']): void {
  const loc = locate(structId);
  if (!loc) {
    return;
  }
  const s = loc.list[loc.index];
  s.collapsed = false;
  s.children.push(emptyNode(kind));
  changed();
}

/** Add a child to a top-level reusable-structure definition. */
function addStructChild(structDefId: string, kind: EditNode['kind']): void {
  const s = model.structs.find((x) => x.id === structDefId);
  if (!s) {
    return;
  }
  s.collapsed = false;
  s.children.push(emptyNode(kind));
  changed();
}

function addTop(kind: EditNode['kind']): void {
  model.tree.push(emptyNode(kind));
  changed();
}

/** Push a preset node (e.g. an enum field) into a target list. */
function pushNode(target: 'top' | { structId: string } | { structDefId: string }, node: EditNode): void {
  if (target === 'top') {
    model.tree.push(node);
  } else if ('structId' in target) {
    const loc = locate(target.structId);
    if (!loc) {
      return;
    }
    const s = loc.list[loc.index];
    s.collapsed = false;
    s.children.push(node);
  } else {
    const s = model.structs.find((x) => x.id === target.structDefId);
    if (!s) {
      return;
    }
    s.collapsed = false;
    s.children.push(node);
  }
  changed();
}

// ---- rendering -----------------------------------------------------

let errorBox: HTMLElement;
let previewBox: HTMLElement;
let debounce: number | undefined;

function changed(): void {
  render();
  scheduleValidate();
}

function scheduleValidate(): void {
  updatePreview();
  if (debounce) {
    clearTimeout(debounce);
  }
  debounce = window.setTimeout(() => {
    const def = buildDefinition();
    if (model.mode === 'json' && model.jsonError) {
      showErrors(['JSON syntax error: ' + model.jsonError]);
      return;
    }
    post({ type: 'validate', format: def });
  }, 250);
}

function collectAdvErrors(list: EditNode[], pathPrefix: string, out: string[]): void {
  list.forEach((n, i) => {
    const p = `${pathPrefix}${n.name || i}`;
    if (n.advancedError) {
      out.push(`${p}: advanced JSON is invalid — ${n.advancedError}`);
    }
    collectAdvErrors(n.children, `${p} > `, out);
  });
}

function updatePreview(): void {
  if (model.mode === 'json' || !previewBox) {
    return;
  }
  const def = buildDefinition();
  previewBox.textContent = JSON.stringify(def, null, 2);
  const advErrors: string[] = [];
  collectAdvErrors(model.tree, '', advErrors);
  for (const s of model.structs) {
    collectAdvErrors(s.children, `${s.name || 'structure'} > `, advErrors);
  }
  if (model.sectionsError) {
    advErrors.push(`sections: invalid JSON — ${model.sectionsError}`);
  }
  if (advErrors.length) {
    showErrors(advErrors);
  }
}

function showErrors(errors: string[]): void {
  clear(errorBox);
  if (errors.length === 0) {
    errorBox.append(el('span', { class: 'fe-ok', text: 'Valid' }));
    return;
  }
  errorBox.append(el('div', { text: errors.join('\n') }));
}

function flashSaved(): void {
  const note = el('span', { class: 'fe-ok', text: '  Saved.' });
  errorBox.append(note);
  setTimeout(() => note.remove(), 2000);
}

function textField(
  label: string,
  value: string,
  onChange: (v: string) => void,
  opts: { placeholder?: string; width?: number } = {},
): HTMLElement {
  const input = el('input', {
    type: 'text',
    value,
    placeholder: opts.placeholder ?? '',
    oninput: (e) => {
      onChange((e.target as HTMLInputElement).value);
      scheduleValidate();
    },
  }) as HTMLInputElement;
  if (opts.width) {
    input.style.width = `${opts.width}px`;
  }
  return el('div', { class: 'fe-field' }, [el('label', { text: label }), input]);
}

function render(): void {
  if (!init) {
    return;
  }
  clear(app);
  const wrap = el('div', { class: 'fe-wrap' });
  wrap.append(typesDatalist());

  wrap.append(
    el('h1', { text: init.editing ? 'Edit Binary Format' : 'Create Binary Format' }),
    el('div', {
      class: 'fe-hint',
      text: 'Definitions are pure data and are stored as JSON in global storage. Nothing here executes code.',
    }),
  );

  // ---- form / JSON toggle + load-from-file (both modes) ----
  wrap.append(
    el('div', { class: 'fe-tabs' }, [
      el('button', {
        class: 'fe-tab' + (model.mode === 'form' ? ' active' : ''),
        text: 'Form editor',
        onclick: () => switchMode('form'),
      }),
      el('button', {
        class: 'fe-tab' + (model.mode === 'json' ? ' active' : ''),
        text: 'JSON',
        onclick: () => switchMode('json'),
      }),
      el('span', { class: 'fe-spacer' }),
      el('button', {
        class: 'secondary',
        title: 'Start from an existing binary-format JSON file instead of the blank template',
        text: 'Open JSON file…',
        onclick: () => post({ type: 'openJsonFile' }),
      }),
    ]),
  );

  if (model.mode === 'json') {
    renderJsonMode(wrap);
    app.append(wrap);
    updatePreview();
    scheduleValidate();
    return;
  }

  if (model.formLossy) {
    wrap.append(
      el('div', {
        class: 'fe-warn',
        text:
          'This format has fields the form can’t fully show — a multi-dimensional array, or an array whose element is an inline structure. Editing here may drop that detail. Use the JSON tab to keep it.',
      }),
    );
  }

  // ---- meta ----
  wrap.append(el('h2', { text: 'Format' }));
  wrap.append(
    el('div', { class: 'fe-row' }, [
      textField('Name', model.name, (v) => (model.name = v), { width: 260 }),
      textField('Version', model.version, (v) => (model.version = v), { width: 90 }),
      textField('Author', model.author, (v) => (model.author = v), { width: 140 }),
      (() => {
        const sel = el('select', {
          onchange: (e) => {
            model.endianness = (e.target as HTMLSelectElement).value as 'little' | 'big';
            scheduleValidate();
          },
        }) as HTMLSelectElement;
        sel.append(
          el('option', { value: 'little', text: 'Little Endian' }),
          el('option', { value: 'big', text: 'Big Endian' }),
        );
        sel.value = model.endianness;
        return el('div', { class: 'fe-field' }, [el('label', { text: 'Default Endianness' }), sel]);
      })(),
    ]),
  );
  wrap.append(
    el('div', { class: 'fe-row' }, [
      textField('Description', model.description, (v) => (model.description = v), { width: 420 }),
      textField(
        'File Extensions (comma-separated)',
        model.fileExtensions,
        (v) => (model.fileExtensions = v),
        { width: 260, placeholder: '.fw, .img' },
      ),
    ]),
  );
  wrap.append(
    el('div', { class: 'fe-row' }, [
      textField('Magic Offset', model.magicOffset, (v) => (model.magicOffset = v), {
        width: 90,
        placeholder: '0',
      }),
      textField('Magic Bytes (hex)', model.magicBytes, (v) => (model.magicBytes = v), {
        width: 260,
        placeholder: '46 57 01 00',
      }),
    ]),
  );

  // ---- reusable structures ----
  wrap.append(el('h2', { text: 'Reusable structures' }));
  wrap.append(
    el('div', {
      class: 'fe-hint',
      text: 'Define a record layout once here, then pick its name as the "type" of a field or an array element. Ideal for large arrays of records. Child offsets are relative to the structure.',
    }),
  );
  const structsWrap = el('div', { class: 'fe-tree' });
  for (const s of model.structs) {
    renderStructDef(structsWrap, s);
  }
  wrap.append(structsWrap);
  wrap.append(
    addRow(0, [['+ Add Structure Definition', () => {
      model.structs.push(emptyStruct());
      changed();
    }]]),
  );

  // ---- fields tree ----
  wrap.append(el('h2', { text: 'Fields' }));
  wrap.append(
    el('div', {
      class: 'fe-hint',
      text: 'Offsets inside a structure are relative to that structure. Leave Offset blank to pack after the previous sibling. Leave a structure Size blank to size it automatically from its fields.',
    }),
  );
  wrap.append(
    el('div', {
      class: 'fe-hint',
      text: 'For a fixed array — e.g. 8 floats — use "+ Add Array": set count to 8 and the element type to float32. In JSON you can also write the type as "float32[8]" (or "int16[24]", "Sample[100]" for a reusable structure). For a length-prefixed array, put the name of an earlier integer field in the count box instead of a number.',
    }),
  );
  const tree = el('div', { class: 'fe-tree' });
  for (const node of model.tree) {
    renderNode(tree, node, 0);
  }
  wrap.append(tree);
  wrap.append(
    addRow(0, [
      ['+ Add Field', () => addTop('field')],
      ['+ Add Array', () => addTop('array')],
      ['+ Add Enum', () => pushNode('top', enumNode())],
      ['+ Add Structure', () => addTop('struct')],
    ]),
  );

  // ---- sections / memory map ----
  wrap.append(el('h2', { text: 'Sections (memory map)' }));
  wrap.append(
    el('div', {
      class: 'fe-hint',
      text: 'Optional. A JSON array shown in the Sections view: each entry { "name", "start", "length" (or "end"), "flags"?, "display"? }. start/length accept 0x hex. Leave blank to derive rows from the top-level fields instead.',
    }),
  );
  const sectionsTa = el('textarea', {
    value: model.sectionsJson,
    placeholder:
      '[\n  { "name": "main", "start": "0x0000", "length": "0x4000", "flags": "r-x", "display": true },\n  { "name": "config", "start": "0x4000", "length": "0x1000", "flags": "rw-", "display": true }\n]',
    oninput: (e) => {
      model.sectionsJson = (e.target as HTMLTextAreaElement).value;
      scheduleValidate();
    },
  }) as HTMLTextAreaElement;
  sectionsTa.style.minHeight = '120px';
  wrap.append(sectionsTa);
  wrap.append(
    el('div', { class: 'fe-row fe-add-row' }, [
      el('button', {
        class: 'secondary',
        text: '+ Insert example section',
        onclick: () => {
          const example = { name: 'main', start: '0x0000', length: '0x4000', flags: 'r-x', display: true };
          let arr: unknown[] = [];
          try {
            const p = JSON.parse(model.sectionsJson || '[]');
            arr = Array.isArray(p) ? p : [];
          } catch {
            arr = [];
          }
          arr.push(example);
          model.sectionsJson = JSON.stringify(arr, null, 2);
          sectionsTa.value = model.sectionsJson;
          scheduleValidate();
        },
      }),
    ]),
  );

  // ---- preview + errors ----
  wrap.append(el('h2', { text: 'Validation' }));
  errorBox = el('div', { class: 'fe-errors' });
  wrap.append(errorBox);
  wrap.append(el('h2', { text: 'JSON Preview' }));
  previewBox = el('pre', { class: 'fe-preview' });
  wrap.append(previewBox);

  // ---- actions ----
  wrap.append(actionBar());

  app.append(wrap);
  updatePreview();
  post({ type: 'validate', format: buildDefinition() });
}

function renderJsonMode(wrap: HTMLElement): void {
  wrap.append(
    el('div', {
      class: 'fe-hint',
      text: 'Edit the whole definition as JSON — a single object, or an array of objects. Everything the form supports plus multi-dimensional arrays, countField, and reusable structures. Switch to the form when it can represent what you have.',
    }),
  );
  const ta = el('textarea', {
    class: 'fe-json',
    value: model.jsonText,
    spellcheck: false,
    oninput: (e) => {
      model.jsonText = (e.target as HTMLTextAreaElement).value;
      scheduleValidate();
    },
  }) as HTMLTextAreaElement;
  wrap.append(ta);
  wrap.append(
    el('div', { class: 'fe-row fe-add-row' }, [
      el('button', {
        class: 'secondary',
        text: 'Reformat',
        onclick: () => {
          try {
            model.jsonText = JSON.stringify(JSON.parse(model.jsonText), null, 2);
            model.jsonError = undefined;
          } catch (err) {
            model.jsonError = (err as Error).message;
          }
          render();
        },
      }),
    ]),
  );

  wrap.append(el('h2', { text: 'Validation' }));
  errorBox = el('div', { class: 'fe-errors' });
  wrap.append(errorBox);

  wrap.append(actionBar());
}

function switchMode(to: 'form' | 'json'): void {
  if (to === model.mode) {
    return;
  }
  if (to === 'json') {
    // Capture the current form state as text.
    model.jsonText = JSON.stringify(buildDefinition(), null, 2);
    model.jsonError = undefined;
    model.mode = 'json';
    render();
    return;
  }
  // json -> form: parse and rebuild the form model.
  let parsed: FormatDefinition;
  try {
    const raw = JSON.parse(model.jsonText);
    parsed = (Array.isArray(raw) ? raw[0] : raw) as FormatDefinition;
  } catch (e) {
    model.jsonError = (e as Error).message;
    showErrors(['Fix the JSON before switching to the form: ' + model.jsonError]);
    return;
  }
  const carriedText = model.jsonText;
  model = toModel(parsed);
  model.jsonText = carriedText;
  model.mode = 'form';
  render();
}

const BASE_TYPES = () => [...(init?.scalarTypes ?? []), ...(init?.compositeTypes ?? [])];
const structNames = () =>
  model.structs.map((s) => s.name.trim()).filter((n) => n && !BASE_TYPES().includes(n));
const ALL_TYPES = () => [...BASE_TYPES(), ...structNames()];

/** One shared <datalist> of every known type + the user's reusable structures. */
function typesDatalist(): HTMLElement {
  const dl = el('datalist', { id: 'fe-types' });
  for (const t of ALL_TYPES()) {
    dl.append(el('option', { value: t }));
  }
  return dl;
}

/**
 * An editable type field: a text input backed by the `#fe-types` datalist, so
 * you can pick a scalar / composite / structure name *or* type a shorthand like
 * `float32[8]` or `int16[4]` (a nested array).
 */
function typeCombo(value: string, onChange: (v: string) => void): HTMLInputElement {
  const input = el('input', {
    type: 'text',
    value,
    list: 'fe-types',
    class: 'fe-type-combo',
    placeholder: 'type',
    title: 'A type name, a structure name, or a shorthand like float32[8] / int16[4]',
    oninput: (e) => {
      onChange((e.target as HTMLInputElement).value);
      scheduleValidate();
    },
  }) as HTMLInputElement;
  input.style.width = '140px';
  return input;
}

function bindInput(
  node: EditNode,
  key: keyof EditNode,
  opts: { placeholder?: string; width?: number; title?: string } = {},
) {
  const input = el('input', {
    type: 'text',
    value: String(node[key] ?? ''),
    placeholder: opts.placeholder ?? '',
    title: opts.title ?? '',
    oninput: (e) => {
      (node[key] as string) = (e.target as HTMLInputElement).value;
      scheduleValidate();
    },
  }) as HTMLInputElement;
  if (opts.width) {
    input.style.width = `${opts.width}px`;
  }
  return input;
}

function renderNode(parent: HTMLElement, node: EditNode, depth: number): void {
  const rowEl = el('div', {
    class: `fe-node fe-node-${node.kind}`,
    style: `margin-left:${depth * 18}px`,
  });

  const head = el('div', { class: 'fe-node-head' });

  if (node.kind === 'struct') {
    head.append(
      el('span', {
        class: 'fe-toggle',
        text: node.collapsed ? '▶' : '▼',
        onclick: () => {
          node.collapsed = !node.collapsed;
          render();
        },
      }),
      el('span', { class: 'fe-badge', text: 'STRUCT' }),
    );
  } else if (node.kind === 'array') {
    head.append(
      el('span', { class: 'fe-toggle fe-toggle-empty', text: '' }),
      el('span', { class: 'fe-badge', text: 'ARRAY' }),
    );
  } else {
    head.append(el('span', { class: 'fe-toggle fe-toggle-empty', text: '' }));
  }

  head.append(bindInput(node, 'name', { placeholder: 'name', width: 150 }));

  if (node.kind === 'field') {
    head.append(typeCombo(node.type, (v) => (node.type = v)));
  } else if (node.kind === 'array') {
    head.append(
      labelled(
        'count',
        bindInput(node, 'count', {
          width: 90,
          placeholder: 'N or field',
          title:
            'A number for a fixed-length array, or the name of an earlier integer field to take the length from (length-prefixed array).',
        }),
      ),
      el('span', { class: 'fe-inline-label', text: 'of' }),
      typeCombo(node.type, (v) => (node.type = v)),
    );
  } else {
    head.append(el('span', { class: 'fe-badge-type', text: 'structure' }));
  }

  head.append(
    labelled('offset', bindInput(node, 'offset', { placeholder: 'auto', width: 70 })),
    labelled(
      node.kind === 'array' ? 'elem size' : 'size',
      bindInput(node, 'size', { placeholder: node.kind === 'struct' ? 'auto' : '', width: 60 }),
    ),
  );

  if (node.kind === 'field') {
    head.append(labelled('len', bindInput(node, 'length', { width: 55 })));
  }

  const endSel = el('select', {
    onchange: (e) => {
      node.endianness = (e.target as HTMLSelectElement).value;
      scheduleValidate();
    },
  }) as HTMLSelectElement;
  endSel.append(
    el('option', { value: '', text: 'endian: default' }),
    el('option', { value: 'little', text: 'LE' }),
    el('option', { value: 'big', text: 'BE' }),
  );
  endSel.value = node.endianness;
  head.append(endSel);

  // action buttons
  head.append(
    el('span', { class: 'fe-node-actions' }, [
      iconBtn('↑', 'Move up', () => moveNode(node.id, -1)),
      iconBtn('↓', 'Move down', () => moveNode(node.id, 1)),
      iconBtn('⧉', 'Duplicate', () => duplicateNode(node.id)),
      iconBtn('⇤', 'Move out of structure', () => outdentNode(node.id)),
      iconBtn('⇥', 'Move into previous structure', () => indentNode(node.id)),
      iconBtn('✕', 'Delete', () => deleteNode(node.id)),
    ]),
  );

  rowEl.append(head);

  // description + advanced (second line)
  const line2 = el('div', { class: 'fe-node-line2' }, [
    labelled('description', bindInput(node, 'description', { width: 320 })),
  ]);
  if (node.kind === 'field') {
    const enumEd = enumEditor(node);
    if (enumEd) {
      line2.append(enumEd);
    }
    const tsEd = timestampEditor(node);
    if (tsEd) {
      line2.append(tsEd);
    }
    const adv = el('details', { class: 'fe-adv' }, [
      el('summary', {
        text: 'advanced: bits / scale / bias / unit / display' + (node.advancedError ? '  (invalid JSON)' : ''),
      }),
      el('textarea', {
        value: node.advanced,
        placeholder:
          '{ "fields": [ { "name": "Enabled", "bits": "0" } ] }   or   { "scale": 0.01, "unit": "V" }',
        oninput: (e) => {
          node.advanced = (e.target as HTMLTextAreaElement).value;
          scheduleValidate();
        },
      }),
    ]);
    line2.append(adv);
  }
  rowEl.append(line2);

  parent.append(rowEl);

  if (node.kind === 'struct' && !node.collapsed) {
    const kids = el('div', { class: 'fe-children' });
    for (const child of node.children) {
      renderNode(kids, child, depth + 1);
    }
    kids.append(
      addRow((depth + 1) * 18, [
        ['+ Field', () => addChild(node.id, 'field')],
        ['+ Array', () => addChild(node.id, 'array')],
        ['+ Enum', () => pushNode({ structId: node.id }, enumNode())],
        ['+ Structure', () => addChild(node.id, 'struct')],
      ]),
    );
    parent.append(kids);
  }
}

function addRow(marginLeft: number, buttons: [string, () => void][]): HTMLElement {
  return el(
    'div',
    { class: 'fe-row fe-add-row', style: `margin-left:${marginLeft}px` },
    buttons.map(([text, onclick]) => el('button', { class: 'secondary icon-text', text, onclick })),
  );
}

/** The sticky Save / Save draft / Validate / Close bar, shared by both modes. */
function actionBar(): HTMLElement {
  return el('div', { class: 'fe-actions' }, [
    el('button', { text: 'Save', onclick: () => post({ type: 'save', format: buildDefinition() }) }),
    el('button', {
      class: 'secondary',
      title: 'Write the JSON to global storage even if it has validation problems',
      text: 'Save draft',
      onclick: () => post({ type: 'saveDraft', format: buildDefinition() }),
    }),
    el('button', {
      class: 'secondary',
      text: 'Validate',
      onclick: () => post({ type: 'validate', format: buildDefinition() }),
    }),
    el('button', { class: 'secondary', text: 'Close', onclick: () => post({ type: 'cancel' }) }),
  ]);
}

/** Inline value→label table for an `enum` field (or an enum overlay on a scalar). */
function enumEditor(node: EditNode): HTMLElement | null {
  const isEnum = node.type.trim() === 'enum';
  if (!isEnum && node.enumRows.length === 0) {
    // Offer to start an overlay only on integer scalars.
    const scalarInts = new Set(['uint8', 'int8', 'uint16', 'int16', 'uint32', 'int32', 'byte']);
    if (!scalarInts.has(node.type.trim())) {
      return null;
    }
    return el('details', { class: 'fe-adv' }, [
      el('summary', { text: 'enum overlay' }),
      el('div', { class: 'fe-row fe-add-row' }, [
        el('button', {
          class: 'secondary icon-text',
          text: '+ enum value',
          onclick: () => {
            node.enumRows.push({ value: '0', label: '' });
            changed();
          },
        }),
      ]),
    ]);
  }
  const box = el('details', { class: 'fe-adv', open: true }, [
    el('summary', { text: `enum values (${node.enumRows.length})` }),
  ]);
  for (const row of node.enumRows) {
    box.append(
      el('div', { class: 'fe-row fe-enum-row' }, [
        el('input', {
          type: 'text',
          value: row.value,
          placeholder: 'value',
          title: 'Numeric value (decimal or 0x…)',
          oninput: (e) => {
            row.value = (e.target as HTMLInputElement).value;
            scheduleValidate();
          },
        }),
        el('span', { class: 'fe-inline-label', text: '→' }),
        el('input', {
          type: 'text',
          value: row.label,
          placeholder: 'label',
          oninput: (e) => {
            row.label = (e.target as HTMLInputElement).value;
            scheduleValidate();
          },
        }),
        iconBtn('✕', 'Remove value', () => {
          node.enumRows = node.enumRows.filter((r) => r !== row);
          changed();
        }),
      ]),
    );
  }
  box.append(
    el('div', { class: 'fe-row fe-add-row' }, [
      el('button', {
        class: 'secondary icon-text',
        text: '+ value',
        onclick: () => {
          const last = node.enumRows[node.enumRows.length - 1];
          const next = last ? String((parseInt(last.value, last.value.startsWith('0x') ? 16 : 10) || 0) + 1) : '0';
          node.enumRows.push({ value: next, label: '' });
          changed();
        },
      }),
    ]),
  );
  return box;
}

/** Structured `timestamp` config (size / unit / epoch) instead of raw JSON. */
function timestampEditor(node: EditNode): HTMLElement | null {
  if (node.type.trim() !== 'timestamp' && !node.tsSize && !node.tsUnit && !node.tsEpoch) {
    return null;
  }
  const sel = (
    label: string,
    value: string,
    options: [string, string][],
    onChange: (v: string) => void,
  ): HTMLElement => {
    const s = el('select', {
      onchange: (e) => {
        onChange((e.target as HTMLSelectElement).value);
        scheduleValidate();
      },
    }) as HTMLSelectElement;
    for (const [v, t] of options) {
      s.append(el('option', { value: v, text: t }));
    }
    s.value = value;
    return labelled(label, s);
  };
  return el('div', { class: 'fe-row fe-ts-row' }, [
    sel('bytes', node.tsSize, [['', 'default (4)'], ['4', '4'], ['8', '8']], (v) => (node.tsSize = v)),
    sel('unit', node.tsUnit, [['', 'default (s)'], ['s', 'seconds'], ['ms', 'ms']], (v) => (node.tsUnit = v)),
    sel(
      'epoch',
      node.tsEpoch,
      [
        ['', 'setting default'],
        ['unix', 'unix (1970)'],
        ['y2k', 'y2k (2000)'],
        ['gps', 'gps (1980)'],
        ['mac', 'mac (1904)'],
        ['filetime', 'filetime (1601)'],
      ],
      (v) => (node.tsEpoch = v),
    ),
  ]);
}

function renderStructDef(parent: HTMLElement, s: EditStruct): void {
  const card = el('div', { class: 'fe-node fe-node-structdef' });
  const head = el('div', { class: 'fe-node-head' }, [
    el('span', {
      class: 'fe-toggle',
      text: s.collapsed ? '▶' : '▼',
      onclick: () => {
        s.collapsed = !s.collapsed;
        render();
      },
    }),
    el('span', { class: 'fe-badge', text: 'DEF' }),
    (() => {
      const input = el('input', {
        type: 'text',
        value: s.name,
        placeholder: 'StructureName',
        oninput: (e) => {
          s.name = (e.target as HTMLInputElement).value;
          scheduleValidate();
        },
      }) as HTMLInputElement;
      input.style.width = '180px';
      return input;
    })(),
    labelled(
      'description',
      (() => {
        const input = el('input', {
          type: 'text',
          value: s.description,
          oninput: (e) => {
            s.description = (e.target as HTMLInputElement).value;
            scheduleValidate();
          },
        }) as HTMLInputElement;
        input.style.width = '260px';
        return input;
      })(),
    ),
    el('span', { class: 'fe-node-actions' }, [
      iconBtn('✕', 'Delete structure definition', () => {
        model.structs = model.structs.filter((x) => x.id !== s.id);
        changed();
      }),
    ]),
  ]);
  card.append(head);
  parent.append(card);

  if (!s.collapsed) {
    const kids = el('div', { class: 'fe-children' });
    for (const child of s.children) {
      renderNode(kids, child, 1);
    }
    kids.append(
      addRow(18, [
        ['+ Field', () => addStructChild(s.id, 'field')],
        ['+ Array', () => addStructChild(s.id, 'array')],
        ['+ Enum', () => pushNode({ structDefId: s.id }, enumNode())],
        ['+ Structure', () => addStructChild(s.id, 'struct')],
      ]),
    );
    parent.append(kids);
  }
}

function labelled(label: string, control: HTMLElement): HTMLElement {
  return el('span', { class: 'fe-inline-field' }, [
    el('label', { class: 'fe-inline-label', text: label }),
    control,
  ]);
}

function iconBtn(text: string, title: string, onClick: () => void): HTMLElement {
  return el('button', { class: 'icon secondary', text, title, onclick: onClick });
}
