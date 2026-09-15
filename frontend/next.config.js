/** @type {import('next').NextConfig} */
const nextConfig = {
  // StrictModeを有効化: seed/onboarding APIの冪等性はサーバー側で担保済み
  // (seedはAI投稿が0件のときのみ実行、onboardingは既存チェックあり)
  reactStrictMode: true,
  poweredByHeader: false,
  // 親ディレクトリのlockfileを誤検出しないよう、このアプリをTurbopackのルートに固定。
  turbopack: { root: __dirname },
  async headers() {
    return [{
      source: '/(.*)',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      ],
    }];
  },
};

module.exports = nextConfig;
