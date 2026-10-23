# PBI: 新設 gateway 3件の応答ガード共通化と SendFailure 透過型

## ユーザーストーリー

保守担当者として、ASK・REPORT・REGENERATE の gateway にある同一の応答ガードを1箇所に集めたい。なぜなら4件目の gateway 追加時に3通りの書き写しが生まれ、エラー文の不統一（RESEARCH_REPORT は timeout 文を流用）が既に起きているから。

## 優先度

- 順位: 03 / 全12件
- RICE スコア: 24（Reach = 9 / Impact = 2 / Confidence = 1.0 / Effort = 0.75人日）
- 根拠: 実測3複製 + 型の嘘（SendFailure 不可視）。前回 PBI 2026-10-20-11（sendWithPolicy 型制約）の新 gateway への波及残差。

## BDD 受け入れシナリオ

```gherkin
Scenario: 正常・異常応答が変更前と同一
  Given 各 gateway に正形・不正形の応答が返る
  When 共有ガード経由で正規化する
  Then 変更前と同一の成功値・失敗文が返る

Scenario: 送信失敗の型分岐
  Given sendWithPolicy が SendFailure を返す
  When gateway の戻りを受ける
  Then 型上で失敗分岐が可視であり、実行時も変更前と同一に処理される
```

## 受け入れ基準

- [x] 3 gateway の normalize 5行ガードが共有 helper に集約される
- [x] gateway の戻り型に `SendFailure` が透過する（または吸収設計を明文化する）
- [x] `sendWithPolicy.test.ts`・`regenerateSummaryGateway.test.ts` が全緑 + ask/research の単体テスト新規

## テスト戦略（t_wada スタイル）

- E2E: なし
- 統合: `sqliteHistoryPanel.ts:582-597,625` の成功・失敗分岐が共有ガードで同一に振る舞うテスト
- 単体: 共有ガードの table テスト（正形・不正形・null・非 object）+ ask/research gateway の normalize 単体テスト新規

## 見積もり

1pt（🟢低）

## 技術的考慮事項

- 依存関係: なし
- 配置先: `src/messaging/` 内の共有モジュール（gateway と同層のため循環なし）
- 非機能要件: 失敗文の文字列は変えない（RESEARCH_REPORT の timeout 文流用も維持し、文言統一は別途 owner 判断）

## 変更点の概要

`success in raw && typeof success === 'boolean'` の5行ガードを共有化し、3 gateway の normalize から呼ぶ。各 gateway の戻り型に `SendFailure` の union を明示する（実行時の吸収は caller が既に行っているため挙動不変）。

## 現状と問題（file:line 付き）

- `src/messaging/askHistoryGateway.ts:42-46` ― normalize ガード + `'Invalid ASK_HISTORY response'`
- `src/messaging/researchReportGateway.ts:47-51` ― 同形ガード + timeout 文流用
- `src/messaging/regenerateSummaryGateway.ts:50-54` ― 同形ガード（主スレッドが実読で確認）
- `src/messaging/sendWithPolicy.ts:51-54` ― 戻り `Promise<R | SendFailure>` に対し gateway 3件は `Promise<Response>` と宣言し union を透過
- 呼び出し元実数: `askHistory(` 本番1 + `exportResearchReport(` 本番1 + `regenerateSummary(` 本番2
- テスト: ask/research gateway の単体テストなし（`sendWithPolicy.test.ts`・`regenerateSummaryGateway.test.ts` はあり）

## 変更の理由（DRY・型安全性）

同じ理由（応答形状の契約変更）で同時に変わる3箇所であり、共通化は過度な抽象化ではない。型の嘘は将来の未処理分岐の温床になる。

## 提案コード（骨子のみ）

```typescript
// src/messaging/normalizeGatewayResponse.ts (新設。名前は仮)
export function asSuccessResponse<T>(raw: unknown, invalidError: string): T | { success: false; error: string };
// 各 gateway: normalizeXResponse → 共有 helper への委譲に縮小
// 各 gateway の戻り型: Promise<AskHistoryResponse | SendFailure> の形に明示
```

## 実装者向け注記

```bash
grep -rn "typeof (raw as" src/messaging/*.ts | grep -v __tests__
```

- エラー文の文字列は1文字も変えない（i18n・テスト pin のため）
- `SendFailure` を union に載せた結果 caller の型エラーが出たら、caller の分岐を型に合わせる（実行時分岐は既存のまま）

## Definition of Done

- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [x] 既存テスト全通過 + ask/research gateway 単体テスト新規通過
- [ ] `npm run validate` 通過
- [x] ドキュメント更新済み
