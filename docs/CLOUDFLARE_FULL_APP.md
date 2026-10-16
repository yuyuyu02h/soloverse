# Cloudflare完全版（個人利用・無料枠前提）

- 画面: https://soloverse-preview.pages.dev
- API: https://soloverse-api.my-ec-site.workers.dev
- DB: D1 `soloverse-private`（バインド名 `DB`）
- 今回は管理者アカウント1件のみを登録。ローカルの世界設定・投稿・住人は移行しません。
- 管理者のメール・パスワード: Git対象外 `.private/ADMIN_CREDENTIALS.md`。ローカルと同じものです。

## 構成

Pagesは静的な画面、Workersは既存ExpressのAPI、D1は永続データを担当します。DB接続はリクエストごとに分離し、ローカル実行では従来のSQLiteを使います。D1のスキーマは `cloudflare/migrations` にあります。新規登録はサーバー側で停止し、認証済みの管理者ID以外も拒否します。

Cloudflare版のパスワードは、ブラウザー側PBKDF2-SHA256（60万回、アプリ識別子と正規化メールをsaltに使用）とサーバー側PBKDF2-SHA256（10万回、アカウントごとの暗号乱数salt）を組み合わせます。最初の前処理結果はパスワードと同様に重要なので、HTTPSだけで送信し、ブラウザーへ保存・ログ出力しません。DBには最後の照合値だけを保存します。APIは方式の識別子を必須とし、回数の引き下げや旧bcryptへの切り替えをCloudflare側では認めません。通常のローカル版は既存のbcryptを継続します。

Workers本番はPBKDF2を一度に10万回までしか処理できず、60万回はローカルで通っても本番では失敗しました。この制約に合わせて前処理を分担しています。DB照合値を盗まれた場合のパスワード推測には、両方の処理が必要です。D1でログイン試行数を15分に10回まで管理します。

## APIキー（ユーザーが設定）

Cloudflareダッシュボード → Workers & Pages → `soloverse-api` → Settings → Variables and Secrets → Add。

- Type: **Secret**
- Name: **GROQ_API_KEY**
- Value: 自分のGroq APIキー
- 保存・Deployまで実行

キーをチャット・GitHub・Pagesの環境変数・NEXT_PUBLIC_変数に貼らないでください。今回はGroqだけを使用し、Gemini/OpenRouterへの自動切り替えは有効にしません。月額0円を保つにはGroq側もFreeプランであることを確認します。アプリの回数制限は、有料プランの契約そのものを無料に変更する機能ではありません。

JWT_SECRETとADMIN_USER_IDSはサーバー用Secretsです。初期値は `.private/cloudflare-server-secrets.json` へローカル保存し、Cloudflareへ登録します。AIキーはこのファイルに含めません。秘密値の登録後も `wrangler deploy` は既存Secretsを保持します。

## 無料枠を使う動作

- AI依頼はUTC日付ごとに全体で100回・10万トークンを上限として予約します。バックグラウンド分は返信用40%を残します。
- これはアプリ側の上限です。提供元の分単位の制限・利用枠も優先します。上限時は生成を待たせ、日本時間9時のアプリ枠更新後に再開できます。
- 画面からの利用確認が約5分途絶えると、自動生成を停止します。閲覧中もまとめて作った候補を時間差で公開します。
- Cronは1分単位。返信を優先し、その他の作業を別々の回へ分散します。D1上の期限付きロックで二重実行を防ぎます。
- 投稿候補・住人・観客コメントは、JSONを使ってまとめて保存し、D1の1クエリ100パラメーター制限を回避します。1回の公開は最大4候補です。
- 無料枠を超えたとき自動アップグレードする処理はありません。Cloudflare・AIの契約を有料へ変更する操作も行いません。

## 開発・更新

```sh
npm ci
npm ci --prefix backend
npm ci --prefix frontend
npm test --prefix backend
npm run build:cloudflare
npm run deploy:worker
```

PagesのGitHubビルドコマンドは `npm ci --prefix frontend && npm run build:cloudflare`、出力は `frontend/out`、本番ブランチは `codex/celebrity-experience` です。Workersは `npm run deploy:worker` で更新します（現段階ではPagesのPushだけではAPIコードは更新されません）。Workerのビルドにはbackendの依存関係も必要です。

画面だけへ戻す場合は `npm run build:cloudflare:preview`。APIの公開URLを変える場合は、ビルド時の `CLOUDFLARE_API_URL` とWorkerのCORS_ORIGIN/APP_URLを併せて設定します。

DBの構造変更は新しいマイグレーションを追加して `npm run migrate:cloudflare` で適用します。`scripts/generate-d1-schema.cjs` は初期スキーマの生成用で、空の一時DBだけを読みます。既存DBへ初期マイグレーションを再適用しません。

Cloudflareローカル検証には `cloudflare/.dev.vars.example` を `.dev.vars` にコピーして架空アカウントを使用します。`.dev.vars` はGit対象外です。本番のAPIキーを入れる必要はありません。ローカル検証では `--local` を必ず使用します。

## 検証の範囲

既存テストに加え、D1接続の並列分離・一括保存・認証方式の検証を行います。実際のWorkers上でのログイン、D1永続化、APIキー設定後の実AI生成を別々に確認します。ローカルでのCPU時間測定だけでは本番の無料枠内での稼働保証にはなりません。長時間稼働時の無料枠・D1行読み取り量は運用後も確認が必要です。
