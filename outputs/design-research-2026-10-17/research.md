# SoloVerse タイムラインB案・再検討

調査日：2026年10月17日。

GitHubの個人制作、学習用SNS、小規模OSSのSNSクライアント32件を検索・確認した。32件の公開READMEを読み取り、そのうち20件はREADMEからリンクされたスクリーンショットをブラウザで表示して比較した。個人アカウント所有でも共同制作や教材が含まれるため、すべてを「個人が独自に設計したSNS」とは扱わない。星数・更新日・実稼働状況の評価は今回の対象外。

検索は日本語の個人開発SNS、React製のSNS、Twitterクローン、Mastodon/Blueskyクライアントから横断した。画像中心のSNSやクローンも比較対象とし、SoloVerseへそのまま移植する候補とはしなかった。リポジトリのコードを実行したり、第三者のコード・画像を提案画面へ流用したりはしていない。

## 前案が生成AIのデモ画面に見えた理由

以下は実例の比較を踏まえた、この画面に対するデザイン上の判断。

- 紫の背景光、グラデーション、影、角丸、紫の縁を同時に使い、装飾の主張が本文より強かった。
- 全投稿を同じ大きさに見える独立カードへ入れたため、短い投稿と長い投稿の違いや会話の流れが弱かった。
- 本文がすべて整った二文ほどの説明文で、アバターも同じ質感だった。日常的なSNSのばらつきが足りなかった。
- ログイン画面の視覚的な演出を、そのまま長時間読む画面へ持ち込んだ。導入画面と利用画面では必要な静けさが違う。

## 改訂Bへの反映

暗色の「インク」を主案、明色の「ペーパー」を比較案にした。

- インク：背景 `#101014`、脇のメニュー `#19161e`、投稿面 `#1d1c21`。3面の明るさと色味の差で奥行きをつける。
- 差し色 `#b9a1e5` はロゴの小さな点・投稿ボタンなどに絞る。紫の背景光と投稿カードの影は使わない。
- 投稿は区切り線で連続させ、アバターの列・本文の列・時刻を揃える。返信を線でつなぎ、関連する投稿が分かるようにする。
- 本文14px、名前13px、時刻・ハンドル11pxを初期値とする。本文の大きさと投稿の上下余白は見本内で調整可能。
- サンプル投稿に一行、改行、短い返信、少し長い文を混ぜ、実際の利用に近い密度で確認する。
- デスクトップは左メニュー、モバイルは上のブランドと下のメニュー。通知・トレンド・投稿など既存の主要操作を使って構成する。
- ペーパーは暖色寄りの紙色にし、上部ヘッダーと右メニューに配置を変えた。主案との読み心地の比較用。

主に参考にしたのは、[Phanpyの情報整理](https://github.com/cheeaun/phanpy#design-decisions)、[Ebouの投稿面と脇のメニューの配色](https://github.com/terhechte/Ebou#screenshots)、[Elkの本文中心の配置](https://github.com/elk-zone/elk)、[Pinaforeのシンプルさを重視する方針](https://github.com/nolanlawson/pinafore#goals-and-non-goals)。Phanpyの操作非表示をそのまま採用せず、SoloVerseではいいね・返信を常時見せている。

## 確認した32件

「画像あり」は、この調査で実際に画像を表示して目視したもの。「文書のみ」はREADME等の確認であり、画面を見たという意味ではない。各メモは今回見た資料の範囲。

| # | リポジトリ | 確認範囲 | 比較に使った点・扱い |
|---|---|---|---|
| 1 | [cheeaun/phanpy](https://github.com/cheeaun/phanpy) | 文書・画像あり | 個人の設計判断が明記される。短いハンドル、情報量を抑える方針、スレッドの扱いを重視。 |
| 2 | [nolanlawson/pinafore](https://github.com/nolanlawson/pinafore) | 文書のみ | 速度、単純さ、アクセシビリティを目標にする。保守終了と明記されるため現行実装の候補にはしない。 |
| 3 | [elk-zone/elk](https://github.com/elk-zone/elk) | 文書・画像あり | 共同OSS。中央の投稿と脇のメニューの階層、明暗の違いを比較。 |
| 4 | [terhechte/Ebou](https://github.com/terhechte/Ebou) | 文書・画像あり | 紫を脇へ置き、中央は中立色にする分離が今回の方向に合う。 |
| 5 | [Dimillian/IceCubesApp](https://github.com/Dimillian/IceCubesApp) | 文書・画像あり | 本文、投稿者、メニューの強弱と、モバイルでの情報の収まりを比較。 |
| 6 | [tunjid/heron](https://github.com/tunjid/heron) | 文書のみ | Material/Craneの参照が明記される。複数ペインや遷移は今回の範囲を超えるため採用しない。 |
| 7 | [LucasGGamerM/moshidon](https://github.com/LucasGGamerM/moshidon) | 文書のみ | タイムラインの選択・色設定を確認。READMEの画像プレースホルダーは実画面の証拠と数えない。 |
| 8 | [grycmat/neon](https://github.com/grycmat/neon) | 文書・画像あり | スレッドを比較。強い背景光とカードの組み合わせは今回の主案では採用しない。 |
| 9 | [Dimillian/IcySky](https://github.com/Dimillian/IcySky) | 文書・画像あり | フィードと投稿画面の明暗差、軽い操作欄を比較。 |
| 10 | [QuilaguyPrime/the-flock](https://github.com/QuilaguyPrime/the-flock) | 文書のみ | 技術課題としてのTwitterクローン。モバイルの下メニューと投稿導線を確認。 |
| 11 | [paulio11/P4-Squigl-Twitter-Clone](https://github.com/paulio11/P4-Squigl-Twitter-Clone) | 文書・画像あり | 学習制作。色を抑え、投稿由来の画像を主役にする方針。3列をそのまま持ち込まない。 |
| 12 | [fatiharapoglu/twitter](https://github.com/fatiharapoglu/twitter) | 文書・画像あり | クローン。本文の列と控えめな操作アイコンの配置を比較。 |
| 13 | [fidanazhan/django-social-media-clone](https://github.com/fidanazhan/django-social-media-clone) | 文書・画像あり | 手書きCSSのSNS。本文の列を守る配置を参考にし、濃い境界線は採用しない。 |
| 14 | [noobmaster432/buzznet](https://github.com/noobmaster432/buzznet) | 文書・画像あり | クローン。認証オーバーレイと背後の投稿画面の役割分担を比較。 |
| 15 | [yossefelnajjar/twitter-clone](https://github.com/yossefelnajjar/twitter-clone) | 文書・画像あり | クローン。暗色フィードの区切り線、本文と補助情報の強弱を比較。 |
| 16 | [dogankaraarslan1/ciaorelated](https://github.com/dogankaraarslan1/ciaorelated) | 文書・画像あり | 画像中心のSNS。画像・投稿者・本文が先に見える密度を比較。画像機能は追加しない。 |
| 17 | [ikhsan3adi/quick_social](https://github.com/ikhsan3adi/quick_social) | 文書・画像あり | FlutterのUI試作。小さな画面の文字と下メニューの配分を比較。 |
| 18 | [zivavu/Clonagram](https://github.com/zivavu/Clonagram) | 文書のみ | Instagramクローン。折りたたむメニューや内容に応じたレイアウトを確認。 |
| 19 | [neuralchemist/the-social-network](https://github.com/neuralchemist/the-social-network) | 文書・画像あり | 中立的な暗色、本文由来の色、メニューの抑え方を比較。 |
| 20 | [tkachiko/react-network](https://github.com/tkachiko/react-network) | 文書・画像あり | デスクトップ中心の学習制作。大きなプロフィール面はタイムラインの主目的と異なるため持ち込まない。 |
| 21 | [albeniskerqeli10/react-social-network-v1](https://github.com/albeniskerqeli10/react-social-network-v1) | 文書・画像あり | 淡い外側の背景と投稿面の明度差を比較。余白が広すぎる点は今回抑える。 |
| 22 | [misa-j/social-network](https://github.com/misa-j/social-network) | 文書・画像あり | 初めてのWebアプリとしての制作。装飾よりコンテンツで画面が変わる構成を比較。 |
| 23 | [shahshubh/SocialApp-React-Native](https://github.com/shahshubh/SocialApp-React-Native) | 文書・画像あり | モバイルSNS。投稿本文・リアクション・下のメニューの関係を比較。 |
| 24 | [burakorkmez/twitter-clone](https://github.com/burakorkmez/twitter-clone) | 文書のみ | チュートリアル。似たクローンの重複した根拠として重く扱わない。 |
| 25 | [carlosblinf/socialnetwork-ui](https://github.com/carlosblinf/socialnetwork-ui) | 文書・画像あり | Dribbble由来と明記。多いカードや補助情報はSoloVerseへ持ち込まない。 |
| 26 | [mlatka9/social-network](https://github.com/mlatka9/social-network) | 文書・画像あり | devchallenges由来と明記。明色の投稿面と外側の区別を比較。 |
| 27 | [cihandundar/twitter-clone](https://github.com/cihandundar/twitter-clone) | 文書のみ | 最初のクローン制作と明記。既知のSNS配置の確認に限定。 |
| 28 | [realanupreet/TwitterClone](https://github.com/realanupreet/TwitterClone) | 文書のみ | Composeの学習課題。下メニュー等の構成を文書で確認。 |
| 29 | [yousefkhalaf0/frontend-beginner-twitter-clone](https://github.com/yousefkhalaf0/frontend-beginner-twitter-clone) | 文書のみ | 学習制作。画面幅に応じた右列の非表示と下メニューを確認。 |
| 30 | [shreyadiwakar/Social-media-app](https://github.com/shreyadiwakar/Social-media-app) | 文書のみ | 機能・構成の確認。表示可能な画像がREADMEになく、視覚的根拠にはしない。 |
| 31 | [Serkanbyx/social-media-platform](https://github.com/Serkanbyx/social-media-platform) | 文書のみ | 機能一覧と画面区分を確認。READMEの「modern」等の自己評価をデザイン品質の証拠にしない。 |
| 32 | [yTakkar/React-Instagram-Clone-2.0](https://github.com/yTakkar/React-Instagram-Clone-2.0) | 文書のみ | クローン。コンテンツ中心の機能構成を確認し、動画は未視聴。 |

## 検証と範囲

提案はチャット内の見本。アプリ本体のソースは変更していない。320 / 375 / 640 / 736 / 1024px幅で両案の横はみ出しを確認し、いいね・返信開閉・見本内の投稿・通知開閉・案の切り替えを検証した。実データ、実際のタイムライン生成、ログイン後の画面遷移はこの見本では検証していない。

取得元と取得状況は `references.json`、目視に使った20画面は `visual-references.json`、操作確認結果は `preview-checks.json` に記録。
