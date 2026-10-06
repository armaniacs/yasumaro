# PBI: dashboard-ui と dashboard-diagnostics の静的アサーション二重主張を一本化する

## ユーザーストーリー

E2E を保守する開発者として、診断系の存在確認を 1 ファイルにしたい。同一 ID 群を 2 ファイルで二重主張しており、ID 改名・パネル追加のたびに 2 箇所更新が必要で、片方だけ陳腐化するから。

## 優先度

- 順位: 22/23
- RICE: 1.35（R3 / I1 / C0.9 / E2）
- 根拠: 削除＋パラメタ化。主張集合は同一
- 依存: なし

## 背景（file:line 現状）

- Diagnostics パネル要素群: `testDir/e2e/dashboard-ui.spec.ts:305-341` vs `testDir/e2e/dashboard-diagnostics.spec.ts:10-41`（同一 ID 群。結果エリア・compile options まで一致）
- Export Logs ボタン群: `dashboard-ui.spec.ts:352-361` vs `dashboard-diagnostics.spec.ts:45-56`
- サイドバー存在確認: `dashboard-ui.spec.ts:108-116` vs `dashboard-diagnostics.spec.ts:59-71`
- 同種の単独列挙（本 PBI では寄せ方向の参考）: `extension.spec.ts:30-98`、`privacy-consent.spec.ts:12-122`、`dashboard-built-in-ai.spec.ts:22-31`

## BDD受け入れシナリオ

```gherkin
Scenario: 二重主張が一本化される
  Given 両 spec の同一 ID 群
  When dashboard-diagnostics を削除し dashboard-ui に寄せる
  Then 主張集合が同一で、ID 列挙が for パラメタ化に畳まれている
```

## 受け入れ基準

- [x] `dashboard-diagnostics.spec.ts` が削除され `dashboard-ui.spec.ts` に一本化されている
- [x] ID 列挙が `for (const id of IDS)` パラメタ化に畳まれている
- [x] `privacy-consent` の構造 12 テストは `toBeVisible`/操作系寄せかスナップショット集約のいずれかになっている
- [x] 主張集合が同一である
- [x] `npm run validate` が PASS する（最終ゲートで確認。E2E 自体は CI 範囲）

## テスト戦略

- E2E 自体はブラウザ要のため CI 範囲。静的検証は validate で確認
- 実時間待ちは使わない

## 見積もり

2 SP

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [x] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 変更ファイル: `dashboard-ui.spec.ts`（一本化＋パラメタ化）、`dashboard-diagnostics.spec.ts`（git rm で削除）、`privacy-consent.spec.ts`（for 化＋Visibility 集約）。和集合で主張同一（片側のみの ID・文言は吸収・分離維持）
- ゲート: eslint 対象 PASS / type-check PASS（全体）/ lint 0 errors。E2E 実行は CI 範囲
