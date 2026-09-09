export const FORMAT_EDITOR_CSS = `
:root { color-scheme: light dark; }
body {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size, 13px);
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
  margin: 0;
}
.fe-wrap { display: flex; flex-direction: column; gap: 14px; padding: 16px; max-width: 1100px; }
h1 { font-size: 1.3em; margin: 0; }
h2 { font-size: 1.05em; margin: 12px 0 4px; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 4px; }
.fe-row { display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end; }
.fe-field { display: flex; flex-direction: column; gap: 3px; }
.fe-field label { font-size: 0.85em; opacity: 0.8; }
input[type=text], input[type=number], select, textarea {
  font-family: inherit; font-size: inherit;
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
  border-radius: 2px; padding: 4px 6px; box-sizing: border-box;
}
input:focus, select:focus, textarea:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
textarea { font-family: var(--vscode-editor-font-family, monospace); width: 100%; min-height: 60px; resize: vertical; }
button {
  font-family: inherit; font-size: inherit; cursor: pointer;
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
  border: 1px solid var(--vscode-button-border, transparent);
  border-radius: 2px; padding: 5px 12px;
}
button:hover { background: var(--vscode-button-hoverBackground); }
button.secondary {
  color: var(--vscode-button-secondaryForeground);
  background: var(--vscode-button-secondaryBackground);
}
button.icon { padding: 2px 7px; }
table.fe-fields { border-collapse: collapse; width: 100%; }
table.fe-fields th, table.fe-fields td { border: 1px solid var(--vscode-panel-border); padding: 4px 6px; text-align: left; vertical-align: top; }
table.fe-fields th { background: var(--vscode-editorWidget-background); font-weight: 600; }
table.fe-fields input[type=text] { width: 100%; }
.fe-cell-narrow input { width: 68px; }
.fe-adv { margin-top: 4px; }
.fe-adv summary { cursor: pointer; opacity: 0.8; font-size: 0.85em; }
.fe-errors { border: 1px solid var(--vscode-inputValidation-errorBorder, #b00); background: var(--vscode-inputValidation-errorBackground, rgba(180,0,0,0.1)); padding: 8px 10px; border-radius: 3px; white-space: pre-wrap; }
.fe-ok { color: var(--vscode-testing-iconPassed, #3c3); }
.fe-preview { font-family: var(--vscode-editor-font-family, monospace); background: var(--vscode-textCodeBlock-background); padding: 10px; border-radius: 3px; white-space: pre; overflow: auto; max-height: 320px; }
.fe-actions { display: flex; gap: 10px; position: sticky; bottom: 0; padding: 10px 0; background: var(--vscode-editor-background); }
.fe-hint { opacity: 0.7; font-size: 0.85em; }
.fe-tabs { display: flex; gap: 4px; }
.fe-tab { padding: 4px 12px; cursor: pointer; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: 1px solid var(--vscode-button-border, transparent); border-radius: 3px; }
.fe-tab.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
.fe-warn { border: 1px solid var(--vscode-inputValidation-warningBorder, #b80); background: var(--vscode-inputValidation-warningBackground, rgba(200,140,0,0.12)); padding: 8px 10px; border-radius: 3px; white-space: pre-wrap; font-size: 0.9em; }
.fe-json { min-height: 380px; }

/* ---- nested-structure tree editor ---- */
.fe-tree { display: flex; flex-direction: column; gap: 6px; }
.fe-node {
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  padding: 6px 8px;
  background: var(--vscode-editor-background);
}
.fe-node-struct { background: var(--vscode-editorWidget-background); border-color: var(--vscode-focusBorder); }
.fe-node-array { background: var(--vscode-editorWidget-background); }
.fe-node-structdef { background: var(--vscode-editorWidget-background); border-color: var(--vscode-focusBorder); border-style: dashed; }
select optgroup { font-style: italic; }
.fe-node-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.fe-node-line2 { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 10px; margin-top: 4px; }
.fe-children { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
.fe-toggle {
  cursor: pointer; width: 1.1em; text-align: center; user-select: none;
  color: var(--vscode-descriptionForeground); font-size: 0.85em;
}
.fe-toggle-empty { cursor: default; }
.fe-badge {
  font-size: 0.7em; font-weight: 700; letter-spacing: 0.05em;
  padding: 1px 5px; border-radius: 3px;
  background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
}
.fe-badge-type { font-size: 0.8em; opacity: 0.7; }
.fe-inline-field { display: inline-flex; flex-direction: column; gap: 2px; }
.fe-inline-label { font-size: 0.7em; opacity: 0.65; }
.fe-node-actions { display: inline-flex; gap: 3px; margin-left: auto; }
.fe-node-actions button.icon { padding: 1px 6px; }
.fe-add-row { gap: 8px; margin-top: 2px; }
button.icon-text { padding: 3px 9px; font-size: 0.9em; }
`;
