/* eslint-disable */
'use strict';

/**
 * Renders the HTML mockups in docs/mockups/ to PNGs in docs/images/ using
 * headless Chrome/Edge. The mockups load the extension's real media/style.css,
 * so the screenshots track the actual UI. Run after changing the styles:
 *
 *   node scripts/gen-screenshots.js
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'images');
fs.mkdirSync(OUT, { recursive: true });

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const browser = CANDIDATES.find((p) => {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
});

if (!browser) {
  console.error('No Chrome/Edge found. Set CHROME_PATH to a Chromium binary.');
  process.exit(1);
}
console.log('Using browser:', browser);

// The editor mockup reuses the real format-editor stylesheet (a TS template string).
{
  const ts = fs.readFileSync(path.join(ROOT, 'src', 'webview', 'formatEditor', 'styles.ts'), 'utf8');
  const m = /FORMAT_EDITOR_CSS = `([\s\S]*?)`;/.exec(ts);
  if (!m) {
    console.error('Could not extract FORMAT_EDITOR_CSS from styles.ts');
    process.exit(1);
  }
  fs.writeFileSync(path.join(ROOT, 'docs', 'mockups', 'editor.generated.css'), m[1]);
}

const shots = [
  { html: 'raw.html', png: 'raw-view.png', size: '1420,640' },
  { html: 'structure.html', png: 'structure-view.png', size: '1420,470' },
  { html: 'sections.html', png: 'sections-view.png', size: '1420,430' },
  { html: 'editor.html', png: 'editor-view.png', size: '1420,640' },
];

for (const { html, png, size } of shots) {
  const src = path.join(ROOT, 'docs', 'mockups', html);
  const dst = path.join(OUT, png);
  const url = 'file:///' + src.replace(/\\/g, '/');
  execFileSync(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-color-profile=srgb',
      '--default-background-color=00000000',
      `--window-size=${size}`,
      '--run-all-compositor-stages-before-draw',
      '--virtual-time-budget=2500',
      `--screenshot=${dst}`,
      url,
    ],
    { stdio: 'inherit' },
  );
  const kb = (fs.statSync(dst).size / 1024).toFixed(1);
  console.log(`  ${png}  (${kb} KB)`);
}

console.log('Done.');
