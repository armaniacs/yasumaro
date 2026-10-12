# PBI: check-manifest.mjs の manifest 再読み込みをクリーン fail パターンに統一する

code-review（2026-10-13）の指摘4 から起票。

## ユーザーストーリー

CI の失敗を見る開発者として、壊れたビルド成果物でゲートが落ちた時にスタックトレースではなくクリーンな fail メッセージがほしい、なぜならどの不変条件が壊れたかの判定に余計な読解コストがかかるから。

## 優先度

- 順位: 02 / 全候補数 7
- RICEスコア: **4.0**（Reach=2 / Impact=0.5 / Confidence=1.0 / Effort=0.25）
- 根拠: 実害は無い（CI はどのみち fail する）が、失敗出力の読みやすさには年数回関与する。同点候補（NN03/04/05）と比べてリスク軽減効果（ゲート出力の信頼性）が上。同点タイブレーク規則（リスク軽減効果 → 時間的緊急性）による。

## 背景

- `checkPermissionCaps()` と `checkWebAccessibleResourcesChain()`（`scripts/release-checks/check-manifest.mjs`）は `JSON.parse(readFileSync(manifestPath, 'utf-8'))` を裸で呼ぶ。manifest.json が invalid JSON の場合、unhandled SyntaxError とスタックトレースで落ちる。
- 同ファイルの `checkManifestV3Compliance()` は `existsSync` + クリーン fail（`fail('Built manifest.json not found — run build first'); return false;`）のパターンを持つ。このパターンに統一する。

## BDD受け入れシナリオ

Scenario: invalid JSON でクリーンに落ちる
  Given dist/chromium-mv3/manifest.json が壊れた JSON の状態
  When  checkPermissionCaps が走る
  Then  スタックトレースではなく「manifest.json の読み込みに失敗」旨の fail メッセージで exit 1 する

Scenario: 正常な成果物では動作が変わらない
  Given 有効な dist/chromium-mv3/manifest.json
  When  ゲート全体が走る
  Then  従来どおり green で exit 0

## 受け入れ基準

- [ ] `checkPermissionCaps` と `checkWebAccessibleResourcesChain` の manifest 読み込みが existsSync + try/catch のクリーン fail パターンに統一されている
- [ ] invalid JSON でスタックトレースではなく fail メッセージで落ちることを手動確認して記録する（例: manifest.json を一時的に壊して `node scripts/release-checks/index.mjs --category=manifest` → exit 1・クリーンメッセージ。復元する）
- [ ] 有効な成果物で動作が変わらない（`npm run build` 後のゲートが green）
- [ ] `npm run validate` が green

## テスト戦略

- 統合: ビルド後ゲートの手動実行確認（dist 依存のため vitest スイートには置かない — NN03 2026-10-12 の配線判断と同じ）。単体/E2E は不要。

## 見積もり

0.25 SP

## Definition of Done

- [ ] 全BDDシナリオが自動ゲートとして検証されパスする（ビルド後ゲートの手動実行を含む）
- [ ] type-check / lint / test が通る（`npm run validate` green）
- [ ] 検証結果（コマンドと結果）を PBI に記録する
- [ ] コードレビュー完了
