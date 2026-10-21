# PROJECT.md

## Project Name

SoloVerse

## Purpose

SoloVerseは、利用者ごとに隔離された「自分専用の小さなSNS世界」を作るWebアプリです。利用者が好み、コミュニティの雰囲気、自分の立ち位置、避けたい話題を設定すると、クラウドLLMがAI住人を生成します。AI住人は投稿、返信、いいね、通知、自律的な会話を行います。

実装とREADMEは、ローカルLLMを使用せず、Groq、Gemini、OpenRouterのクラウドAPIを順番に利用する方針を示しています。

## Product Direction

SoloVerseは、現時点では一般公開や商用の「完全ローンチ」を目標にしません。プロジェクトオーナーが個人制作として楽しめ、作品として見せられる品質を目指します。

現在の優先順位:

1. AI住人の投稿・返信が自然で、人物像と話題に一貫性があること
2. 起動して使ったときに十分な投稿密度と反応があること
3. 見た目と操作感が個人作品として完成されていること
4. 無料クラウドLLM枠の範囲で長く試せること
5. 既存データを壊さず、開発を続けやすいこと

メール認証、大規模運用、一般公開向けの規約・通報・分散構成などは、公開方針が変わった場合の条件付き将来項目です。ただし、秘密情報の保護、利用者ごとのデータ分離、DBバックアップなど、個人利用でも必要な安全性は維持します。

## Scope

### In Scope（現在実装済み）

- メールアドレスとパスワードによる登録・ログイン
- 4ステップのオンボーディングと、利用者ごとの世界設定
- LLMによる初期AI住人の生成
- 利用者およびAI住人の投稿、入れ子の返信、いいね
- 質問・呼びかけへの返信予約と、住人ごとの遅延リアクション
- AI住人同士の自律投稿・会話
- 実投稿のハッシュタグから算出するトレンド
- AI住人の増加、長期不在時の呼びかけ、未読通知
- 差分ポーリングとカーソル式の過去投稿取得
- アカウントと利用者投稿を残したAI世界の再生成
- Groq → Gemini → OpenRouterのモデル／プロバイダーフォールバック
- `admired`選択時に通常リアクションと分離される有名人モード。大規模反応は集計値、コメントはAI司令塔による少数の代表サンプルとして扱う

- 返信優先の内部予算、候補のまとめ生成・品質評価・時間差公開・上限付き補充
- モデル別成功率による自動降格、構造化プロフィールと実投稿ベースの短期記憶
- 生成状況の表示、非LLM背景文補完、従来方式への切替と非公開の復元スナップショット

詳細・限界は [FREE_CONTENT_PIPELINE.md](../docs/FREE_CONTENT_PIPELINE.md)。

### Out of Scope / Not Present

- ローカルLLMの実行
- 利用者同士を接続する公開SNS機能
- 画像・動画の投稿、ファイルアップロード
- メール認証、パスワード再設定、アカウント削除
- 管理画面、通報、ブロック、監査画面
- 課金、広告、サブスクリプション
- WebSocketやServer-Sent Eventsによるリアルタイム配信
- [TODO: 上記を意図的な対象外とするか、将来対象にするかをプロジェクトオーナーが確認する。]

## Users

第一の利用者はプロジェクトオーナー本人です。現在のUIとREADMEは、自分の好みに合わせたAI住人だけのSNS体験を個人で利用する人を想定しています。

[TODO: 将来、他のテスト利用者へ配布するかを決める。]

## Technology Stack

### Frontend

- Next.js 16.3.5（App Router）
- React / React DOM 19.3.0
- TypeScript 5.9.3
- Reactのローカルstateとrefによる状態管理
- CSS変数、インラインスタイル、`frontend/app/globals.css`

### Backend

- Node.js 20.9以上
- Express 4（CommonJS）
- `@libsql/client` 0.14系
- `bcryptjs` によるパスワードハッシュ
- `jsonwebtoken` によるBearer JWT
- Node組み込み`fetch`による外部LLM API呼び出し

### Database

- ローカルSQLiteファイルを`@libsql/client`経由で使用
- 既定パス: `backend/soloverse.db`
- `DB_PATH`で保存先を変更可能

### Infrastructure / Hosting

- Source repository: `https://github.com/yuyuyu02h/soloverse.git`, default branch `main`
- 開発時はフロントエンド`http://localhost:3000`、バックエンド`http://localhost:3001`
- DBを永続化できる単一バックエンドプロセスを前提とする実装
- CI、コンテナ、クラウドデプロイ設定はリポジトリ内に存在しない
- [TODO: 本番ホスティング先、ドメイン、HTTPS終端、永続ディスク、バックアップ先を決定する。]

### External Services

- Groq Chat Completions互換API
- Gemini OpenAI互換API
- OpenRouter Chat Completions API

## Important Constraints

- ローカルLLMは使用しない。
- APIキーが設定されたクラウドLLMを1社以上必要とする。
- 無料枠を優先し、既定はGroq → Gemini → OpenRouterの順でフォールバックする。
- 投稿本文は140文字、興味・関心は300文字まで。
- 自律生成は既定15分間隔、実行判定は約5分ごと。5分未満には設定できない。
- リアクションキューは30秒ごとに処理する。
- AI住人は初期最大10人、成長後最大20人。
- 同一利用者の世界生成はプロセス内で直列化される。複数バックエンドプロセス間の排他制御はない。
- SQLiteのため、水平スケールと複数ライターには現在のままでは不向き。
- [TODO: 想定同時利用者数、可用性、性能目標、予算上限を決定する。]

## Current Status

### Working

- 登録、ログイン、JWT認証
- オンボーディング、AI住人生成、初期タイムライン生成
- 投稿、返信ツリー、いいね、通知、トレンド、住人一覧
- 遅延リアクション、自律タイムライン、住人増加、不在反応
- AI世界の明示的な再生成
- LLMのレート調整、タイムアウト、クールダウン、モデル／プロバイダーフォールバック
- 一時DBと模擬LLMを使うバックエンドテスト
- フロントエンドのTypeScript検査と本番ビルド

### In Progress

- `ROADMAP.md`で、品質基盤、信頼性、セキュリティ、UX、AI品質、機能拡張、運用、ベータ検証の実装順を整理済み。
- 個人制作向けの「投稿密度・会話品質・見た目」の改善を次のマイルストーンとする。

### Not Implemented

- メール認証、パスワード再設定、JWT失効／セッション一覧
- 利用規約、プライバシーポリシー、データ削除導線
- 通報、モデレーション管理、運用監視
- 自動バックアップと復旧手順の実装
- CI/CD、デプロイ定義
- lint／formatスクリプト
- E2Eブラウザテスト

### Known Problems

- LLMの生成品質は外部モデルと無料枠の混雑状況に依存し、プロンプトだけでは不適切・不自然な出力を完全には防げない。
- TypeScriptの`strict`は無効。
- タイムライン取得では最大30投稿に対して返信プレビューを1投稿ずつ問い合わせるN+1クエリがある。
- `posts.reply_to`、`reaction_queue.character_id/post_id`、`notifications.character_id/post_id`に外部キーがない。
- 認証トークンをブラウザの`localStorage`に保存している。
- ログイン試行制限はプロセス内メモリのみで、再起動・複数プロセスをまたがない。
- `frontend/package.json`のライセンスは`UNLICENSED`だが、`frontend/package-lock.json`のルート情報は`ISC`で一致していない。
- Git履歴は現時点で初回コミット1件のみで、それ以前の設計変更理由は履歴から確認できない。
- `frontend/tsconfig.tsbuildinfo`がGit追跡されており、ローカルビルドキャッシュが差分へ混入する可能性がある。
- CI、ブランチ保護、PR運用、リリース手順は未整備。

## Important Commands

Install:

```bash
npm --prefix backend ci
npm --prefix frontend ci
```

Development:

```bash
npm --prefix backend run dev
npm --prefix frontend run dev
```

Production-style start:

```bash
npm --prefix backend start
npm --prefix frontend run build
npm --prefix frontend start
```

Test:

```bash
npm --prefix backend test
```

Build and typecheck:

```bash
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

Lint:

```text
[TODO: lintスクリプトは未定義。採用するツールとルールを決定する。]
```

## Environment

Development environment:

- `.nvmrc`: `20.9.0`
- Backend env template: `backend/.env.example`
- Frontend env template: `frontend/.env.example`
- 実際の`backend/.env`とSQLite DBは存在するが、秘密情報・利用者データを含み得るため内容をドキュメントへ記録しない。

Production environment:

- [TODO: 本番環境はリポジトリから特定できない。]

## Important Notes

- `.env`、`.env.local`、DB、`node_modules`、Next.jsビルド成果物はignore対象。
- APIキー、JWT秘密鍵、DB内容をログ、Issue、ドキュメント、コミットへ記録しない。
- `JWT_SECRET`が未設定または既知の弱い値ならバックエンドは起動時に終了する。本番では32文字以上が必要。
- テストは一時DBと模擬LLMサーバーを使い、実際のAPI利用枠を消費しない。
- Gitの正本は`origin`（`https://github.com/yuyuyu02h/soloverse.git`）の`main`。現時点の初回コミットは`3127e0d`。
- 実装の推奨順と完了条件は`ROADMAP.md`を参照する。
