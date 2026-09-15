# SoloVerse

SoloVerseは、自分専用の小さなSNS世界を作るWebアプリです。オンボーディングで好みや空気感を設定すると、クラウドLLMが個性の異なる住人を生成し、投稿・返信・いいね・トレンド・通知が時間とともに動きます。

ローカルLLMは使いません。LLM処理はGroq、Gemini、OpenRouterのクラウドAPIを順番に利用し、無料枠の上限や一時障害時には自動で次へ切り替わります。

## 主な機能

- メールアドレスとパスワードによる登録・ログイン
- 4ステップの世界設定とAI住人の生成
- 投稿、スレッド返信、いいね
- AI住人による遅延リアクション
- 15分ごとの自律タイムライン、約5分ごとの実投稿トレンド集計（LLM不要）
- 6時間ごとの住人増加（最大20人）
- 長期不在時の呼びかけと通知
- 差分ポーリング、既存投稿の返信・いいね更新、カーソルによる過去投稿取得、未読通知
- スレッド内の個別返信、AI住人の性格・興味・話し方の確認

## 構成

```text
frontend/  Next.js 16 / React 19 / TypeScript
backend/   Express / SQLite(libSQL) / Groq・Gemini・OpenRouter API
```

データは既定で `backend/soloverse.db` に保存されます。このファイルと `.env` はGit管理対象外です。

## 必要環境

- Node.js 20.9以上
- npm
- 次のうち1つ以上のAPIキー
  - [Groq APIキー](https://console.groq.com/keys)（推奨・第1候補）
  - [Gemini APIキー](https://aistudio.google.com/app/apikey)（第2候補）
  - [OpenRouter APIキー](https://openrouter.ai/keys)（最終候補）

## ローカル起動

1. 環境変数を準備します。

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

生成した文字列を `backend/.env` の `JWT_SECRET` に設定し、`GROQ_API_KEY`、`GEMINI_API_KEY`、`OPENROUTER_API_KEY` のうち、取得したキーを1つ以上設定してください。3つすべて設定すると既定のフォールバック構成になります。

2. 依存関係をインストールします。

```bash
npm --prefix backend ci
npm --prefix frontend ci
```

3. 2つのターミナルで起動します。

```bash
npm --prefix backend run dev
```

```bash
npm --prefix frontend run dev
```

ブラウザで `http://localhost:3000` を開きます。APIの状態は `http://localhost:3001/api/health` で確認できます。`llm.configured` が `true` ならAPIキーを認識しています。

## LLM設定

既定では次の順に試行します。APIキーが未設定のプロバイダーは自動でスキップします。

```dotenv
LLM_PROVIDER_ORDER=groq,gemini,openrouter
GROQ_MODELS=openai/gpt-oss-120b,qwen/qwen3.8-27b,openai/gpt-oss-20b
GEMINI_MODELS=gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-2.5-flash-lite
OPENROUTER_MODELS=openrouter/free
```

プロバイダー内でもモデルを左から順に試します。429、認証エラー、5xx、タイムアウト、不正な出力を検出すると次のモデルまたはプロバイダーへ移ります。429になったモデルは `Retry-After` に従って一時休止し、バックグラウンド処理が上限を連打するのを防ぎます。

各リクエストは既定で45秒、フォールバック全体は120秒で打ち切ります。無料枠のRPM制限に合わせ、Groqは2.5秒、Geminiは6.5秒、OpenRouterは3.5秒の最小送信間隔をプロバイダーごとに共有します。

GroqのGPT-OSSには低い推論強度と本文に加えた推論用のトークン枠を設定します。空応答・途中切れ・壊れたJSONは理由と終了状態をログに出し、既定で5分休止します。正常なモデルへ切り替わった後は、同じ失敗モデルを毎回呼び直しません。ネットワーク障害では残りの同社モデルを飛ばして次のプロバイダーを試します。

節約する場合は `AUTONOMOUS_INTERVAL_MINUTES=60` に設定できます。トレンドは直近7日間の最大500投稿からハッシュタグを集計し、トレンドを埋めるための投稿生成は行いません。タグがない世界では空になります。無料運用には各サービスのFreeプラン／Free Tierを利用してください。コードだけではアカウントの課金設定を判別できません。

無料枠やモデル提供状況は変更されるため、現在の制限は[Groq](https://console.groq.com/docs/rate-limits)、[Gemini](https://ai.google.dev/gemini-api/docs/rate-limits)、[OpenRouter](https://openrouter.ai/docs/faq)のダッシュボードと公式資料で確認してください。GeminiのFree Tierへ送った内容はGoogleの製品改善に使用される場合があります。機密情報や第三者の個人情報をプロンプトへ含めないでください。

## 環境変数

| 変数 | 必須 | 既定値 | 用途 |
| --- | --- | --- | --- |
| `JWT_SECRET` | はい | なし | JWT署名鍵 |
| `LLM_PROVIDER_ORDER` | いいえ | `groq,gemini,openrouter` | プロバイダーの優先順 |
| `GROQ_API_KEY` | 条件付き | なし | Groq APIキー |
| `GROQ_MODELS` | いいえ | `gpt-oss-120b`等 | Groqモデルの優先順 |
| `GEMINI_API_KEY` | 条件付き | なし | Gemini APIキー |
| `GEMINI_MODELS` | いいえ | `gemini-3.5-flash-lite`等 | Geminiモデルの優先順 |
| `OPENROUTER_API_KEY` | 条件付き | なし | OpenRouter APIキー |
| `OPENROUTER_MODELS` | いいえ | `openrouter/free` | OpenRouterモデルの優先順 |
| `LLM_REQUEST_TIMEOUT_MS` | いいえ | `45000` | 1回のAPI呼び出しタイムアウト |
| `LLM_TOTAL_TIMEOUT_MS` | いいえ | `120000` | 全フォールバックのタイムアウト |
| `LLM_RATE_LIMIT_COOLDOWN_MS` | いいえ | `60000` | Retry-Afterがない429の休止時間 |
| `LLM_INVALID_OUTPUT_COOLDOWN_MS` | いいえ | `300000` | 空応答・JSON不正・途中切れの休止時間 |
| `AUTONOMOUS_INTERVAL_MINUTES` | いいえ | `15` | 自律生成の最小間隔（5以上、実行は約5分刻み） |
| `WORLD_TIME_ZONE` | いいえ | `Asia/Tokyo` | 生成時の時間帯（IANAタイムゾーン） |
| `AI_DIRECT_REPLY_MAX_DELAY_MINUTES` | いいえ | `3` | 質問・呼びかけへの最初の返信を予約する最大分数（1〜10） |
| `LLM_REQUEST_INTERVAL_MS` | いいえ | プロバイダー別 | 全社共通の最小送信間隔（上書き用） |
| `PORT` | いいえ | `3001` | APIポート |
| `CORS_ORIGIN` | いいえ | `http://localhost:3000` | 許可するOrigin（カンマ区切り） |
| `APP_URL` | いいえ | `http://localhost:3000` | OpenRouterへ通知するアプリURL |
| `DB_PATH` | いいえ | `backend/soloverse.db` | SQLiteファイルの保存先 |
| `BACKGROUND_JOBS` | いいえ | `true` | 定期ジョブを動かすか |
| `TRUST_PROXY` | いいえ | `false` | リバースプロキシ配下のIP解決 |
| `NEXT_PUBLIC_API_URL` | いいえ | `http://localhost:3001` | ブラウザから接続するAPI URL |

## 検証コマンド

```bash
npm --prefix backend test
npm --prefix frontend run build
npm --prefix frontend run typecheck
```

バックエンドのテストは一時DBと模擬LLM APIを使い、Groq → Gemini → OpenRouterのフォールバック、登録、オンボーディング、初期投稿、投稿、返信ツリー、いいね、リアクションキュー、ユーザー間のアクセス分離を実API経由で確認します。実際のAPIキーや課金枠は消費しません。

`world-regressions.test.js` は初期生成の同時リクエスト、返信の時系列、実投稿だけのトレンド集計、質問への返信予約、初回成長待ちを検証します。今回の4段階の改善記録は [docs/improvement-2026-09-15.md](docs/improvement-2026-09-15.md) にあります。

## API概要

| Method | Path | 内容 |
| --- | --- | --- |
| `GET` | `/api/health` | 稼働・LLM設定確認 |
| `POST` | `/api/auth/register` | 新規登録 |
| `POST` | `/api/auth/login` | ログイン |
| `GET` | `/api/auth/me` | 現在のセッション確認 |
| `POST` | `/api/onboarding/submit` | 世界と初期住人を生成 |
| `GET` | `/api/onboarding/world` | 世界設定と住人一覧 |
| `POST` | `/api/onboarding/regenerate` | アカウントとユーザー投稿を残してAI住人・AI投稿を再生成 |
| `GET` | `/api/timeline` | タイムライン取得 |
| `POST` | `/api/timeline/post` | 投稿・返信 |
| `POST` | `/api/timeline/like/:postId` | いいね切り替え |
| `GET` | `/api/timeline/replies/:postId` | 入れ子を含む返信一覧 |
| `GET` | `/api/timeline/notifications` | 通知取得・既読化 |
| `GET` | `/api/timeline/trends` | トレンド取得 |
| `GET` | `/api/timeline/characters` | 住人一覧 |

認証が必要なAPIには `Authorization: Bearer <token>` を付けます。

## 運用・引き継ぎメモ

- 本番では必ず十分に長いランダムな `JWT_SECRET` を使い、HTTPSを有効にしてください。
- SQLiteを使うため、デプロイ先には永続ディスクが必要です。バックアップ対象は `DB_PATH` のDBファイルです。
- 定期ジョブを有効にしたバックエンドは原則1プロセスにしてください。複数レプリカ構成では1台だけ `BACKGROUND_JOBS=true` にし、他は `false` にします。
- 初期生成と自律生成の直列化はプロセス内の制御です。生成APIも含め1プロセス運用が前提です。複数レプリカで初期生成を受け付ける構成ではDBによるジョブロックが必要です。
- 更新時にDBを削除する必要はありません。過去に生成済みの投稿・名前・時刻はそのまま残し、新しく生成する内容から改善を適用します。AI住人タブの「AI住人とAI投稿を作り直す」を使うと、アカウントと自分の投稿を残したまま新しい生成ルールで再生成できます。初期タイムラインだけは、既に会話がある世界を演出するため過去72時間に配置します。通常の投稿・返信は生成時刻で保存します。
- 起動時にテーブル作成、既存DB向けマイグレーション、検索用インデックス作成を自動実行します。更新前にはDBをバックアップしてください。
- LLM失敗時はキューを最大3回、5分間隔で再試行します。上限到達後は処理済みにして無限消費を防ぎます。
- 投稿本文は140字、興味・関心は300字に制限しています。ユーザーごとの投稿・返信・いいね境界はAPI側でも検証します。
- 現状は個人利用・プロトタイプ向けです。一般公開する場合は、メール認証、パスワード再設定、利用規約・プライバシーポリシー、通報／モデレーション、監視・バックアップ復旧訓練を追加してください。

## よくある問題

### `LLM APIキーが設定されていません`

`backend/.env` のファイル名を確認し、`GROQ_API_KEY`、`GEMINI_API_KEY`、`OPENROUTER_API_KEY` のいずれかを設定してバックエンドを再起動してください。

### オンボーディングに時間がかかる／429になる

無料枠の混雑またはレート上限が考えられます。ログの `[LLM] provider/model` を確認してください。3つのAPIキーを設定しておけば自動で次へ切り替わります。失敗時はオンボーディング途中のデータを保存しないため、安全に再試行できます。

### フロントエンドから接続できない

バックエンドの `/api/health`、フロントエンドの `NEXT_PUBLIC_API_URL`、バックエンドの `CORS_ORIGIN` を順に確認してください。本番ではブラウザから到達できる公開URLを設定します。

### 投稿へのAI反応がすぐ表示されない

仕様です。住人ごとの速度設定に応じて数分から数時間遅延し、キューは30秒ごとに処理されます。画面側は30秒ごとに差分を取得します。
