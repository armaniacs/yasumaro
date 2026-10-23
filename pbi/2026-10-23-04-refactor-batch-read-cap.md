# PBI: バッチ読込上限 200 の limits 集約

## ユーザーストーリー

保守担当者として、バッチ読込の上限 200 を `limits.ts` に集めたい。なぜならレポート生成とタグ提案に同値の別名定数が分散し、片方だけ変える事故が起きるから。

## 優先度

- 順位: 04 / 全12件
- RICE スコア: 18.7（Reach = 7 / Impact = 1 / Confidence = 0.8 / Effort = 0.3人日）
- 根拠: `limits.ts` は上限の正準置き場であり、吸収の前例がある。Confidence 0.8 は「同一概念か」の判断残り（乖離時は分名して limits 内に残す迭定付き）。

## BDD 受け入れシナリオ

```gherkin
Scenario: 上限値が変更前と同一
  Given 200件超の記録がある
  When レポート生成・タグ提案収集を実行する
  Then 変更前と同一の200件境界で読まれる

Scenario: 上限の所在
  Given 上限を変えたい
  When limits.ts の1箇所を変える
  Then 両経路に反映される（乖離が必要なら分名する）
```

## 受け入れ基準

- [ ] `REPORT_MAX_RECORDS` と `NORM_PROPOSAL_SCAN_LIMIT` が同一定数を参照する
- [ ] 値は 200 のまま（数値変更なし）
- [ ] 既存テスト全緑

## テスト戦略（t_wada スタイル）

- E2E: なし
- 統合: なし（定数参照の置換のみ）
- 単体: 既存の上限関連テストを維持し、値 pin があれば limits 経由に寄せる

## 見積もり

0.5pt（🟢低）

## 技術的考慮事項

- 依存関係: なし
- 配置先: `src/utils/limits.ts`（Layer 0。前例: MAX_QUERY_IDS = 200 系）
- 非機能要件: 数値不変。dashboard → background の import は作らない（両方が limits を参照する形）

## 変更点の概要

`researchReportGenerator.ts:38` の `REPORT_MAX_RECORDS = 200` と `tagsPanel.ts:214` の `NORM_PROPOSAL_SCAN_LIMIT = 200` を `limits.ts` の共有定数に吸収する。将来の乖離が必要になったら limits 内で分名する（再分散しない）。

## 現状と問題（file:line 付き）

- `src/background/researchReportGenerator.ts:38` ― `export const REPORT_MAX_RECORDS = 200`
- `src/dashboard/tagsPanel.ts:213-214` ― `NORM_PROPOSAL_SCAN_LIMIT = 200`（コメント「same cap as research report」は正しいが機械的に保証されない）
- `src/utils/limits.ts` ― 上限の正準置き場だが 200 系バッチ読込 cap が未収載（主スレッドが全件精読で確認）
- 呼び出し元実数: generator `:190` + tagsPanel `:217,:239`

## 変更の理由（DRY）

同じ理由（バッチ規模の調整）で同時に変わる関係であり、`limits.ts` の吸収規約に適合する。YAGNI フィルタ通過（乖離時の分名ルール付きのため過度な抽象化ではない）。

## 提案コード（骨子のみ）

```typescript
// src/utils/limits.ts
export const MAX_BATCH_READ_RECORDS = 200; // 名前は仮。両経路の据え置き値
// researchReportGenerator.ts:38 → import に置換（export 維持の要否は判断して記録）
// tagsPanel.ts:214 → import に置換
```

## 実装者向け注記

```bash
grep -rn "= 200" src/background/researchReportGenerator.ts src/dashboard/tagsPanel.ts
```

- 値が 200 以外に見えたら中断し、本 PBI に記録する（前提崩れ）
- 既存 export を残すかは呼び出し元を確認して決める

## Definition of Done

- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] 既存テスト全通過
- [ ] `npm run validate` 通過
- [ ] ドキュメント更新済み
