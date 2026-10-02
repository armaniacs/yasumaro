# PBI: 洗剤スライダーの未結線 2 件と不活性な設定行を解消する

優先度: 28 / 種別: fix
backlog: [2026-10-01-00-backlog-holistic-1001.md](2026-10-01-00-backlog-holistic-1001.md)
発見: 2026-10-02 Wave 4（NN27）実装後の検証で判明
依存: NN27 の後続（NN27 は delta 経路の 1 か所化まで完了済み）

## ユーザーストーリー

AI 要約の洗浄設定を使うユーザーとして、画面にあるスライダーをすべて動かしたのに保存されないものが 2 つある状態を直してほしい、なぜならその 2 つは `change` イベントに書き込み束縛が無く、動かしても保存ボタンを押すまでストレージへ反映されないため、ユーザーは設定が反映されないまま閉じると操作を失うから。あわせて、HTML 要素が存在しないのに設定行として残っている 1 件も整理してほしい。

## 背景（2026-10-02 実測）

未結線の 2 件は実在する range input だが(delta 経路の表に無い:

- `entrypoints/options/index.html:1236` `<input type="range" id="ai-summary-cleansing-fallback-ratio" ...>`（表示値用の `:1234` あり）
- `entrypoints/options/index.html:1246` `<input type="range" id="ai-summary-cleansing-fallback-min-bytes" ...>`（表示値用の `:1244` あり）

NN27 後の書き込み束縛は `src/dashboard/settings/aiSummaryCleansingSettingsV2.ts` の `rangeConfigs`（7 行）だけに集約された。この 2 つは表に無いため、`input` の値ミラーも `change` の保存も**一切動かない**。`applyAiSummaryCleansingSettingsToUI` が設定値を読み込んで input に反映する経路は通るため、外観上は値 Thomson っているのに保存されない。

不活性な 1 件:

- `popup-body-protection-threshold` は `rangeConfigs` の行として存在するが、`entrypoints/options/index.html` に**対応する要素が存在しない**（grep で 0 件）。DOM がないため `document.getElementById` が null を返し、束縛されない。設定キーは `ai_summary_cleansing_body_protection_threshold` であり、`ai-summary-cleansing-body-protection-threshold` と 2 つの UI 要素が同じキーを共有する設計。

## BDD シナリオ

```gherkin
Scenario: 画面上のすべての Thomson-スライダーが保存される
  Given 画面上にあるすべての阈值スライダーを列挙する
  When 各スライダーを change する
  Then それぞれが 1 キーの delta-write を行う

Scenario: 存在しない設定行が表に残らない
  Given 要素が HTML に存在しない設定 id
  When 書き込み束縛の表を組み立てる
  Then その行は含まれない
```
## 実装宣言

- 挙動維持: 既存の 7 スライダーの delta 書き込みと、保存ボタンのフォーム全体書き込みは不変
- `fallback-ratio` と `fallback-min-bytes` に対応する**保存キーを確定したうえで** `rangeConfigs` に追加する。キーが存在しない場合は保存キーを新設せず、「保存ボタンでのみ保存される」旨を UI に明示する|alt案を記録する
- `popup-body-protection-threshold` の行は削除する。ただし `ai_summary_cleansing_body_protection_threshold` キーは `ai-summary-cleansing-body-protection-threshold` の UI が共有しているため、**キーの削除は行わない**

## 受け入れ基準

- [x] 画面上に存在するすべての閾値スライダーが `change` で 1 キーの delta-write を行う
- [x] 存在しない HTML 要素に対応する行が `rangeConfigs` から消える
- [x] 設定キー `ai_summary_cleansing_body_protection_threshold` は削除されない
- [x] 「画面上のスライダー数 = 束縛数」を検証するテストが存在する
- [x] 既存テストが green

## テスト戦略

- HTML に存在する閾値スライダーを列挙し、`rangeConfigs` の行と 1 対 1 で対応することを検証するテスト（将来スライダーを足したときの未結線の再発を機械的に防ぐ）
- `fallback-ratio` / `fallback-min-bytes` それぞれの `change` が 1 キーの delta-write を行うことを固定する
- 検証: `npx tsc --noEmit` と `src/dashboard/settings/__tests__/` 配下の vitest

## 実装内容

1. `fallback-ratio` と `fallback-min-bytes` の保存キーを特定し、`rangeConfigs` に追加する（キーが存在しない場合はその旨を記録し UI 明示にフォールバックする）
2. `popup-body-protection-threshold` の行を削除する
3. 「画面上のスライダー数 = 束縛数」の検証テストを追加する

## Definition of Done

- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [x] type-check / lint / test が通る
- [ ] コードレビュー完了

## 実装記録（2026-10-02）

### 変更内容

- 未結線だった 2 スライダーを delta テーブルに追加し、いずれもスキップしていない:
  - `AI_SUMMARY_CLEANSING_FALLBACK_RATIO` — 保存値は 0..1 の分数で、UI はパーセント（5..50）表示のため、行の `divisor: 100` が必要。この reason を why コメントとして残した
  - `AI_SUMMARY_CLEANSING_FALLBACK_MIN_BYTES` — 保存値と UI 単位が一致
  - いずれも 4 つの独立した箇所（保存ボタンからの読み出し・統計ビュー・AI クライアント・復元系）で使用箇所を確認済み
- 不活性だった `popup-body-protection-threshold` の行を削除。共有設定キー `ai_summary_cleansing_body_protection_threshold` は `ai-summary-cleansing-body-protection-threshold` の UI が使っているため**削除していない**（`StorageKeys` に残ることをテストで固定）

### 追加テスト

- 新規 `src/dashboard/settings/__tests__/aiSummaryCleansingThresholdRanges.test.ts`
  - `node:fs` で `entrypoints/options/index.html` を直接読む
  - `panel-ai-summary-cleansing` セクションにスコープしてスライダーを列挙する
  - 双方向を検証する: 画面上にスライダーがあるのに束縛表に行がない（未結線）、表に行があるのに画面上にスライダーがない（不活性行）
  - id の重複がないこと、行ごとに表示要素があることも検証する
- mutation 検証: 修正前の状態に戻すと 5 アサーション中 3 つが落ちる

### 検証

`npx tsc --noEmit` / `npm run lint`（error 0）/ `npm test`（999 files, 15367 tests passed）/ `npm run validate` すべて green。
