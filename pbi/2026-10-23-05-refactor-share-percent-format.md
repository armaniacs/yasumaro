# PBI: 割合％表示の丸め共通化

## ユーザーストーリー

保守担当者として、割合％の丸め計算を1箇所に集めたい。なぜなら算出式・提案行・偏り行に3通りの `Math.round` が分散し、丸め境界の表示差分が将来のバグになるから。

## 優先度

- 順位: 05 / 全12件
- RICE スコア: 15（Reach = 6 / Impact = 1 / Confidence = 1.0 / Effort = 0.4人日）
- 根拠: 実測4箇所の同意味計算。すべて `Math.round(x * 100)` のため純粋置換できる。

## BDD 受け入れシナリオ

```gherkin
Scenario: 表示割合が変更前と同一
  Given 偏り判定と提案がある
  When 共有フォーマッタ経由で描画する
  Then 変更前と同一の％表示になる

Scenario: 丸め境界
  Given 割合が xx.5% の境界にある
  When 共有フォーマッタで丸める
  Then 変更前と同一の丸め結果になる
```

## 受け入れ基準

- [ ] panel 側の `Math.round(share * 100)` 系3箇所が共有 helper に置換される
- [ ] 丸め境界の table テストが新規追加される
- [ ] 既存テスト全緑

## テスト戦略（t_wada スタイル）

- E2E: なし
- 統合: domainAnalysisPanel の偏り行・提案行の表示テスト（境界値を含む）
- 単体: 共有フォーマッタの table テスト（0・100・境界・total 0）

## 見積もり

0.5pt（🟢低）

## 技術的考慮事項

- 依存関係: なし
- 配置先: `domainIntelAggregate.ts` の隣（`shareFormulaText` のあるモジュール）または Layer 0。panel → aggregate の import は既存のため循環なし
- 非機能要件: 丸め意味不変（`Math.round` のまま）

## 変更点の概要

`shareFormulaText` のあるモジュールに割合％フォーマッタを集め、panel 側3箇所を置換する。

## 現状と問題（file:line 付き）

- `src/dashboard/domainIntelAggregate.ts:66-69` ― `shareFormulaText`（`Math.round(topCount / total * 100)`）
- `src/dashboard/panels/asyncData/domainAnalysisPanel.ts:201` ― `Math.round(proposal.share * 100)`
- `src/dashboard/panels/asyncData/domainAnalysisPanel.ts:232,237` ― `Math.round(bias.topShare * 100)`（表示テンプレート内を含む）
- 呼び出し元実数: 4箇所 + `computeSourceBias` 内1件
- 前回 PBI 2026-10-20-21 と同一主題の軽微残差

## 変更の理由（DRY）

同じ理由（表示丸めの変更）で同時に変わる関係。YAGNI フィルタ通過。

## 提案コード（骨子のみ）

```typescript
// src/dashboard/domainIntelAggregate.ts（仮）
export function sharePercent(share: number): number; // Math.round(share * 100)
export function sharePercentOf(part: number, total: number): number;
// domainAnalysisPanel.ts:201,232,237 → 置換
```

## 実装者向け注記

```bash
grep -rn "Math.round(.*\* 100)" src/dashboard/domainIntelAggregate.ts src/dashboard/panels/asyncData/domainAnalysisPanel.ts
```

- テンプレート内の fallback 文字列（`:237` の第3引数）も同一 helper に寄せる
- 丸め境界（2.5 → 3 等）の table を先に書き、置換前後で同一を確認する

## Definition of Done

- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] 既存テスト全通過 + 丸め境界テスト新規通過
- [ ] `npm run validate` 通過
- [ ] ドキュメント更新済み
