# PBI: CRX3 署名スクリプトを scripts/ へ移設する

## ユーザーストーリー
保守担当の開発者として、CRX3 署名スクリプトを scripts/ 配下に置きたい、なぜなら production ビルドロジックの canonical は scripts/（build-store-zip.mjs、sync-version.mjs 等が存在）で、workflow 定義ディレクトリに置かれていると署名ロジックを探す際に発見できないから。

## 優先度
- 順位: 04 / 4
- RICEスコア: 4.0（Reach=2 / Impact=0.5 / Confidence=1.0 / Effort=0.25）
- 根拠: 慣習整合・発見性。署名方式が変わる時のみ触る。
- 出所: holistic-code-review（2026-10-14、差分スコープ 49ca0c62..HEAD）テーマ3

## 背景（2026-10-14 時点の現状）
- `.github/workflows/build-crx3.mjs` は CRX3 署名の production ビルドロジック（protobuf エンコーダ + RSA-SHA256 署名、95 行）だが、workflow 定義ディレクトリに置かれている。
- ビルド系スクリプトの canonical は `scripts/`（build-store-zip.mjs、sync-version.mjs、check-version-consistency.js 等が実在）。
- pin テストが境界を逆方向に横断: `scripts/__tests__/build-crx3.test.ts:14` が `resolve(__dirname, '../../.github/workflows/build-crx3.mjs')` を参照。
- release.yml:53 が `node .github/workflows/build-crx3.mjs \ ...` で呼び出す。
- CRX3 生成はこの 1 箇所のみ（重複なし、grep 実測済み）。

## BDDシナリオ
Scenario: 移設後も pin テストが同一参照先で通る
  Given スクリプトが scripts/build-crx3.mjs に移設されている
  When pin テストを実行する
  Then 参照パス更新後に全テストが変更なしで通る

Scenario: ワークフローは移設後のパスでスクリプトを実行する
  Given release.yml の呼び出しパスが更新されている
  When 次回タグ push で Release ワークフローが実行される
  Then 署名ステップが従来どおり成功する

## 受け入れ基準
- [ ] `build-crx3.mjs` が `scripts/build-crx3.mjs` に移設される（履歴保持のため git mv を使用）
- [ ] `release.yml:53` の呼び出しパスが `node scripts/build-crx3.mjs` に更新される
- [ ] `scripts/__tests__/build-crx3.test.ts:14` の SCRIPT 定数が `resolve(__dirname, '../build-crx3.mjs')` に更新される
- [ ] pin テスト（`npx vitest run scripts/__tests__/build-crx3.test.ts`）が全件 green
- [ ] スクリプト内容は byte-identical（変更は移設のみ）
- [ ] eslint が移設後のファイルで green（eslint は .github/ と scripts/ の両方を対象にしており、同一内容のため変化しないことを確認）

## テスト戦略
- 単体: 既存 pin テスト（build-crx3.test.ts、署名検証・NUL 終端・zip 完全一致・crx_id 導出）をそのまま流用
- 統合: `npm run validate` と `npm run build`

## 見積もり
0.25 SP（移設 + パス更新 2 箇所）

## Definition of Done
- [ ] 受け入れ基準がすべて満たされている
- [ ] lint / type-check / test / build が通る
- [ ] コードレビュー完了
