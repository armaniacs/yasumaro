# PBI: RecordingOrchestrator deepening — triple-mode 分離と typed Context / RetryPolicy 抽出

## ユーザーストーリー
記録パイプラインを保守する開発者として、`RecordingOrchestrator.record(data, opts)` に同居する 3つの pipeline（normal / preview / retryObsidian）と untyped Context / heuristic offline 判定を deep な module にしたい、なぜなら現在は 1メソッド内で `mode` 分岐し retry は 13-step table を迂回して inline で 2 step を手組みし、`RecordingContext` は 7 union で順序違反が型で落ちず、offline 判定が `msg.toLowerCase().includes('ai ')` の文字列 heuristic に依存しているためバグが orchestration 層に隠れるから

## 優先度
- 順位: 03 / 07
- RICEスコア: **186**（Reach=80 / Impact=2 / Confidence=0.7 / Effort=0.6）
- 根拠: 記録は全ユーザーの core flow（Reach 80）。Impact 2 は normal/preview/retry の分岐バグが silent data loss / duplicate entry / offline queue 誤載につながるため。PBI 01（storage 原子性）に依存 — 01 完了後に mutex スコープと offline heuristic を安全に修正できる。Effort 0.6人週は 3 entry point 分離＋typed Context＋RetryPolicy 抽出の設計変更を含む。

## 背景 / なぜなぜ分析サマリ
| 疑問 | 原因 → 示唆 → 解 |
|------|------------------|
| なぜ 1 seam に3 pipeline が隠れる？ | `record(data, { mode })` が `if (mode==='retryObsidian') { format+save inline }` と `mode==='preview' ? previewBreakpoint : full` の2つの隠れ分岐を持つ → distinct entry points `record()` / `preview()` / `retryObsidianWrite()` に分離し各 mode が construction 時に step subset を compile |
| なぜ Context が untyped か？ | `RecordingContext = PipelineInput & CheckResults & PrivacyResults & ...` の7 union で step が読む slice は JSDoc のみ、実行順違反が runtime の `undefined` になる → builder / typed state threading（例: `Result<Ctx,Err>`）で out-of-order read を型エラーに |
| なぜ StepDeps が leaky か？ | `StepDeps` は partial で `saveSqliteStep` が `?? this.sqliteClient` fallback を持つ → deps を construction 時に固定し fallback を削除 |
| なぜ offline 判定が heuristic か？ | `StepExecutor.isNetworkError` が `msg.includes('ai ')` の文字列マッチで offline queue 載載を判定 → `RetryPolicy` オブジェクトに抽出し executor は判定を持たない、policy は unit test 可能に |

## BDD受け入れシナリオ

### Scenario: normal / preview / retry が distinct entry point で実行される
  Given `RecordingOrchestrator` が 3つの entry point `record()` / `preview()` / `retryObsidianWrite(job)` を持つ
  When `record(data)` が呼ばれる
  Then 13 step の full pipeline が実行される
  When `preview(data)` が呼ばれる
  Then `privacyPipeline` step の `previewBreakpoint` で short-circuit し `result` が返る
  When `retryObsidianWrite({ title, url, summary, tags })` が呼ばれる
  Then `formatMarkdown` + `saveToObsidian` の2 step のみが実行され、AI 再実行なしで Obsidian 追記がリトライされる

### Scenario: retry が 13-step table を迂回しない
  Given `retryObsidianWrite` が construction 時に compile された 2-step subset を持つ
  When retry が呼ばれる
  Then `RecordingOrchestrator.steps` の 13 要素は触れられず、retry 専用の step list が使われる（`record` 内の inline `formatMarkdownStep + saveToObsidianStep` が存在しない）

### Scenario: Context の out-of-order read が型エラーになる
  Given typed Context builder が step の入出力 slice を型で縛る
  When `formatMarkdownStep` より前に `markdown` を読む step を誤って配置する
  Then TypeScript コンパイルエラーになる（runtime の `undefined` ではなく）

### Scenario: offline 判定が RetryPolicy で一元化される
  Given `RetryPolicy` が `isNetworkError` と `shouldEnqueue(jobKind)` を own する
  When `StepExecutor` が step 失敗時に `RetryPolicy` に委譲する
  Then `msg.toLowerCase().includes('ai ')` の heuristic が StepExecutor に存在せず、policy の unit test で offline 載載の分岐が検証される

### Scenario: PerUrlMutex スコープが mode ごとに一貫する
  Given 全 mode が同一の `PerUrlMutexMap` singleton を共有する
  When 同一 URL に対して `record` と `retryObsidianWrite` が並行に呼ばれる
  Then 両方が `runExclusive(url, ...)` で直列化され duplicate-entry race が起きない

## 受け入れ基準
- [x] `RecordingOrchestrator` が `record()` / `preview()` / `retryObsidianWrite()` の3つの distinct entry point を持ち、`record(data, { mode })` の `mode` 分岐が削除されている（`RecordMode` 型も削除または internal 化）
- [x] `retryObsidian` の inline 2-step path（`formatMarkdownStep + saveToObsidianStep`）が `record` メソッド内に存在せず、construction 時に compile された step subset として表現されている
- [x] `RecordingContext` が typed builder / state threading で置換され、`src/background/pipeline/types.ts` の 7 union が解消または step ごとの入出力型で縛られている
- [x] `StepExecutor.isNetworkError` の文字列 heuristic が削除され、`RetryPolicy`（または同等の policy オブジェクト）に抽出されている
- [x] `StepDeps` の `?? this.sqliteClient` fallback が削除され、deps は construction 時に固定される
- [x] 既存の `RecordingOrchestrator` / `PipelineKernel` / `stepExecutor` テストが新 seam 経由で green、`npm run validate` green

## テスト戦略
- 単体: 各 entry point（normal / preview / retry）の step subset が正しいことを assertion（step 名の配列比較）
- 単体: typed Context の out-of-order read がコンパイルエラーになることを `tsc` 期待テスト（`@ts-expect-error`）で検証
- 単体: `RetryPolicy` の `isNetworkError` / `shouldEnqueue` の分岐を network なしで unit test（heuristic 文字列の positive/negative ケース）
- 統合: `PerUrlMutexMap` 共有の直列化を並行呼び出しテストで検証（同一 URL の record + retry が直列化される）
- 回帰: 既存の pipeline 13 step テストを新 entry point 経由で実行し green

## 見積もり
3 pt（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] `record(data, { mode: 'retryObsidian' })` の inline path がコードベースに存在しない（`grep` で確認）
- [x] コードレビュー完了
- [x] ドキュメント更新済み（`dev-docs/DESIGN_SPECIFICATIONS.md` §8.3 RecordingOrchestrator 節を 3 entry point 前提に更新）
- [x] `npm run validate` green

## 実装メモ（任意）
- `RecordOptions.previewOnly` / `RecordMode` の削除は破壊的変更のため、`recordingHandlers.ts` の `execute` 呼び出しも新 entry point に移行すること。
- `PipelineKernel` の `previewBreakpoint` は `preview()` の step subset に含める形で表現し、kernel は breakpoint を知らない設計も検討。
