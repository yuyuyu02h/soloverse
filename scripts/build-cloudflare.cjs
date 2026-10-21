const { spawnSync } = require('node:child_process');
const path = require('node:path');
const full = process.env.CLOUDFLARE_APP_MODE === 'full' || process.argv.includes('--full');
const apiUrl = full ? (process.env.CLOUDFLARE_API_URL || 'https://soloverse-api.my-ec-site.workers.dev') : '';
if (full && !/^https:\/\/[a-zA-Z0-9.-]+$/.test(apiUrl || '')) throw new Error('完全版にはHTTPSのCLOUDFLARE_API_URLが必要です（末尾スラッシュなし）');
const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run','build'], {
  cwd:path.resolve(__dirname,'../frontend'),stdio:'inherit',
  env:{...process.env,CLOUDFLARE_BUILD:'true',NEXT_PUBLIC_API_URL:apiUrl,NEXT_PUBLIC_SCREEN_PREVIEW:String(!full),NEXT_PUBLIC_PRIVATE_APP:String(full)},
});
if (result.status !== 0) process.exit(result.status ?? 1);
require('node:fs').writeFileSync(path.resolve(__dirname,'../frontend/out/_headers'), `/*\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n  X-Robots-Tag: noindex, nofollow\n`);
console.log(`Cloudflare ${full ? 'private full app' : 'screen preview'} export ready. Only frontend/out will be uploaded.`);
