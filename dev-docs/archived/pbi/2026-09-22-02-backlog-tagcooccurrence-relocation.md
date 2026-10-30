# PBI: tagCooccurrence 計算層の dashboard 配下からの移設

## ユーザーストーリー
保守担当の開発者として、タグ共起の純粋関数を UI エントリ配下から独立した層に置きたい、なぜなら wasm/tag-cooccur と offscreen テストが dashboard 配下を cross-import しており、層の向きが逆になっているから。

## 優先度
- 順位: 02 / 3
- RICEスコア: 1.5（Reach=3 / Impact=1 / Confidence=0.5 / Effort=1）
- 根拠: 実害は未発生。移設先が offscreen かパイプラインかは、compute の実行場所の裁定に依存する。
- 再検討トリガー: compute を offscreen/パイプラインへ移設する時（dedup の offscreen 移設の再評価と同時）。それまでは着手しない。

## 背景（2026-09-22 時点の現状）
- `src/dashboard/tagCooccurrence.ts`（純粋関数）と `src/dashboard/tagCooccurrenceHybrid.ts`（WASM ハイブリッド）が dashboard 直下にある。
- wasm/tag-cooccur のパリティ・bench と offscreen 側テストがこれらを import している。
- 関連 PBI: `2026-09-20-17/21/22`（tag-cooccur の WASM 化・配線・CI ゲート。実機確認と PR レビュー待ち）。

## BDDシナリオ
Scenario: 移設後も出力が変わらない
  Given 移設前の tagCooccurrence の入出力を golden として pin してある
  When  純粋関数を新しい層へ移す
  Then  既存のパリティ・ハイブリッド・パネルのテストが変更なしで通る

Scenario: 層の向きが正しくなる
  Given 移設後のツリー
  When  wasm/ と offscreen/ から import 元を検索する
  Then  dashboard 配下への import が 0 件になる

## 受け入れ基準
- [x] 移設先を裁定し、理由を PBI に記録した（2026-10-30 裁定: **`src/utils/` Layer 2（High-level Utilities）へ両ファイル移設**。compute の実行場所は dashboard（options ページのメインスレッド ― 本番呼び出しは 4 つの dashboard パネルが `tagCooccurrenceHybrid` 経由）で、offscreen/パイプラインからの本番利用は 0 件。純粋関数は wasm/tag-cooccur（bench・index 型・parity テスト）と offscreen テストからも消費される共有語彙のため、最下層の共有層が正しい居場所。既存前例: `sentenceExtractor.ts`/`contentDeduplicator.ts`（+ hybrid ラッパー）が同一構成で utils 配下にあり、`sentenceExtractorHybrid.ts` の `../wasm/textrank/` import が utils → wasm の下向き辺として確立済み。wasm → dashboard は UI 層への上向き辺（LAYERS.md の上向き依存禁止・utils 層 SSOT の FORBIDDEN_TARGET_LAYERS と同一の向き）で、移設により解消）
- [x] 関数の挙動は byte-identical で、golden テストが移設前後で同一（2026-10-30: `git mv` で rename similarity 96%/97%・移設ファイルの差分は import 行+自モジュールの JSDoc パス参照のみ。ロジック・定数・エクスポート名・全 ~20 テストファイルのアサーションは不変。既存パリティ・ハイブリッド・パネル・キャップ・probe-retry テスト 22 ファイル 240 テストが変更なしで green）
- [x] `2026-09-20-17/21/22` のレビューが終わり、競合しないことを確認した（2026-09-24 アーカイブ済み ― `502c1093`/`7ea33e53` で再検証・反映。着手可能）
- [x] 新規・移動ファイルを lint の層分類 SSOT と、必要なら `manifest.json` の `web_accessible_resources` に登録した（2026-10-30: `eslint/rules/utils-layer-boundary.mjs` の LAYER2_MODULES に両ファイル追加+`dev-docs/LAYERS.md` Layer 2 分類表に両ファイル追加。`lint-layers-docs.mjs` 0（84 entries・90 paths・48 declarations in sync）。`// @layer 2` 宣言は既存前例（sentenceExtractor/contentDedup 系）に倣い不付与。manifest の WAR は不接触でよい: wasm 本体の fetch は `wasm/tag-cooccur/index.ts` がモジュール相対で解決しパス不変・wasm は拡張ページから fetch され WAR 対象外）
- [x] 旧パスからの import が残っていない（2026-10-30: `grep -rn "dashboard/tagCooccurrence" src/ entrypoints/` = 0 件+broader `.js` 参照 grep で 39 参照全て utils/ を指すことをレビュー側が独立検証。旧パス逆戻りを検出する pin テスト `src/__tests__/tagcooccur-layer-direction.test.ts` を新設（ミューテーション検証済み: bench.ts を旧パスに戻すと失敗・復元確認）。残存していた旧パス参照 4 件はコメント修正済み（`wxt.config.ts`・`dev-docs/manual-tests/tag-cooccur-panel-visual.md`・`wasm/tag-cooccur/src/cooccur.rs`・`lib.rs`））

## テスト戦略
- 単体: 既存パリティテスト（TS 対 WASM）をそのまま流用
- 統合: `npm run validate` と `npm run build`

## 見積もり
3 SP（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする（2026-10-30: シナリオ 1（出力不変）は既存パリティ・ハイブリッド・パネル・キャップ・probe-retry テスト 22 ファイル 240 テストが変更なしで green、シナリオ 2（層の向き）は pin テスト `src/__tests__/tagcooccur-layer-direction.test.ts` 3 テスト green。ミューテーション検証済み）
- [x] type-check / lint / test / build が通る（2026-10-30: `npx tsc --noEmit` 0・type-test baseline 446 維持・`npx eslint` 変更 28 ファイル 0・`lint-layers-docs` 0・`npx vitest run` 22 ファイル 240 テスト green・pin 3 テスト green・`npm run build` 成功。最終ゲート `make clean test`（build chromium+firefox → `npm run validate`）exit 0）
- [x] コードレビュー完了（2026-10-30: タスクレビュー 2 回（spec + 品質、0 Critical/Important）+ 最終ブランチレビュー（最上位モデル、0 Critical・Important 1 件は「フルスイート検証を pre-merge で 1 回実行」で対応・Minor 5 件のうち Rust doc 2 件は修正済み、検出器の syntax ギャップと robustness nit は brief の mandated スコープ外として carry・後続候補として eslint no-restricted-imports 拡張（src/wasm + src/offscreen → dashboard 禁止）を記録））
