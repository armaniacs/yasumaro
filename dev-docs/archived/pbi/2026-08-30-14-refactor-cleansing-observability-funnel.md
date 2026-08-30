# PBI: クレンジングの観測性(ファネル/理由分解)を改善する

## ユーザーストーリー

上級ユーザーとして、クレンジングで「何が何件、なぜ除去されたか」を正確に知りたい。なぜなら現行 `cleansingStatsView` はバイト削減率のみで、`aiSummaryCleansedReason` は `removed` map の最大値1件に潰され、 `totalRemoved 1` で `reasons=['multiple']` としか表示されないから。

## 優先度

- 順位: 14 / 15
- RICE: Reach 8 / Impact 1 / Confidence 0.8 / Effort 2日 = 3.2
- 根拠: 上級者の調整の手がかりになるが、直接の要約品質向上ではない。`ExtractResult` と `cleansingStatsView` の表示改善で局所的。

## 背景

- 現行: `contentExtractor/index.ts` の `deriveCleansedReason` は `removed` map から最大削除数のルールを1件選び、 `aiSummaryCleansedReason: RuleKey | 'multiple' | 'none'` に潰す。`cleansingStatsView.ts` は `bytesBefore/After` から削減率を表示するのみ。
- 課題: 32ルールのうち何が何件除去されたかが分からない。ユーザーは「どのトグルをOFFにすべきか」判断できない。`removed` map 自体は `AiSummaryCleanseResult` に保持されているが、UIまで届いていない。
- 機会: `removed` map を `ExtractResult` に含め、ダッシュボードでルール別件数とバイト削減の分解表示を行う。`deriveCleansedReason` の `multiple` 潰しをやめ、 `reasons: RuleKey[]` を主表示にする。
- 追加見落とし: 当初の11案では観測性の欠落が「フィードバックループ(PBI-08)」で部分的にカバーされていたが、そもそも「現状の削除内訳が見えない」ことが独立した課題として見落とされていた。

## BDD 受け入れシナリオ

```gherkin
Scenario: ルール別の削除件数が表示される
  Given ページで ads:5件, nav:3件, popup:1件 が除去された
  When ダッシュボードのクレンジング統計を確認する
  Then ads:5, nav:3, popup:1 の内訳が表示される

Scenario: 理由が multiple に潰されない
  Given 3ルールで削除が発生した
  When ExtractResult を確認する
  Then aiSummaryCleansedReasons=['ads','nav','popup'] として3件とも保持される
  And aiSummaryCleansedReason は 'multiple' ではなく最多数のルール(例: 'ads')である

Scenario: バイト削減の分解が表示される
  Given cleansing 前 10000 bytes → 後 6000 bytes である
  When クレンジング統計を確認する
  Then 削減率40% と、ルール別の寄与度が表示される

Scenario: 削除0件の場合は「除去なし」と表示される
  Given クレンジングで削除0件だった
  When 履歴詳細を確認する
  Then 「クレンジングによる除去はありません」と表示される
```

## 受け入れ基準

- [ ] `ExtractResult` に `removedByRule: Record<RuleKey, number>` または `removed` map が含まれる(既存の `AiSummaryCleanseResult.removed` を流用)
- [ ] `deriveCleansedReason` が `multiple` に潰さず、 `reasons: RuleKey[]` を正しく生成する(既に `reasons` は存在するが、UIで使われていない)
- [ ] `cleansingStatsView.ts` または履歴詳細パネルでルール別の削除件数が表示される
- [ ] バイト削減率の分解表示(ルール別寄与度)が追加される(任意)
- [ ] `npm run validate` が通る

## テスト戦略

### E2E
- 手動: ダッシュボードでクレンジング統計の内訳表示を目視確認

### 統合
- `contentExtractor/index.test.ts` にルール別削除件数の統合テスト。複数ルールで削除が発生した場合に `removed` map が正しく保持される

### 単体
- `cleansedReason.test.ts` に `deriveCleansedReason` の単体テスト。複数ルール時の `reasons` 配列が正しく生成される
- `cleansingStatsView.test.ts` に内訳表示の単体テスト
- 境界: 削除0件 / 1ルールのみ / 32ルール全てで削除 / 同数で並んだ場合の `reason` 選択

## 実装アプローチ

- **Outside-In**: `contentExtractor/index.test.ts` にREDテスト( `removed` map が `ExtractResult` に含まれる) → `contentExtractor/index.ts` で `removed` を `ExtractResult` に含める → `cleansingStatsView.ts` で表示 → グリーン
- **段階移行**: Phase 1は `ExtractResult` に `removed` map を含め、ダッシュボードでテーブル表示。Phase 2でファネルチャートの分解表示。Phase 1の成功をPhase 2の前提とする

## 見積もり

2pt (型拡張0.5 + 表示1 + テスト0.5)

## 技術的考慮事項

- 依存: `ExtractResult` 型 / `contentExtractor/index.ts` / `cleansingStatsView.ts` / `aiSummaryCleaner/index.ts`
- テスタビリティ: `deriveCleansedReason` は純粋関数。jsdomで検証可能
- 非機能: `removed` map の保存によるストレージ増。32キー×数バイトで ~100バイト。問題なし
- i18n: ルール別の表示ラベルは `ruleLabels.ts` / `messages.json` に既存。流用可能

## 実装者向け注記

### 現状コードの確認
```bash
grep -n "deriveCleansedReason\|aiSummaryCleansedReason\|aiSummaryCleansedReasons" src/utils/contentExtractor/index.ts
cat src/utils/contentExtractor/cleansedReason.ts
cat src/dashboard/cleansingStatsView.ts | head -n 100
cat src/utils/aiSummaryCleaner/ruleLabels.ts | head -n 50
```

### 実装手順
1. `src/utils/contentExtractor/types.ts` の `ExtractResult` に `aiSummaryRemovedByRule?: Record<string, number>` を追加(または既存の `aiSummaryCleansedReasons` を活用)
2. `src/utils/contentExtractor/index.ts` で `runAiSummaryCleanse` の結果 `aiSummaryCleanseResult.removed` を `ExtractResult` に含める
3. `src/utils/contentExtractor/cleansedReason.ts` の `deriveCleansedReason` が `removed` map から `reasons` を正しく生成することを確認(既存実装は `totalRemoved` からの推定だが、 `removed` map を直接使う形に修正)
4. `src/dashboard/cleansingStatsView.ts` でルール別件数をテーブルまたはチャートで表示。`ruleLabels.ts` のラベルを使用
5. テスト: `contentExtractor/index.test.ts` / `cleansedReason.test.ts` に内訳テストを追加

### 落とし穴
- `ExtractResult` は `chrome.storage.local` / SQLite に保存される。`removed` map を追加すると既存データとの互換性に注意。`undefined` の場合は「データなし」と表示
- `deriveCleansedReason` は現行 `aiSummaryCleanseResult.totalRemoved` から推定しているが、 `removed` map を直接使う方が正確。 `removed` map のキーが `RuleKey` であることを型で保証すること
- `cleansingStatsView.ts` のファネルチャートは `bytesBefore/After` のみ。ルール別件数の分解は別コンポーネントとして追加する方が疎結合

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了
- [ ] リファクタリング完了
- [ ] ドキュメント更新済み
