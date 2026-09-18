# PBI: 週次/月次レビューサマリー生成の期間ロジック統合（refactor）

優先度: 台帳 RICE 2.5（Reach 2 / Impact 1 / Confidence 0.5 / Effort 0.4pt）
backlog: [2026-09-15-00-backlog-archloop-0915b.md](2026-09-15-00-backlog-archloop-0915b.md)（台帳、候補6）
依存: なし

## ユーザーストーリー

拡張機能を保守する開発者として、週次・月次レビューサマリーの生成ロジックを1箇所に統合してほしい、なぜなら現在は同一構造のロジックが2関数に重複しており、修正のたびに2箇所を同期させる必要があって見落としのリスクがあるから。

## 背景（現状と課題）

`src/background/reviewSummaryGenerator.ts` の `createReviewSummaryGenerator()` が返す `generateWeeklySummary`（200-272行目）と `generateMonthlySummary`（274-344行目）は、以下の同一構造を持つ：

1. `repo.getAll()` → `REVIEW_SUMMARY_ENABLED` チェック（205-208行目 / 279-282行目）
2. 期間キー算出＋重複生成防止チェック（`REVIEW_SUMMARY_LAST_GENERATED_WEEK` / `_MONTH`、216-220行目 / 288-292行目）
3. `sqliteClient.query()` で期間内エントリ取得、`success` 判定（223-233行目 / 295-305行目、ほぼ同一コード）
4. `summaries` 結合 → `aiService.generateSummary()` でダイジェスト生成（236-249行目 / 308-321行目、プロンプト文言のみ相違）
5. `generateReviewMarkdown()` → `downloadMarkdown()` → 成功時に `chrome.storage.local.set` で最終生成キー保存（251-268行目 / 323-340行目）

差異は期間計算関数（`getWeekPeriod`/`getMonthPeriod`、`getISOWeekNumber`/`getISOWeekYear`）とラベル文字列のみ。実際に `sqliteClient.query` 呼び出し部分のインデントずれ（222-223行目 / 294-295行目）があり、コピペ由来の保守劣化の痕跡が見える。Mutex も `weeklyMutex` / `monthlyMutex`（197-198行目）と別インスタンスで持つ。

対応方針: `period: { kind: 'week' | 'month', label, start, end, storageKey, lastGeneratedKey }` を組み立てる strategy 関数（`buildWeekPeriod` / `buildMonthPeriod`）を用意し、共通の `generatePeriodSummary(period, mutex)` に本体ロジックを一本化する。Mutex は週次・月次で別インスタンスのまま呼び出し側から渡す（対象データの独立性を保つため統合しない）。

対象外: `generateReviewMarkdown` / `downloadMarkdown` / `aiService.generateSummary` 自体の実装変更は行わない。プロンプト文言・出力Markdownの内容は変えない。

## BDD受け入れシナリオ

```gherkin
Scenario: 週次サマリー生成が統合後も現行と同一の出力を生成する
  Given REVIEW_SUMMARY_ENABLED が有効で、今週分の未生成エントリが存在する
  When generatePeriodSummary(weekPeriod, weeklyMutex) を呼び出す
  Then 統合前の generateWeeklySummary と同一のMarkdown・同一のstorageキー（REVIEW_SUMMARY_LAST_GENERATED_WEEK）で保存される

Scenario: 境界 — 同一期間の重複生成が防止される
  Given 直近の REVIEW_SUMMARY_LAST_GENERATED_WEEK が今週のキーと一致している
  When generatePeriodSummary(weekPeriod, weeklyMutex) を呼び出す
  Then サマリーは再生成されず、既存の重複防止チェックと同じ結果になる
```

## 受け入れ基準

- [x] `period` 型（`kind` / `label` / `start` / `end` / `storageKey` / `lastGeneratedKey`）が定義されている
- [x] `buildWeekPeriod()` / `buildMonthPeriod()` が現行の期間計算関数（`getWeekPeriod`/`getMonthPeriod` 等）から `period` を組み立てる
- [x] `generatePeriodSummary(period, mutex)` に本体ロジックが一本化され、`generateWeeklySummary` / `generateMonthlySummary` はこれを呼ぶ薄いラッパーになっている
- [x] 週次・月次それぞれの生成結果（Markdown・storageキー）が統合前と byte-identical
- [x] `weeklyMutex` / `monthlyMutex` は別インスタンスのまま維持されている
- [x] `npm run type-check` / `npm test` が green

## テスト戦略

- 既存テストの維持: `reviewSummaryGenerator.test.ts`・`reviewSummaryGenerator-extra.test.ts`・`reviewSummaryGenerator-concurrency.test.ts`・`reviewSummaryAlarm.test.ts` が無修正のままパスすることで動作不変を確認する（期待値を変えずに通ることが parity の証明）。
- 単体テスト（新規）: `buildWeekPeriod` / `buildMonthPeriod` が正しい `period` オブジェクトを組み立てることを検証する（境界: 年またぎの週・月）。

## 見積もり

1 pt（小規模統合。2関数→1関数+2 strategy 関数、既存テストは無修正でパス想定）。

## 実装ガイド

- 着手時点での確認ポイント: `src/background/reviewSummaryGenerator.ts:197-344`、呼び出し元 `src/background/reviewSummaryAlarm.ts`、`src/dashboard/reviewSummaryHandler.ts`（`GENERATE_REVIEW_SUMMARY` メッセージ経由で同一インスタンスを共有）。
- インデントずれ（222-223行目 / 294-295行目）は統合の過程で自然に解消される想定だが、意図的な差分ではなくコピペ痕跡であることを実装前に確認すること。
- Mutex 統合（単一化）は本 PBI のスコープ外。週次・月次は独立したデータ範囲であり分離のままで良いという台帳の判断を踏襲する。
