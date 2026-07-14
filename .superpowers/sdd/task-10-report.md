# Task 10 Report: Refactor PrivacyPipeline to use AIService

**Commit**: `9db2d23` (base `ffc510b`)

## Changes Summary

### Core: `PrivacyPipeline` (`src/background/privacyPipeline.ts`)
- Removed `IAIClient` interface (was a temporary adapter for `AIClient`)
- Constructor now accepts `AIService` instead of `IAIClient`
- `process()`: `this.aiClient.generateSummary(text, tagSummaryMode, url)` → `this.aiService.generateSummary(text, { mode: 'full_pipeline', tagSummaryMode, url })`
- `_performLocalSummarization()`:
  - Removed `getLocalAvailability()` check (FallbackAIService handles local availability internally)
  - `this.aiClient.summarizeLocally(sanitized)` → `this.aiService.generateSummary(sanitized, { mode: 'local_only' })`
  - Simplified failure handling (no more `success` field on the result)
- `_processCloudResult()`: Stripped token/provider metadata fields (`sentTokens`, `receivedTokens`, `aiProvider`, `aiModel`) since `AIService.AISummaryResult` no longer carries them. These can be restored later by extending `AIService`.

### Interface: `LocalAIService` (`src/background/ai/LocalAIService.ts`)
- `LocalAIServiceConfig.localAiClient.summarizeLocally` → `summarize` (to match `LocalAIClient.summarize()`)
- Removed unused `getLocalAvailability` from config interface

### Pipeline Wiring
- `RecordingContext` (`src/background/pipeline/types.ts`): `aiClient?: AIClient | null` → `aiService?: AIService | null`
- `RecordingPipeline` (`src/background/pipeline/RecordingPipeline.ts`): stores `aiService: AIService | null`, passes to `context.aiService`
- `processPrivacyPipelineStep` (`src/background/pipeline/steps/processPrivacyPipelineStep.ts`): reads `context.aiService`, passes to `PrivacyPipeline`

### Service Wiring
- `recordingLogic.ts`: accepts `AIService` instead of `AIClient`, passes to `RecordingPipeline`
- `service-worker.ts`: constructs `FallbackAIService { local: LocalAIService, remote: RemoteAIService }`, passes to `RecordingLogic` and all `RecordingPipeline` instances
- `createBackgroundServices.ts`: same wiring as `service-worker.ts`
- `ServiceWorkerContext.ts`: added `aiService` to `ServiceWorkerDependencies`, falls back to `RemoteAIService` wrapping legacy `AIClient`

## Architecture Flow

```
service-worker.ts
  └─ FallbackAIService
       ├─ LocalAIService (→ LocalAIClient → Offscreen → window.ai)
       └─ RemoteAIService (→ AIClient → ProviderStrategy → Gemini/OpenAI/...)
  └─ RecordingLogic / RecordingPipeline / RecordingContext
       └─ .aiService (AIService)
            └─ PrivacyPipeline
                 ├─ .aiService.generateSummary(content, { mode: 'local_only' })
                 └─ .aiService.generateSummary(content, { mode: 'full_pipeline' })
```

## Test File Migration (Task 2.6 CRITICAL + MEDIUM follow-up)

**12 test files**: Replaced IAIClient-compatible mocks (`summarizeLocally`, `getLocalAvailability`, `success` field) with AIService-compatible mocks (`generateSummary` with mode options, `getSupportedModes`).

### Updated Files

| File | Mock Pattern Change |
|------|-------------------|
| `src/background/__tests__/privacyPipeline.test.ts` | All 8 inline mocks: removed `getLocalAvailability`/`summarizeLocally`; `generateSummary` now dispatches by `mode` option; assertions check `mode: 'local_only'` instead of `not.toHaveBeenCalled()` |
| `src/background/pipeline/__tests__/RecordingPipeline.test.ts` | `makeAiClient()` → returns AIService shape with `getSupportedModes` |
| `src/background/pipeline/__tests__/RecordingPipeline-r2.test.ts` | Same as above |
| `src/background/__tests__/recordingLogic.test.ts` | Top-level `mockAiClient`: removed old IAIClient properties |
| `src/background/__tests__/recordingLogic-impl.test.ts` | Both `makeMockAiClient()` and `makeAiClient()` updated |
| `src/background/__tests__/recordingLogic-coverage.test.ts` | `makeMockAiClient()` updated; property name `aiClient`→`aiService` in constructor test |
| `src/background/__tests__/recordingLogic-whitelist-bypass.test.ts` | `mockAIClient` mock updated |
| `src/background/__tests__/integration-recording.test.ts` | `mockAiClient` mock updated |
| `src/background/__tests__/robustness-data-integrity.test.ts` | `makeMockAiClient()` updated |
| `src/background/pipeline/steps/__tests__/processPrivacyPipelineStep.test.ts` | All `aiClient`→`aiService` in context and assertions; mock updated |
| `src/background/__tests__/aiClient.test.ts` | Removed obsolete `summarizeLocally`/`getLocalAvailability` test blocks (tested dead code paths) |
| `src/background/pipeline/mappers/__tests__/BrowsingLogRecordMapper.test.ts` | Removed stale field assertions (`aiProvider`, `aiModel`, `sentTokens`, `receivedTokens`) |
| `src/background/pipeline/steps/__tests__/saveMetadataStep.test.ts` | Removed assertions for `setUrlSentTokens`/`setUrlReceivedTokens` |

### PrivacyPipelineResult Cleanup (MEDIUM)

Removed stale fields from `PrivacyPipelineResult` (`src/background/privacyPipeline.ts:45-60`):
- `sentTokens`, `receivedTokens`, `aiProvider`, `aiModel`

Updated downstream consumers to use `null` for these fields (always `undefined` at runtime since PrivacyPipeline no longer sets them):
- `RecordingPipeline.ts` — SQLite record mapping: hardcoded to `null`
- `BrowsingLogRecordMapper.ts` — same
- `saveMetadataStep.ts` — removed dead code blocks that checked for these fields

### Test Results

```
Test Files  13 passed (13)
     Tests  209 passed | 8 skipped (217)
```

All 363 test files pass (2 pre-existing failures unrelated: version consistency, MarkdownBufferManager).

## Type-check
Passes with zero errors.
