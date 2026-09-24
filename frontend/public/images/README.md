# トップページ背景

- 使用ファイル: `soloverse-space.webp`（1672 × 941、約41KB）
- ユーザー提供のトップページ参考画像をもとに、内蔵 image_gen で文字とフォームだけを除去。Sharp で WebP に最適化。
- ロゴ・入力欄・ボタンは `app/page.tsx` と `app/page.module.css` で実装。

## 生成プロンプト

Use case: precise-object-edit. Asset type: full-bleed 16:9 website background. Input image: edit target. Remove ONLY the white Soloverse wordmark and all login UI from this image (the two outlined input fields, user and lock icons, purple rectangular button with arrow, outlined square button with grid icon). Seamlessly fill those regions with the underlying almost-black purple nebula space. Preserve the original composition and mood as closely as possible: bright diffuse purple light at far left, very dark subtle purple nebula and sparse stars, huge dark sphere/arc occupying left 60%, thin purple orbital arc across upper right, small shaded sphere near lower middle, fine bottom-left square grid, fine top-right vertical lines, and thin horizontal purple line near bottom. No text, no letters, no symbols, no UI panels, no buttons. Preserve original 16:9 aspect ratio. This is a background-only asset that will sit behind real HTML text and controls.
