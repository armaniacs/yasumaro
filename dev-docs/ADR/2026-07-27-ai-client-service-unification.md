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
| `src/background/reviewSummaryGenerator.ts` | `new AIClient()` を直接生成して週次/月次ダイジェストを作成（2026-08-11 に解消。追記参照） |
| `src/background/service-worker.ts` | トップレベルで `AIClient` を生成し `FallbackAIService` を構成 |

### グループB: `AIService` 型のみを import（ビジネスロジック層、6ファイル）

全て `import type { AIService } from './ai/AIService.js'` のみ。実体を知らない。

- `src/background/pipeline/steps/processPrivacyPipelineStep.ts`
- `src/background/pipeline/RecordingPipeline.ts`
- `src/background/handlers/messageHandlers.ts`
- `src/background/pipeline/types.ts`
- `src/background/privacyPipeline.ts`
- `src/background/recordingLogic.ts`

### グループC: `aiClient.ts` から表示用の定数・型のみ import（3ファイル）

- `src/dashboard/dashboard.ts`：`PROVIDER_LABELS`, `MultiProviderTestResult`
- `src/dashboard/panels/diagnostic/diagnosticsPanel.ts`：`PROVIDER_LABELS`
- `src/dashboard/aiTestResultView.ts`：`PROVIDER_LABELS`（2026-08-08 追記。接続テスト結果の表示整形を共通化した際に追加）

これらは Strategy の実装詳細ではなく単なる定数・型のため、`aiClient.ts` から読み込み続けて問題ない。

## 影響範囲

- **グループA（4ファイル）**: 配線コードは維持。`AIClient` は `RemoteAIService` / `FallbackAIService` の内部実装として引き続き必要。
- **グループB（6ファイル）**: 既に `AIService` 型のみに依存しており、変更不要。
- **グループC（2ファイル）**: 表示用定数・型のみの import のため、変更不要。

## 追記（2026-08-11）: `reviewSummaryGenerator.ts` の移行完了

当初の例外事項はアーキテクチャ深深化PBI 子PBI 5（`2026-08-11-06-migrate-review-summary-to-ai-service.md`）で解消した。本節が当初記述した「移行を見送り、正当な例外として明記する」状態は**過去の記録**であり、現在は移行済みである。

- `reviewSummaryGenerator.ts` は `AIClient` を import せず、`AIService` 型のみに依存する。`new AIClient()` は存在しない。
- 週次/月次サマリ生成器は `createReviewSummaryGenerator({ aiService, sqliteClient })` ファクトリで組み立てる。インスタンスは composition root（`createBackgroundServices.ts`）で1度だけ生成され、alarm（`reviewSummaryAlarm.ts`）と `GENERATE_REVIEW_SUMMARY` message handler が同一インスタンスを共有する。
- provider 選択・token policy は既存の `createAIService` composition に従い、summary 出力・prompt・fallback・sanitization・`chrome.downloads` 挙動は変更しない。
- テストは実際の `AIClient` を生成せず、AIService fake を注入して検証する。
- AI 用途の offscreen document 所有権は本追記時点の調査で「AIService は offscreen 非依存」（詳細は `2026-07-13-architecture-phase2-deep-dig.md` 追記参照）。`OffscreenManager` 相当は新設しない。

## 追記（2026-08-08）: `AIService.testConnection` の追加

本ADRは「`aiClient.ts` への新規の直接依存は原則禁止」と定めたが、**この方針は構造的に守れない状態だった**。

`AIService` インターフェースには `generateSummary` と `getSupportedModes` しか無く、**接続テストの入口が存在しなかった**。そのため `service-worker.ts` は接続テストだけ抽象を迂回して `aiClient` を直接参照せざるを得なかった。

```typescript
// 修正前 — 要約は aiService、接続テストは aiClient と2経路に分かれていた
testAi: () => aiClient.testConnection(),
testConnection: (onProgress, runId) => aiClient.testConnection(onProgress, runId),
```

これは呼び出し側の規律の問題ではなく**抽象の欠落**である。実際、2経路が独立して育った結果、Gemini の thinking トークンバグ（commit `69c90c0`）は接続テストと本番要約の両方に別々の修正を要した。

### 決定

`AIService` に `testConnection(onProgress?, runId?)` を追加し、3実装すべてに実装した。

| 実装 | 振る舞い |
|---|---|
| `RemoteAIService` | `aiClient.testConnection` へ委譲 |
| `LocalAIService` | オンデバイスモデルの availability を返す（到達先が無いため「接続」= モデル利用可否） |
| `FallbackAIService` | remote へ委譲（接続テストUIはリモート設定の検証が目的） |

これにより `service-worker.ts` の `aiClient` 参照は**インスタンス生成のみ**（グループAの配線用途）に限定され、ADR の意図が型で担保されるようになった。

### 同時に修正した実バグ

`RemoteAIService.generateSummary` が `success` / `error` を転送していなかった。`FallbackAIService` の `auto` 分岐は `localResult.success === false` で判定するため、remote 結果は常に `success: undefined` として読まれていた（`undefined === false` は `false`）。転送するよう修正済み。

## 今後の方針

- 新しいAIプロバイダー統合やAI機能追加は、`AIService` インターフェースの拡張を通じて行う。
- `aiClient.ts` への新規の直接依存（グループAへの追加）は原則禁止する。
- `AIClient` クラスには「新規コードからの直接利用は避けること」の JSDoc コメントを追加する（本ADR作成と同時に実施）。
- `reviewSummaryGenerator.ts` の移行は、2026-08-11 の子PBI 5で完了した（追記参照）。

## 備考

本決定に基づき、`AIClient` クラス全体を `@deprecated` とすることは誤り。`AIClient` は現役の内部実装であり、`RemoteAIService` が内部で使用し続ける。非推奨化すべきなのは「グループA以外からの新規直接利用」というパターンであり、コード上では JSDoc コメントとコードレビューで担保する。
