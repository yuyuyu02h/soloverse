const fs = require('node:fs');
const path = require('node:path');
const output = path.join(__dirname, 'out');
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, '_redirects'), '/* https://soloverse.pages.dev/:splat 301\n');
fs.writeFileSync(path.join(output, 'index.html'), '<!doctype html><html lang="ja"><meta charset="utf-8"><title>SoloVerse</title><p>SoloVerseは移転しました。<a href="https://soloverse.pages.dev/">新しいサイトを開く</a></p></html>\n');
fs.writeFileSync(path.join(output, '_headers'), '/*\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Robots-Tag: noindex, nofollow\n');
console.log('Legacy Pages redirect ready: https://soloverse.pages.dev/');
