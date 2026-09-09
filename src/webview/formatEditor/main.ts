import { el, clear } from '../dom';
import { FORMAT_EDITOR_CSS } from './styles';
import type { FormatDefinition, FieldDefinition, MagicSpec } from '../../types/format';
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
/** Working copy. `fields` are stored with their advanced JSON as a string. */
interface EditRow {
  name: string;
  type: string;
  offset: string;
  size: string;
  length: string;
  endianness: string;
  description: string;
  advanced: string;
  advancedError?: string;
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
  rows: EditRow[];
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

// ---- model <-> definition -------------------------------------------

function toModel(def: FormatDefinition | null): Model {
  const magic: MagicSpec | undefined = def
    ? Array.isArray(def.magic)
      ? def.magic[0]
      : def.magic
    : undefined;
  return {
    name: def?.name ?? 'New Binary Format',
    description: def?.description ?? '',
    version: def?.version ?? '',
    author: def?.author ?? '',
    fileExtensions: (def?.fileExtensions ?? []).join(', '),
    endianness: def?.endianness ?? 'little',
    magicOffset: magic ? String(magic.offset) : '',
    magicBytes: magic?.bytes ?? '',
    rows: (def?.fields ?? []).map(fieldToRow),
  };
}

const KNOWN_KEYS = new Set([
  'name',
  'type',
  'offset',
  'size',
  'length',
  'endianness',
  'description',
]);

function fieldToRow(f: FieldDefinition): EditRow {
  const advanced: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f)) {
    if (!KNOWN_KEYS.has(k)) {
      advanced[k] = v;
    }
  }
  return {
    name: f.name ?? '',
    type: f.type ?? 'uint8',
    offset: f.offset === undefined ? '' : String(f.offset),
    size: f.size === undefined ? '' : String(f.size),
    length: f.length === undefined ? '' : String(f.length),
    endianness: f.endianness ?? '',
    description: f.description ?? '',
    advanced: Object.keys(advanced).length ? JSON.stringify(advanced, null, 2) : '',
  };
}

function rowToField(row: EditRow): FieldDefinition {
  const f: FieldDefinition = { name: row.name.trim(), type: row.type.trim() };
  const num = (s: string) => {
    const t = s.trim();
    if (t === '') {
      return undefined;
    }
    return t.toLowerCase().startsWith('0x') ? parseInt(t, 16) : Number(t);
  };
  const off = num(row.offset);
  if (off !== undefined && Number.isFinite(off)) {
    f.offset = off;
  }
  const sz = num(row.size);
  if (sz !== undefined && Number.isFinite(sz)) {
    f.size = sz;
  }
  const len = num(row.length);
  if (len !== undefined && Number.isFinite(len)) {
    f.length = len;
  }
  if (row.endianness === 'little' || row.endianness === 'big') {
    f.endianness = row.endianness;
  }
  if (row.description.trim()) {
    f.description = row.description.trim();
  }
  row.advancedError = undefined;
  if (row.advanced.trim()) {
    try {
      const extra = JSON.parse(row.advanced);
      if (extra && typeof extra === 'object') {
        Object.assign(f, extra);
      }
    } catch (e) {
      row.advancedError = (e as Error).message;
    }
  }
  return f;
}

function buildDefinition(): FormatDefinition {
  const def: FormatDefinition = {
    name: model.name.trim(),
    fields: model.rows.map(rowToField),
    endianness: model.endianness,
  };
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
  return def;
}

// ---- rendering -----------------------------------------------------

let errorBox: HTMLElement;
let previewBox: HTMLElement;
let debounce: number | undefined;

function scheduleValidate(): void {
  updatePreview();
  if (debounce) {
    clearTimeout(debounce);
  }
  debounce = window.setTimeout(() => {
    post({ type: 'validate', format: buildDefinition() });
  }, 250);
}

function updatePreview(): void {
  const def = buildDefinition();
  previewBox.textContent = JSON.stringify(def, null, 2);
  const advErrors = model.rows
    .map((r, i) => (r.advancedError ? `fields[${i}] advanced JSON: ${r.advancedError}` : ''))
    .filter(Boolean);
  if (advErrors.length) {
    showErrors(advErrors);
  }
}

function showErrors(errors: string[]): void {
  clear(errorBox);
  if (errors.length === 0) {
    errorBox.append(el('span', { class: 'fe-ok', text: 'Valid ✓' }));
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

  wrap.append(
    el('h1', { text: init.editing ? 'Edit Binary Format' : 'Create Binary Format' }),
    el('div', {
      class: 'fe-hint',
      text: 'Definitions are pure data and are stored as JSON in global storage. Nothing here executes code.',
    }),
  );

  // ---- meta ----
  wrap.append(el('h2', { text: 'Format' }));
  const meta1 = el('div', { class: 'fe-row' }, [
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
  ]);
  wrap.append(meta1);
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

  // ---- fields ----
  wrap.append(el('h2', { text: 'Fields' }));
  wrap.append(renderFieldsTable());
  wrap.append(
    el('button', {
      class: 'secondary',
      text: '+ Add Field',
      onclick: () => {
        model.rows.push({
          name: `field${model.rows.length}`,
          type: 'uint8',
          offset: '',
          size: '',
          length: '',
          endianness: '',
          description: '',
          advanced: '',
        });
        render();
        scheduleValidate();
      },
    }),
  );

  // ---- preview + errors ----
  wrap.append(el('h2', { text: 'Validation' }));
  errorBox = el('div', { class: 'fe-errors' });
  wrap.append(errorBox);
  wrap.append(el('h2', { text: 'JSON Preview' }));
  previewBox = el('pre', { class: 'fe-preview' });
  wrap.append(previewBox);

  // ---- actions ----
  wrap.append(
    el('div', { class: 'fe-actions' }, [
      el('button', { text: 'Save', onclick: () => post({ type: 'save', format: buildDefinition() }) }),
      el('button', {
        class: 'secondary',
        text: 'Validate',
        onclick: () => post({ type: 'validate', format: buildDefinition() }),
      }),
      el('button', { class: 'secondary', text: 'Close', onclick: () => post({ type: 'cancel' }) }),
    ]),
  );

  app.append(wrap);
  updatePreview();
  post({ type: 'validate', format: buildDefinition() });
}

function renderFieldsTable(): HTMLElement {
  const table = el('table', { class: 'fe-fields' });
  table.append(
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: '' }),
        el('th', { text: 'Name' }),
        el('th', { text: 'Type' }),
        el('th', { text: 'Offset' }),
        el('th', { text: 'Size' }),
        el('th', { text: 'Length' }),
        el('th', { text: 'Endian' }),
        el('th', { text: 'Description' }),
        el('th', { text: '' }),
      ]),
    ]),
  );
  const tbody = el('tbody');
  const allTypes = [...(init?.scalarTypes ?? []), ...(init?.compositeTypes ?? [])];

  model.rows.forEach((row, i) => {
    const cellInput = (
      key: keyof EditRow,
      opts: { narrow?: boolean; placeholder?: string } = {},
    ) => {
      const input = el('input', {
        type: 'text',
        value: String(row[key] ?? ''),
        placeholder: opts.placeholder ?? '',
        oninput: (e) => {
          (row[key] as string) = (e.target as HTMLInputElement).value;
          scheduleValidate();
        },
      });
      return el('td', { class: opts.narrow ? 'fe-cell-narrow' : '' }, [input]);
    };

    const typeSel = el('select', {
      onchange: (e) => {
        row.type = (e.target as HTMLSelectElement).value;
        scheduleValidate();
      },
    }) as HTMLSelectElement;
    for (const t of allTypes) {
      typeSel.append(el('option', { value: t, text: t }));
    }
    if (!allTypes.includes(row.type)) {
      typeSel.append(el('option', { value: row.type, text: row.type }));
    }
    typeSel.value = row.type;

    const endSel = el('select', {
      onchange: (e) => {
        row.endianness = (e.target as HTMLSelectElement).value;
        scheduleValidate();
      },
    }) as HTMLSelectElement;
    endSel.append(
      el('option', { value: '', text: '(default)' }),
      el('option', { value: 'little', text: 'LE' }),
      el('option', { value: 'big', text: 'BE' }),
    );
    endSel.value = row.endianness;

    const advDetails = el('details', { class: 'fe-adv' }, [
      el('summary', {
        text:
          'advanced: bits / enum / items / timestamp' + (row.advancedError ? '  ⚠ invalid JSON' : ''),
      }),
      el('textarea', {
        value: row.advanced,
        placeholder:
          '{ "fields": [ { "name": "Enabled", "bits": "0" } ] }  or  { "enum": { "0": "off", "1": "on" } }',
        oninput: (e) => {
          row.advanced = (e.target as HTMLTextAreaElement).value;
          scheduleValidate();
        },
      }),
    ]);

    const move = (delta: number) => {
      const j = i + delta;
      if (j < 0 || j >= model.rows.length) {
        return;
      }
      [model.rows[i], model.rows[j]] = [model.rows[j], model.rows[i]];
      render();
      scheduleValidate();
    };

    const nameCell = el('td', {}, [
      el('input', {
        type: 'text',
        value: row.name,
        oninput: (e) => {
          row.name = (e.target as HTMLInputElement).value;
          scheduleValidate();
        },
      }),
      advDetails,
    ]);

    tbody.append(
      el('tr', {}, [
        el('td', { class: 'fe-cell-narrow' }, [
          el('button', { class: 'icon secondary', text: '↑', onclick: () => move(-1) }),
          el('button', { class: 'icon secondary', text: '↓', onclick: () => move(1) }),
        ]),
        nameCell,
        el('td', {}, [typeSel]),
        cellInput('offset', { narrow: true, placeholder: 'auto' }),
        cellInput('size', { narrow: true }),
        cellInput('length', { narrow: true }),
        el('td', {}, [endSel]),
        cellInput('description'),
        el('td', { class: 'fe-cell-narrow' }, [
          el('button', {
            class: 'icon secondary',
            text: '✕',
            title: 'Remove field',
            onclick: () => {
              model.rows.splice(i, 1);
              render();
              scheduleValidate();
            },
          }),
        ]),
      ]),
    );
  });
  table.append(tbody);
  return table;
}
