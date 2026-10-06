# PBI: Gemini の空応答 summary に `failure` を付与する（failure contract の残差）

## ユーザーストーリー

AI 要約の保守担当者として、provider 間の空応答メタデータを揃えたい。閉鎖済み「AI provider failure contract unify」が Gemini 空応答の 2 経路だけ残し、OpenAI 空は breaker が冷却できるのに Gemini 空は kind なしで分類不能のままだから。

## 優先度

- 順位: 2/23
- RICE: 8.0（R4 / I2 / C1.0 / E1）
- 根拠: 閉済 PBI の残差宣言どおり。対称化のみで breaker 政策は変えない
- 依存: なし

## 背景（file:line 現状）

- 対称のある側: `src/background/ai/providers/OpenAIProvider.ts:278-284`（空に `createFailure(FailureKind.HTTP)` 付き）
- 対称欠落: `src/background/ai/providers/GeminiProvider.ts:371-378`（`MAX_TOKENS` 分岐と汎用空分岐とも `failure` なし）
- 残差宣言: `dev-docs/archived/pbi/2026-09-29-35-fix-ai-provider-failure-contract-unify.md:145`（Gemini 空に kind 未付与を明記）
- kind 選択根拠: 同 PBI `:118-124`（200 空応答は `HTTP`＝応答側欠陥）
- 対象外: `testConnection` 空応答（`GeminiProvider.ts:278-307`）は両 provider とも `debug.failure` なしで対称のため触らない

## BDD受け入れシナリオ

```gherkin
Scenario: Gemini の空応答が failure を持つ
  Given Gemini の空応答（汎用・MAX_TOKENS の両経路）
  When summary を生成する
  Then failure に FailureKind.HTTP が付く

Scenario: 文言と detail が変わらない
  Given 同一の空応答
  When 生成する
  Then summary 文言・error detail・describeEmptyResponseDetail の出力が従来と同一である
```

## 受け入れ基準

- [x] Gemini の 2 return に `failure: createFailure(FailureKind.HTTP)` が付与されている
- [x] 文言・`error` detail・`describeEmptyResponseDetail`（`:332-347`）は不変
- [x] `testConnection` 空応答は触らない
- [x] breaker 政策の変更なし
- [ ] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- 単体: 両経路の failure 付与テスト。既存テストが green
- 実時間待ちは使わない

## 見積もり

1 SP

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 変更ファイル: `src/background/ai/providers/GeminiProvider.ts`（2 return のみ）
- ゲート: 対象 6 tests green / type-check PASS / lint 0 errors
