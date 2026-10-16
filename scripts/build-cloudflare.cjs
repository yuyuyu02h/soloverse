const { spawnSync } = require('node:child_process');
const path = require('node:path');
const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run','build'], {
  cwd:path.resolve(__dirname,'../frontend'),stdio:'inherit',
  env:{...process.env,CLOUDFLARE_BUILD:'true',NEXT_PUBLIC_API_URL:'',NEXT_PUBLIC_SCREEN_PREVIEW:'true'},
});
if (result.status !== 0) process.exit(result.status ?? 1);
require('node:fs').writeFileSync(path.resolve(__dirname,'../frontend/out/_headers'), `/*\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n  X-Robots-Tag: noindex, nofollow\n`);
console.log('Cloudflare screen preview export ready. Only frontend/out will be uploaded.');
