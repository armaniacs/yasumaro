# PBI: 2026-11-21-04-refactor-ai-cleansing-threshold-loop

## ユーザーストーリー
開発者として、AI 要約クレンジング設定の threshold 系入力要素への値設定をループで反復処理したい。なぜなら、`linkRatioThreshold` / `shortTextThreshold` / `shortSeqCount` / `linkParaThreshold` / `fallbackRatio` などで `value` と `textContent` のペア設定が 5 回以上繰り返されており、KISS 原則に反しているから

## ビジネス価値
- 反復パターンの排除によりコード行数と認知負荷を削減
- 新しい threshold 要素の追加時に 1 行追加だけで対応可能
- 設定値の表示ロジックが 1 か所に集約され、バグ混入リスクを低減

## BDD 受け入れシナリオ

```gherkin
Scenario: threshold 設定値が入力要素と表示要素の両方に反映される
  Given AI 要約クレンジング設定の threshold 値が設定されている
  When   UI をロードする
  Then   各 threshold 入力要素の value に設定値が設定され、対応する表示要素の textContent にも同値が反映される

Scenario: threshold 要素が存在しない場合も例外が発生しない
  Given DOM に一部の threshold 要素が存在しない
  When   UI をロードする
  Then   例外が発生せず、存在する要素のみに値が反映される
```

## 受け入れ基準
- [ ] `src/dashboard/settings/aiSummaryCleansingSettingsV2.ts` で threshold 系の `value`/`textContent` ペア設定を `{ inputId, valueId, value }` 設定配列の `for` ループに集約
- [ ] 5 回以上繰り返されていた同パターンが 1 箇所のループにまとまる
- [ ] 存在チェック（null ガード）がループ内で適切に処理される
- [ ] `npm run type-check` が pass する
- [ ] `aiSummaryCleansingSettingsV2.test.ts` がすべて pass する

## テスト戦略（t_wada スタイル）

### E2E テスト
- なし（UI レベルの単一機能）

### 統合テスト
- 設定ロード時にすべての threshold 要素に値が正しく反映されることの統合検証

### 単体テスト
- ループ処理の単体テスト（全要素存在、一部要素欠如、全要素欠如）
- 各 threshold 値が正しく入力・表示要素に設定されることの検証

比率: E2E:統合:単体 = 0:1:10

## 実装アプローチ
- **Outside-In**: 既存テスト（失敗を確認）→ ループ化実装 → 既存の個別 `if` ブロックを削除 → テストグリーン → リファクタリング
- **Red-Green-Refactor**: TDD サイクルを適用
- **リファクタリング**: グリーンになるたびに品質改善

## 見積もり
2 ストーリーポイント（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: なし（`aiSummaryCleansingSettingsV2.ts` 内のリファクタリングのみ）
- テスタビリティ: jsdom 環境で DOM 要素への値設定テストが可能
- 非機能要件: なし

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）
```bash
# threshold 系の value/textContent ペア設定を確認
grep -n "threshold-input\|threshold-value\|fallback.*Slider\|fallback.*Value" src/dashboard/settings/aiSummaryCleansingSettingsV2.ts
# 反復パターンの箇所を特定（lines 274-308 前後）
sed -n '274,308p' src/dashboard/settings/aiSummaryCleansingSettingsV2.ts
```

### 実装手順
1. `{ inputId: string, valueId: string | null, value: number | string }` の設定配列を定義
2. `for` ループで各要素を取得し、`value` と `textContent` を設定（null ガード付き）
3. 既存の個別 `if` ブロック（lines 274-308）をループに置換
4. `npm run type-check` で型エラーがないか確認
5. `aiSummaryCleansingSettingsV2.test.ts` を実行し、すべて pass することを確認

### 落とし穴
- `fallbackRatio` は `/ 100` の変換が必要なため、ループ設定に `transform` オプションを持たせるか、別途処理する
- `textContent` 設定対象の要素 ID は `inputId` から推定できない場合（`link-ratio-threshold-value` など）があるため、明示的に指定する

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす（E2E/統合/単体すべて）
- [ ] コードレビュー完了（GitHub PR での approve を必須とする。セキュリティに関わる変更は CLAUDE.md「For Security Review Agents」節の観点確認をPR説明に明記）
- [ ] リファクタリング完了（グリーン後）
- [ ] ロールバック手段の検討（挙動変更・性能変更・フィルタロジック変更・閾値変更等の場合、本番投入後に問題が発覚した場合の切り戻し手段を技術的考慮事項または本項に記載）
- [ ] ドキュメント更新済み
