# ADR: AIClientとAIServiceの統一方針

**作成日**: 2026-07-27  
**ステータス**: 承認済み  
**関連PBI**: [2026-07-26-26-refactor-ai-client-service-unification](../../pbi/2026-07-26-26-refactor-ai-client-service-unification.md)（完了時は [dev-docs/archived/pbi/](../../archived/pbi/) 参照）

## コンテキスト

Checking Team レビュー（`plans/2026-07-23-1038-review-fix-0723.md`）で、`src/background/aiClient.ts` と `src/background/ai/AIService.ts` の二重抽象化が指摘された。調査の結果、両者が単に並立しているのではなく、**`AIService` が `AIClient` をラップするアダプター構造**が既に確立されていることが判明した。

- `RemoteAIService` は内部で `AIClient` インスタンスを保持し、リモートAIプロバイダーへの要約処理を委譲する。
- `LocalAIService` はローカルAI（Ollama等）を使う実装。
- `FallbackAIService` は `LocalAIService` + `RemoteAIService` を束ねる。
- `AIClient` 側にのみ Strategy パターン（`GeminiProvider`, `OpenAIProvider`, `ProviderStrategy`）が存在し、`AIService` 側は「`AIClient` に委譲するか、ローカル要約するか」の分岐のみを行う。

## 決定

**`AIService` に統一する。`AIClient` は Provider ロジック（Gemini/OpenAI Strategy 実装）の内部実装として温存し、新規の呼び出し元は `AIService` 経由でのみ AI 機能にアクセスする。**

## 呼び出し元の現状分類

調査時点（2026-07-27）で `aiClient.ts` / `ai/AIService.ts` を import する全ファイルを分類した。

### グループA: `AIClient` を実体として import（インスタンス化・配線コード、4ファイル）

| ファイル | 用途 |
|---|---|
| `src/background/ServiceWorkerContext.ts` | `AIClient` の遅延初期化と `RemoteAIService` への配線 |
| `src/background/createBackgroundServices.ts` | `AIClient` を生成し `FallbackAIService` を構成 |
| `src/background/reviewSummaryGenerator.ts` | `new AIClient()` を直接生成して週次/月次ダイジェストを作成 |
| `src/background/service-worker.ts` | トップレベルで `AIClient` を生成し `FallbackAIService` を構成 |

### グループB: `AIService` 型のみを import（ビジネスロジック層、6ファイル）

全て `import type { AIService } from './ai/AIService.js'` のみ。実体を知らない。

- `src/background/pipeline/steps/processPrivacyPipelineStep.ts`
- `src/background/pipeline/RecordingPipeline.ts`
- `src/background/handlers/messageHandlers.ts`
- `src/background/pipeline/types.ts`
- `src/background/privacyPipeline.ts`
- `src/background/recordingLogic.ts`

### グループC: `aiClient.ts` から表示用の定数・型のみ import（2ファイル）

- `src/dashboard/dashboard.ts`：`PROVIDER_LABELS`, `MultiProviderTestResult`
- `src/dashboard/panels/diagnostic/diagnosticsPanel.ts`：`PROVIDER_LABELS`

これらは Strategy の実装詳細ではなく単なる定数・型のため、`aiClient.ts` から読み込み続けて問題ない。

## 影響範囲

- **グループA（4ファイル）**: 配線コードは維持。`AIClient` は `RemoteAIService` / `FallbackAIService` の内部実装として引き続き必要。
- **グループB（6ファイル）**: 既に `AIService` 型のみに依存しており、変更不要。
- **グループC（2ファイル）**: 表示用定数・型のみの import のため、変更不要。

## 例外事項: `reviewSummaryGenerator.ts`

`src/background/reviewSummaryGenerator.ts` は `generateWeeklySummary` / `generateMonthlySummary` 内で `new AIClient()` を直接生成している。`AIService.generateSummary(content, options?)` のシグネチャは `AIClient.generateSummary(content)` と互換ではあるが、以下の理由により本PBIでは移行を見送り、正当な例外として明記する。

1. **依存注入の変更範囲が広い**: 週次/月次サマリ生成関数は `service-worker.ts` のメッセージハンドラ、`reviewSummaryAlarm.ts` のアラームハンドラ、`dashboard` 側のUIイベントから呼ばれている。`AIService` インスタンスを注入するには、これら全ての呼び出し経路を変更する必要がある。
2. **独立した背景ジョブである**: 週次/月次サマリは Service Worker 起動時に初期化される `aiService` とは独立したタイミングで実行される背景処理であり、自前の `AIClient` を生成しても副作用は小さい。
3. **回帰リスクが大きい**: テストで `AIClient` をモックしている箇所が多く、移行には広範なテスト更新が必要となる。

**今後の方針**: `reviewSummaryGenerator.ts` の `AIClient` 直接利用を解消する場合は、別PBIとして `AIService` インスタンスの注入経路を設計・実装する。

## 今後の方針

- 新しいAIプロバイダー統合やAI機能追加は、`AIService` インターフェースの拡張を通じて行う。
- `aiClient.ts` への新規の直接依存（グループAへの追加）は原則禁止する。
- `AIClient` クラスには「新規コードからの直接利用は避けること」の JSDoc コメントを追加する（本ADR作成と同時に実施）。
- `reviewSummaryGenerator.ts` の移行は、将来の別PBIで検討する。

## 備考

本決定に基づき、`AIClient` クラス全体を `@deprecated` とすることは誤り。`AIClient` は現役の内部実装であり、`RemoteAIService` が内部で使用し続ける。非推奨化すべきなのは「グループA以外からの新規直接利用」というパターンであり、コード上では JSDoc コメントとコードレビューで担保する。
