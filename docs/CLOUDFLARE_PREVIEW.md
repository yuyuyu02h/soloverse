# Cloudflareの画面プレビュー公開

今回は画面だけをCloudflare Pagesで公開します。トップ、3モードのオンボーディング、管理者ログインの見た目を確認できます。ログイン・新規登録・AI生成・DB・定期処理は公開範囲に含めません。公開版にプレビュー表示を付け、APIへの送信を停止しています。

## GitHub連携の設定

- リポジトリ: `yuyuyu02h/soloverse`
- プロジェクト名: `soloverse-preview`
- 本番ブランチ: `codex/celebrity-experience`
- ルート: リポジトリのルート（空欄）
- ビルドコマンド: `npm ci --prefix frontend && npm run build:cloudflare`
- フレームワーク: `None`（専用ビルドコマンドを使う）
- ビルド出力ディレクトリ: `frontend/out`
- APIキー・管理者パスワード・JWT_SECRETなどの登録: 不要

最初の接続後は、このブランチへのPushで画面を更新できます。他のブランチには現行のアプリがあるため、プレビューブランチの自動ビルドは必要に応じて別途有効にします。

## 手元での確認

```sh
npm ci
npm ci --prefix frontend
npm run build:cloudflare
npm run preview:cloudflare
```

`http://localhost:8787`を開きます。CLIで手動公開する場合は、Cloudflareの認証後に`npm run deploy:cloudflare`を使います。

専用ビルドは`CLOUDFLARE_BUILD=true`、`NEXT_PUBLIC_SCREEN_PREVIEW=true`、`NEXT_PUBLIC_API_URL`空文字を設定して静的出力を作ります。通常のローカル開発ではこれらを有効にしないため、既存のAPI付きアプリとして動きます。静的公開のヘッダーは`frontend/out/_headers`に生成します。

## 管理者の情報

仮の管理者はローカルDBに作成します。認証情報の保存先は`.private/ADMIN_CREDENTIALS.md`です。このディレクトリと`.env`、DBはGit対象外で、`frontend/out`にも入りません。作成・確認用コマンドは`node backend/scripts/create-admin.cjs`です。既存の保存内容がある場合は同じアカウントを使い、パスワードを勝手に変更しません。

現在の公開版では管理者ログインも未接続です。API・DBを公開する段階で、このアカウントだけを安全に登録します。既存のローカル利用者のデータは今回送信しません。

## 公式資料

- [Cloudflare PagesのGitHub連携](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/)
- [静的Next.jsの出力](https://developers.cloudflare.com/pages/framework-guides/nextjs/deploy-a-static-nextjs-site/)
