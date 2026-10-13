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

- [x] `checkPermissionCaps` と `checkWebAccessibleResourcesChain` の manifest 読み込みが existsSync + try/catch のクリーン fail パターンに統一されている
- [x] invalid JSON でスタックトレースではなく fail メッセージで落ちることを手動確認して記録する（例: manifest.json を一時的に壊して `node scripts/release-checks/index.mjs --category=manifest` → exit 1・クリーンメッセージ。復元する）
- [x] 有効な成果物で動作が変わらない（`npm run build` 後のゲートが green）
- [x] `npm run validate` が green

## 検証結果（2026-10-13 実施）

- 実装のスコープ拡張（実測に基づく判断）: 修正前の再現で invalid JSON 時のクラッシュ点が PBI 背景の挙げる `checkPermissionCaps()` / `checkWebAccessibleResourcesChain()` ではなく **`checkManifestV3Compliance()`（:45、main() が最初に実行する関数）** であることを特定（`SyntaxError: Expected property name or '}' in JSON at position 1` + スタックトレース + 壊れた manifest 全文ダンプ）。指定 2 関数に加えてこの関数の裸 `JSON.parse` も同一メッセージの try/catch で包んだ。ここを直さないと invalid JSON 時のゲート出力は 1 文字も変わらないため必須。fix 後は invalid JSON はこの 1 か所で ❌ + exit 1 となり、main() の fail-fast で以降のセクションは走らない。
- invalid JSON 確認: manifest.json 先頭に `{` を付与（Edit ツール）→ 修正前: exit 1 + スタックトレース + manifest 全文ダンプ。修正後: exit 1、`Built manifest.json could not be parsed as JSON — the build artifact is corrupt` のみ（スタックトレース無し・ダンプ無し）。`npm run build` で再生成 → checksum が事前退避した baseline と完全一致を確認後にバックアップ削除。**dist 復元漏れなし**。
- 検証: `npm run build` → exit 0。正常な成果物で `node scripts/release-checks/index.mjs --category=manifest` → exit 0（20 passed、baseline と同一・動作不変）。`npm run validate` → exit 0（1062 files / 16032 tests）。
- コードレビュー: マージ時にメインエージェントが全差分をレビュー済み。

## テスト戦略

- 統合: ビルド後ゲートの手動実行確認（dist 依存のため vitest スイートには置かない — NN03 2026-10-12 の配線判断と同じ）。単体/E2E は不要。

## 見積もり

0.25 SP

## Definition of Done

- [x] 全BDDシナリオが自動ゲートとして検証されパスする（ビルド後ゲートの手動実行を含む）
- [x] type-check / lint / test が通る（`npm run validate` green）
- [x] 検証結果（コマンドと結果）を PBI に記録する
- [x] コードレビュー完了
