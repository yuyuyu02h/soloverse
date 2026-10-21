# 本番サイトの一時的な非公開・再開

## 現在の状態（2026-10-18）

- **本人の指示により、今回の非公開化は取りやめ。再度依頼されるまで初回有効化・契約・アクセス制限を進めない。** 以下の手順は将来の参照用。
- アニメーション修正はPagesへ公開済み。コミット `f6d3ace279d1479e3b5f621160d794a7e9da9b63`、デプロイ `01541f75-b7a0-4030-bc19-771bc7570e65`。
- **非公開化は未完了。本番サイトは現在も一般から閲覧可能。**
- Cloudflare Access APIは「Accessが未有効化」と応答した。管理画面のZero Trust初回設定では無料プランにも規約同意と無料枠超過時のカード請求許可が表示されるため、確定していない。プラン選択の先の確定前画面まで進めたが、同意チェックとActivateは実行していない。
- 私（Codex）に専用のメール・Cloudflareアカウントはない。「あなたと私だけ」は、あなたの本人確認済みメールだけを許可し、私が必要なときにあなたの許可のもとでそのブラウザーを操作する形になる。私用の共有パスワードや恒久的な例外は作らない。
- アカウント・世界・投稿・DB、Workerのコード・Cronは変更していない。

## 1. 本人による初回有効化

1. Cloudflareダッシュボードで対象アカウント → **Zero Trust → Overview → Get started** を開く。
2. **Zero Trust Free（$0）** を選択する。有料のStandardは選択しない。
3. 確定前画面の規約と請求許可の内容を本人が確認する。同意できる場合だけ、本人がチェックして **Activate** を押す。無料枠超過時の請求許可を受け入れたくなければ進めない。
4. 案内された場合はチーム名を設定する。必要な本人確認も本人が行う。

調査時にはこの確定前画面まで進めた。本人は今回は取りやめる方針のため、Activateを押していなければブラウザーで戻るかタブを閉じてよい。将来有効化する場合も、確定だけではSoloverseの閲覧制限はまだ設定されない。

## 2. Pagesを自分だけに限定

1. **Workers & Pages → soloverse → Settings → General → Enable access policy** を有効にする。
2. 作成されたAccessアプリを **Manage** で開く。初期状態は `*.soloverse.pages.dev` のプレビュー保護なので、本番 `soloverse.pages.dev` 用の保護も追加する。
3. 公式手順では、作成したアプリの **Public hostname → Subdomain** の `*` を外して保存し、その後Pages側で **Enable access policy** を再度有効にする。本番とプレビューの2つの保護が存在することを確認する。
4. 各アプリのポリシーを **Allow → Include → Emails → 自分のメール1件** に限定する。初期設定で既にある広いAllow条件が残っていないか確認する。**Everyone**、メールドメイン全体の許可、認証を省略するBypassは追加しない。
5. ログイン方法はメールのワンタイムコード等を利用する。自分のメールで認証後に閲覧できることを確認する。
6. 旧 `soloverse-preview` にも同様に設定する。現在の旧URLは転送専用だが、過去のデプロイURLには以前の画面が残っている可能性がある。

確認対象:

- `soloverse.pages.dev`
- `*.soloverse.pages.dev`（過去のデプロイ・別ブランチを含む）
- `soloverse-preview.pages.dev`
- `*.soloverse-preview.pages.dev`

手順の根拠: [Cloudflare公式: 本番pages.devのAccess保護](https://developers.cloudflare.com/pages/platform/known-issues/#enable-access-on-your-pagesdev-domain)。

## 3. APIの制限は接続方式も含めて設定する

画面だけの保護ではAPIは非公開にならない。対象APIは `soloverse-api.my-ec-site.workers.dev`。

管理画面では **Workers & Pages → soloverse-api → Access → Protect this Worker behind Access → All traffic** から本人限定のポリシーを設定できる。ただし、現在の画面はPagesから別ドメインのAPIへ直接fetchし、AccessのCookieを送る設定になっていない。そのままAPIへAccessを適用すると、本人が画面を開けてもログインや投稿が通信エラーになる可能性がある。

そのため、**APIのAccess制限を適用する前に、通信方式を調整して検証する必要がある**。同じサイト経由のAPI中継を設けるか、Access Cookie・CORS・事前確認リクエスト（OPTIONS）を対応させる。サービス用の認証トークンを使う場合はサーバーのSecretに置き、画面のコードやNEXT_PUBLIC変数には入れない。現在この対応は未実施。

初回有効化を終えたら、このAPI対応とPages・APIの最終設定を引き続き依頼できる。本人がアプリを使えることと、本人以外を拒否することの両方を確認してから非公開化完了とする。

根拠: [WorkersのAccess設定](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)、[Access配下のCORS](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/cors/)。

## 4. 非公開化の完了確認と再開

- 未認証の別ブラウザーで、本番・プレビュー・旧URL・APIへ直接アクセスして拒否されることを確認する。本人のメールによる認証後はログイン・表示・投稿が動くことを確認する。
- AI生成も停止したい場合は別途Cron・生成待ちを止める。画面のAccess設定だけでは定期処理は停止しない。
- 再開時は対象アプリのAccess保護を解除し、必要なら停止した定期処理を戻す。メールのAllow条件だけを削除すると全員拒否になるため、公開再開の操作とは区別する。
- DBを削除したり世界を作り直したりする必要はない。すでに第三者が表示・保存した内容まで回収できるわけではない。
