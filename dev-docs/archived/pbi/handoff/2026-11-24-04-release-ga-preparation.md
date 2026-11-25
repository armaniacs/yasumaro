# 引き継ぎ: 2026-11-24-04 正式版リリース準備

- 状態: 文書の更新まで完了。採番待ち(07・08 の完了後)
- 最終更新: 2026-11-24
- 対象 PBI: [../2026-11-24-04-release-ga-preparation.md](../2026-11-24-04-release-ga-preparation.md)

## 済んだこと

ブランチ `1124a` のコミット 6d39eb66e(docs:)に入っています。

- README.md の日本語「Obsidianへの追加の仕組み」節を、If-Match 条件付き書き込みと 412 の 1 回再書き込みに合わせて更新した
  - 強い ETag があれば If-Match を付ける、412 なら GET から保存までを 1 回だけやり直す、2 回目も 412 なら保存失敗として扱う
  - ETag が無い・弱い・新規ノートのときは従来どおりで、小さな競合リスクが残る
  - dev-docs/API_ENDPOINTS.md の If-Match 節へリンク

## 済んだこと(追加)

ブランチ `1124a` で実施。

- README English 側に「How Obsidian appends work」節を新設し、日英で内容を揃えた(競合通知の表面化を含む最新仕様)
- README の機能一覧を裁定(4 機能とも開発中のまま)に合わせた。English 側の 3 機能に「in development」を付け、日英で対称にした。webhook export は機能一覧に載せないまま
- `CHROMEWEBSTORE.md` を更新: Target version を 6.9.76 に同期、webhook を experimental と明記(機能一覧と説明文)、Privacy summary の旧方式の説明を許可リスト方式に更新
- `AGENTS.md` の Release 節の `manifest.json` bump の記述を実際の版管理(package.json が SSOT)に修正

## 残りの手順

1. 08(実機スモーク)の実施と完了(owner が実施)
2. タグ push とストア提出(owner が実行)
3. `docs/RELEASE_POLICY.md` の扱いは保留(owner 指示。v7 方針の節は追加しない)
4. SECURITY.md の 6.x の扱いは保留(owner 指示。6.9 系のため現行の 6.x Supported のまま変更なし)

## 採番の記録(2026-11-25: 6.9.78 再採番)

- 08(実機スモーク)で検出された 2 件の不具合修正(PBI 2026-11-25-01 / 2026-11-25-02)を取り込んだため、PBI 08 の手順に従い 6.9.77 から 6.9.78 へ再採番した
- `package.json` → `node scripts/sync-version.mjs`(docs/version.json と package-lock.json)→ `cli/Cargo.toml` 手動の順に 6.9.78 へ同期し、`CHANGELOG.md` と `CHROMEWEBSTORE.md` を更新した

## 採番の記録(2026-11-24)

- owner が 6.9.77 を指定した(7.0.0 にはしない)。PBI の「07・08 の完了後にのみ採番」は、owner の明示の指示で先行実施した。08 で修正が入った場合は 6.9.78 以降に再度採番する
- `package.json` → `node scripts/sync-version.mjs`(docs/version.json と package-lock.json)→ `cli/Cargo.toml` 手動の順に 6.9.77 にした
- `node scripts/check-version-consistency.js` 緑。`npm run validate` 緑(1364 ファイル、19210 テスト)。`npm run release:check:fast` 緑(8/8。coverage は `npm run test:coverage` を先に実行)
- CHANGELOG に `## [6.9.77] - 2026-11-24` を書いた。リリース日がずれたら日付を直すこと
- popup の版表示 E2E(`popup-version-display.spec.ts`)は validate の全量に含まれ緑
- Chrome E2E 全量の結果は 08 の handoff に記録した(製品の赤なし)。PBI 20(probe 切り分けと重い spec 分離)は実装済み

## owner への確認事項(回答済み)

- 版番号: 6.9.77(決定)。v7 方針と 6.x の扱い: 一旦保留
- Edge / AMO の掲載文: CHROMEWEBSTORE.md を 3 ストア共用(決定。CHROMEWEBSTORE.md に明記済み)

## 注意

- worktree は `main` から分岐するため、`1124a` にしかない実装(If-Match など)は入っていない。README のコミットは `1124a` の上に載せてあり、`main` へ入れるときは `1124a` と一緒に入れること
