// Shared toolbar for the screenshot mockups — mirrors src/webview/Toolbar.ts.
// opts: { view: 'raw'|'structure'|'sections', format, version, inspector, fieldColors, offset }
function buildToolbar(h, opts) {
  const tb = h('div', 'bv-toolbar');
  const seg = h('div', 'bv-segmented');
  for (const [id, label] of [['raw', 'Raw'], ['structure', 'Structure'], ['sections', 'Sections']]) {
    seg.append(h('button', 'bv-seg' + (opts.view === id ? ' bv-seg-active' : ''), label));
  }
  tb.append(seg);
  const tool = (label, ...children) => {
    const w = h('span', 'bv-tool');
    w.append(h('label', 'bv-label', label), ...children);
    return w;
  };
  const select = (...options) => {
    const s = h('select', 'bv-select');
    options.forEach((o) => s.append(h('option', null, o)));
    return s;
  };
  tb.append(tool('Section:', h('button', 'bv-btn bv-btn-sm bv-btn-icon', '◀'), h('button', 'bv-btn bv-btn-sm bv-btn-icon', '▶')));
  tb.append(tool('Bytes:', select('16')), tool('Group:', select('1 byte')), tool('Endian:', select('Little Endian')));
  const fmt = tool('Format:', select(`Format: ${opts.format}${opts.version ? ' — v' + opts.version : ''} (detected)`));
  if (opts.version) fmt.append(h('span', 'bv-dim bv-format-version', 'v' + opts.version));
  fmt.append(h('button', 'bv-btn bv-btn-sm bv-btn-icon', '↻'));
  tb.append(fmt, h('span', 'bv-spacer'));
  tb.append(
    h('button', 'bv-btn' + (opts.inspector ? ' bv-btn-active' : ''), 'Inspector'),
    h('button', 'bv-btn' + (opts.fieldColors ? ' bv-btn-active' : ''), 'Field Colors'),
    h('button', 'bv-btn', 'Search'),
    h('button', 'bv-btn', 'Go To'),
    h('span', 'bv-offset-readout bv-mono', opts.offset),
  );
  return tb;
}
