import { post, saveState, loadState, logToHost } from './vscodeApi';
import { el, clear, base64ToBytes } from './dom';
import { Store, AppState, selectBytes, resolveGotoTarget } from './state';
import { DataProvider } from './DataProvider';
import { HexView } from './HexView';
import { StructureView } from './StructureView';
import { SectionsView } from './SectionsView';
import { Inspector } from './Inspector';
import { Toolbar } from './Toolbar';
import { SearchBar } from './SearchBar';
import { StatusBar } from './StatusBar';
import type { HostToWebview, ViewMode } from '../types/messages';

const appRoot = document.getElementById('app')!;

let store: Store;
let data: DataProvider;
let hexView: HexView;
let searchBar: SearchBar;
let hexEl: HTMLElement;
let structEl: HTMLElement;
let sectionsEl: HTMLElement;
let booted = false;

window.addEventListener('message', (ev: MessageEvent<HostToWebview>) => handleMessage(ev.data));

// Tell the host we are ready to receive `init`.
post({ type: 'ready' });

function handleMessage(msg: HostToWebview): void {
  switch (msg.type) {
    case 'init':
      boot(msg);
      break;
    case 'range':
      data?.receive(msg.requestId, msg.offset, base64ToBytes(msg.data));
      break;
    case 'parseResult':
      if (store) {
        store.update({
          parsed: msg.nodes,
          sections: msg.sections,
          parseError: msg.error ?? null,
          formatBaseAddress: msg.baseAddress,
        });
      }
      break;
    case 'formats':
      if (store) {
        const cleared =
          msg.activeFormat === null
            ? { parsed: [], sections: [], formatBaseAddress: null }
            : {};
        store.update({ formats: msg.formats, activeFormat: msg.activeFormat, ...cleared });
      }
      break;
    case 'searchResult':
      searchBar?.onResult(msg.query, msg.matches, msg.done);
      break;
    case 'gotoOffset':
      if (store) {
        const target = resolveGotoTarget(store.state, msg.offset);
        selectBytes(store, target, msg.select ?? 1);
        hexView.revealOffset(target);
        afterSelectionChange();
      }
      break;
    case 'selectRange':
      if (store) {
        selectBytes(store, msg.offset, msg.length);
        if (msg.reveal !== false) {
          hexView.revealOffset(msg.offset);
        }
        afterSelectionChange();
      }
      break;
    case 'setView':
      setView(msg.view);
      break;
    case 'toggleView': {
      const target = msg.target ?? 'structure';
      setView(store.state.view === target ? 'raw' : target);
      break;
    }
    case 'toggleInspector':
      store.update({ showInspector: !store.state.showInspector });
      persist();
      break;
    case 'showFieldInRaw':
      setView('raw');
      hexView.revealOffset(store.state.selection.start);
      break;
    case 'setBytesPerRow':
      store.update({ bytesPerRow: msg.bytesPerRow });
      persist();
      break;
    case 'setEndianness':
      store.update({ endianness: msg.endianness });
      persist();
      break;
    case 'focusSearch':
      searchBar.show();
      break;
    case 'searchNav':
      searchBar.nav(msg.direction);
      break;
    case 'error':
      showToast(msg.message);
      break;
  }
}

function boot(msg: Extract<HostToWebview, { type: 'init' }>): void {
  if (booted) {
    return;
  }
  booted = true;
  const persisted = loadState();

  const activeFormat = msg.activeFormat ?? persisted.activeFormat ?? null;
  // Remembered tab wins; otherwise the configured default, but structure /
  // sections need a format — fall back to raw when there is none.
  let view = persisted.view ?? msg.config.defaultView ?? 'raw';
  if ((view === 'structure' || view === 'sections') && !activeFormat) {
    view = 'raw';
  }

  const initial: AppState = {
    fileSize: msg.fileSize,
    fileName: msg.fileName,
    view,
    bytesPerRow: persisted.bytesPerRow ?? msg.config.bytesPerRow,
    byteGroup: persisted.byteGroup ?? msg.config.byteGroup,
    endianness: persisted.endianness ?? msg.config.defaultEndianness,
    showInspector: persisted.showInspector ?? msg.config.showInspector,
    caret: 0,
    anchor: 0,
    selection: { start: 0, length: 1 },
    formats: msg.formats,
    activeFormat,
    detectedFormat: msg.detectedFormat,
    parsed: [],
    parseError: null,
    activeNodeId: null,
    sections: [],
    activeSectionName: null,
    blockSizeBytes: msg.config.blockSizeBytes,
    maxSearchResults: msg.config.maxSearchResults,
    baseAddress: msg.config.baseAddress,
    formatBaseAddress: null,
  };

  store = new Store(initial);
  data = new DataProvider(msg.fileSize, msg.config.blockSizeBytes);

  clear(appRoot);
  const toolbarEl = el('div');
  const bodyEl = el('div', { class: 'bv-body' });
  const mainEl = el('div', { class: 'bv-main' });
  const searchEl = el('div');
  hexEl = el('div');
  structEl = el('div');
  sectionsEl = el('div');
  const inspectorEl = el('div');
  const statusEl = el('div');
  mainEl.append(searchEl, hexEl, structEl, sectionsEl);
  bodyEl.append(mainEl, inspectorEl);
  appRoot.append(toolbarEl, bodyEl, statusEl);

  searchBar = new SearchBar(searchEl, store, {
    onSelect: (offset, length) => {
      selectBytes(store, offset, length);
      hexView.revealOffset(offset);
      afterSelectionChange();
    },
  });

  new Toolbar(toolbarEl, store, {
    onToggleSearch: () => searchBar.toggle(),
    onGoto: (offset) => {
      const target = resolveGotoTarget(store.state, offset);
      selectBytes(store, target, 1);
      hexView.revealOffset(target);
      afterSelectionChange();
    },
  });

  hexView = new HexView(hexEl, store, data, {
    onSelectionChange: () => afterSelectionChange(),
  });
  new StructureView(structEl, store, {
    onRevealField: (offset) => {
      setView('raw');
      hexView.revealOffset(offset);
    },
  });
  new SectionsView(sectionsEl, store, {
    onRevealSection: (start) => {
      setView('raw');
      hexView.revealOffset(start);
    },
  });
  new Inspector(inspectorEl, store, data);
  new StatusBar(statusEl, store, data);

  store.subscribe((_s, changed) => {
    if (changed.has('view')) {
      applyViewVisibility();
    }
  });

  applyViewVisibility();
  hexView.layout();

  if (store.state.activeFormat) {
    post({ type: 'requestParse', formatName: store.state.activeFormat, endianness: store.state.endianness });
  }

  logToHost('info', `viewer booted: ${msg.fileName} (${msg.fileSize} bytes)`);
}

function setView(view: ViewMode): void {
  const needsParse =
    (view === 'structure' || view === 'sections') &&
    store.state.activeFormat &&
    store.state.parsed.length === 0 &&
    store.state.sections.length === 0;
  if (needsParse) {
    post({
      type: 'requestParse',
      formatName: store.state.activeFormat!,
      endianness: store.state.endianness,
    });
  }
  store.update({ view });
  persist();
}

function applyViewVisibility(): void {
  const v = store.state.view;
  hexEl.hidden = v !== 'raw';
  structEl.hidden = v !== 'structure';
  sectionsEl.hidden = v !== 'sections';
  if (v === 'raw') {
    hexView.layout();
    hexView.focus();
  }
}

function afterSelectionChange(): void {
  post({
    type: 'selectionChanged',
    offset: store.state.selection.start,
    length: store.state.selection.length,
  });
}

function persist(): void {
  const s = store.state;
  saveState({
    view: s.view,
    bytesPerRow: s.bytesPerRow,
    byteGroup: s.byteGroup,
    endianness: s.endianness,
    showInspector: s.showInspector,
    activeFormat: s.activeFormat,
  });
  post({
    type: 'persistState',
    state: {
      view: s.view,
      bytesPerRow: s.bytesPerRow,
      byteGroup: s.byteGroup,
      endianness: s.endianness,
      showInspector: s.showInspector,
      scrollTop: hexView?.scrollTop ?? 0,
      activeFormat: s.activeFormat,
    },
  });
}

let toastTimer: number | undefined;
function showToast(message: string): void {
  let toast = document.querySelector('.bv-toast') as HTMLElement | null;
  if (!toast) {
    toast = el('div', { class: 'bv-toast' });
    appRoot.append(toast);
  }
  toast.textContent = message;
  toast.classList.add('bv-toast-show');
  if (toastTimer) {
    clearTimeout(toastTimer);
  }
  toastTimer = window.setTimeout(() => toast?.classList.remove('bv-toast-show'), 4000);
}
