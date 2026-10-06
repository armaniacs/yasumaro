# PBI: diagnosticsPanel の renderCompileOptions が compileOptions 文字列を未エスケープで埋め込む

## ユーザーストーリー

診断パネルの利用者として、compileOptions の描画を安全にしたい。同一データを `makeStatRow` では `textContent` で安全描画する一方、`<details><pre>` だけ `setElementHtml` に素通ししており、`setElementHtml` はエスケープしないため XSS 表面になるから。

## 優先度

- 順位: 1/23
- RICE: 9.0（R3 / I3 / C1.0 / E1）
- 根拠: セキュリティ表面の不整合。単一関数内の修正で閉じる
- 依存: なし

## 背景（file:line 現状）

- `src/dashboard/panels/diagnostic/diagnosticsPanel.ts:574-597` の `renderCompileOptions` 全体。`:580-581` と `:583-585` は `makeStatRow` で安全描画するが、`:588-595` で `setElementHtml(allOptionsDetails, ... <pre ...>${options.join('\n')}</pre> ...)` が未エスケープ
- 対照の安全側: `src/dashboard/diagnosticUtils.ts:14-32`（`makeStatRow` は `createElement` + `textContent` のみ）
- パーサの無保証: `src/utils/htmlFragment.ts:59-75`（`setElementHtml` はパースのみでエスケープなし。`:15` コメントで caller 側の escape を要求）
- 同一ファイル内の安全描画の反復（`:43-47, :91-92, :100-101, :201-205, :283-289, :471-473`）に対しこの 1 箇所だけが例外

## BDD受け入れシナリオ

```gherkin
Scenario: compileOptions に markup が混ざっても解釈されない
  Given `<img src=x onerror=...>` を含む compileOptions
  When renderCompileOptions が描画する
  Then pre 要素の text として表示され、要素は生成されない

Scenario: 正常系の表示が変わらない
  Given 通常の compileOptions 一覧
  When 描画する
  Then Source/Total 行と All N options の件数・内容が従来と同一である
```

## 受け入れ基準

- [x] `options.map(escapeHtml).join('\n')` してから `setElementHtml` するか、`<pre>` を `createElement` し `textContent` で組み立てる
- [x] `All ${options.length}` の数値補間は触らない
- [x] 既存の `makeStatRow` 行は変更しない
- [x] markup 混入時の非解釈テストが 1 ケース追加されている
- [ ] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- 単体: markup 混入テスト + 既存 diagnostics レンダーテストが green
- 実時間待ちは使わない（AGENTS.md / TEST_RULE 準拠）

## 見積もり

1 SP

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 変更ファイル: `src/dashboard/panels/diagnostic/diagnosticsPanel.ts`（escapeHtml マップ）、新規 `diagnosticsPanel.compileOptions.test.ts`（markup 非解釈 1 ケース）
- ゲート: 対象 28 tests green / type-check PASS / lint 0 errors
