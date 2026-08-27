# ADR: Pipeline Offline Guard — isNetworkError

## ステータス
採用

## 日付
2026-08-27

## コンテキスト
PBI-13A の Phase A-0 で `StepExecutor` の `offlineRetry` がエラー種別を問わず `enqueue` することが判明した。

- `stepExecutor.ts:40-42` は `offlineRetry` があれば `DOMAIN_BLOCKED`/`PERMISSION_REQUIRED` 等の論理エラーまで `offlineNetworkQueue` (TTL 7日, 50KB cap) に載せる。
- `extractSentencesStep.ts:120-143` は `RETRY` + `offlineRetry:'ai_summary'` だが内部で `BEST_EFFORT` にフォールバックし `throw` しないため `StepExecutor` の `enqueue` が発火せずメタデータが嘘になる。

## 決定
- `stepExecutor.ts` に `isNetworkError(error)` ガードを追加し、`offlineRetry` があっても `isNetworkError(error) === true` の場合のみ `enqueue` する。
- `extractSentencesStep` の `ErrorStrategy` を `RETRY` から `BEST_EFFORT` に正し、`offlineRetry:'ai_summary'` のメタデータを `BEST_EFFORT` に修正。`StepExecutor` の `offlineRetry` は発火しないが、内部フォールバックで `original content` を返す現行が正しい。
- `isNetworkError` は `error.message` の `network/fetch/timeout/offline/econnrefused/enotfound` と `error.cause` の再帰で判定する。

## 結果
- 論理エラーが 7日 TTL の queue に載る肥大化を防止。
- `extractSentences` の `BEST_EFFORT` としての振る舞いがメタデータと一致し、`StepExecutor` の `RETRY` による再試行と `offlineRetry` の二重 `catch` 階層が解消される。

## 参照
- `src/background/pipeline/stepExecutor.ts:6-42`
- `src/background/pipeline/steps/extractSentencesStep.ts:120-143`
- PBI-13: `pbi/2026-08-27-13-feat-consolidate-recording-pipeline.md`
