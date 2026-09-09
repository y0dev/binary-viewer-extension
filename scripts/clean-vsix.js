/* eslint-disable */
'use strict';

/**
 * Deletes any previously packaged .vsix files from the project root so
 * `npm run package` always leaves exactly one — the current version.
 *
 *   node scripts/clean-vsix.js
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
let removed = 0;

for (const name of fs.readdirSync(root)) {
  if (name.toLowerCase().endsWith('.vsix')) {
    fs.rmSync(path.join(root, name), { force: true });
    console.log(`removed ${name}`);
    removed++;
  }
}

if (removed === 0) {
  console.log('no .vsix files to remove');
}
