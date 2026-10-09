/* eslint-disable */
'use strict';

// Runs as `preinstall`, before any dependency is fetched, so a too-old Node
// (common on WSL / older Ubuntu, which still ships Node 12/14) fails here with a
// clear message instead of a confusing EBADENGINE deep in the tree.

var major = parseInt(process.versions.node.split('.')[0], 10);
var MIN = '20.19+ (20.x), 22.13+ (22.x), or 24+';
var minor = parseInt(process.versions.node.split('.')[1], 10);

if (!((major === 20 && minor >= 19) || (major === 22 && minor >= 13) || major >= 24)) {
  var msg = [
    '',
    '  binary-structure-inspector needs Node.js ' + MIN + ' (you have ' + process.version + ').',
    '',
    '  Fix (recommended: nvm):',
    '    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash',
    '    exec $SHELL',
    '    nvm install 20 && nvm use 20',
    '',
    '  On WSL / Ubuntu you can also:  sudo apt remove nodejs && \\',
    '    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs',
    '',
    '  See CONTRIBUTING.md. The built extension itself has no such requirement —',
    '  this only affects building from source.',
    '',
  ].join('\n');
  console.error(msg);
  process.exit(1);
}
