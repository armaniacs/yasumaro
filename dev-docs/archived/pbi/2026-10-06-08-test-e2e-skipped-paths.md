# PBI: skip/fixme/空実装の E2E 重要パスを検証可能にする

## ユーザーストーリー

E2E の保守担当者として、重要パス の無主張テストをなくしたい。テストは存在するのに何も検証しておらず、グリーンのまま本番回帰を見逃すから。

## 優先度

- 順位: 8/23
- RICE: 3.2（R4 / I2 / C0.8 / E2）
- 根拠: traceId の SW logger 仕様確認が残る。本番コード不変
- 依存: なし

## 背景（file:line 現状）

- `testDir/e2e/recording-traceId.spec.ts:18`（`test.skip` — 単一 recording の traceId 一致を検証する唯一の E2E。理由は logger flush タイミング）
- `testDir/e2e/privacy-consent.spec.ts:125,133,141,146`（同意インタラクション 4 テストが `fixme`）
- `testDir/e2e/extension.spec.ts:286-295`（`test.fixme` の extractContent）、`:298-305`（空実装 2 テスト: コメントのみ）
- `testDir/e2e/constant-time-compare-availability.spec.ts:41-46`（偽でも `console.warn` のみで assertion なし）

## BDD受け入れシナリオ

```gherkin
Scenario: traceId の skip が解除される
  Given seedPrivacyConsent 済み SW の sanitization_logs
  When expect.poll で読む
  Then traceId 一致が検証される（flush 条件待ちに置換）

Scenario: consent の fixme が実行される
  Given dashboard fixture 系の実 consent フロー
  When 4 テストを実行する
  Then checkbox 有効化/無効化・decline/accept の閉止が検証される

Scenario: 空実装・無主張が整理される
  Given extractContent の fixme・空実装 2 件・constant-time
  When 整理する
  Then 実装か削除のいずれかになり、無主張の green が残らない
```

## 受け入れ基準

- [x] traceId の skip が `expect.poll` による条件待ちに置換されている
- [x] consent 4 件の fixme が解除され実フローで実行されている
- [x] 空実装 2 件が実装または削除されている
- [x] constant-time が `expect` 追加またはフォールバック契約の文書化のいずれかになっている
- [x] 本番コード不変。E2E 実行は CI 範囲
- [x] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- E2E 自体はブラウザ要のため CI 範囲。静的検証は validate で確認
- 実時間待ちは使わない（expect.poll を使用）

## 見積もり

2 SP

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [x] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 変更ファイル: 対象 4 spec のみ（本番コード不変）。traceId は poll 化、consent は実フロー化（hidden 判定を toBeHidden に修正）、空実装は削除、constant-time は expect 3 件＋契約文書化
- ゲート: eslint 4 ファイル PASS / type-check PASS（全体）/ lint 0 errors。E2E 実行は CI 範囲
