const path = require('node:path');
require('esbuild').buildSync({
  entryPoints: [path.join(__dirname, 'worker.mjs')],
  outfile: path.join(__dirname, 'dist/worker.mjs'),
  bundle: true, format: 'esm', platform: 'node', target: 'es2022',
  mainFields: ['module', 'main'], conditions: ['workerd', 'node'],
  external: ['cloudflare:*'],
  alias: { '@libsql/client': path.join(__dirname, 'no-local-db.cjs') },
  define: { 'process.env.SOLOVERSE_RUNTIME': '"cloudflare"' },
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire("/worker.mjs");' },
});
