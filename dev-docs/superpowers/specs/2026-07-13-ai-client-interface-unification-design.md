# C3: AI Client Interface Unification — Design Spec

**Date:** 2026-07-13
**Scope:** Decide offscreen document lifecycle ownership, then unify three AI client interface shapes into one `AIService` interface. Delete dead `IAIClient`.

## Motivation

Three incompatible AI interface shapes exist: `AIProviderStrategy` (abstract class for remote), `PrivacyPipeline.IAIClient` (inline, with `summarizeLocally`), and a dead `IAIClient` in `interfaces/index.ts` (0 imports). The 5-Why deep-dig identified the root cause as **no decision on who owns the offscreen document lifecycle** — `PrivacyPipeline` manages it because `AIClient` was designed before local AI existed.

## Decision: Offscreen Lifecycle Ownership

**AIService owns the offscreen document lifecycle.** Rationale:
- Local AI is an implementation detail of "calling an AI model" — callers shouldn't care whether the model runs in-process, in an offscreen document, or on a remote server.
- Single-unit E2E tests (Playwright) cover the local AI path; AIService unit tests focus on remote strategy switching.
- Splitting into `OffscreenManager` + `AIService` adds composition complexity for no concrete benefit today (YAGNI).

## New Interface

```typescript
// src/background/ai/AIService.ts

type AISummaryMode = 'full_pipeline' | 'local_only' | 'masked_cloud' | 'auto';

interface AIService {
  /** Generate a summary. Mode determines execution path. */
  generateSummary(
    content: string,
    options?: AISummaryOptions
  ): Promise<AISummaryResult>;
}

interface AISummaryOptions {
  mode?: AISummaryMode;       // default: 'full_pipeline'
  tagSummaryMode?: boolean;
  url?: string;
}

/** Maps to the existing AISummaryResult shape used by the pipeline. */
interface AISummaryResult {
  summary: string;
  tags?: string[];
  // ... existing fields preserved from current implementation
}
```

### Implementations

| Class | Mode | Wraps | Offscreen Management |
|-------|------|-------|---------------------|
| `RemoteAIService` | `full_pipeline` | Existing `AIClient` + `AIProviderStrategy` | None |
| `LocalAIService` | `local_only` | Existing `localAiClient.ts` | Owns `chrome.offscreen` lifecycle |
| `FallbackAIService` | `auto` | Composes Remote + Local | Delegates to LocalAIService |

`FallbackAIService` tries local first; if `getLocalAvailability()` returns unavailable, falls back to remote. This replaces the current pattern where `PrivacyPipeline` checks availability itself.

### What Gets Deleted

| File / Location | Reason |
|----------------|--------|
| `src/background/interfaces/index.ts` (entire file) | 207 lines, 7 interfaces, 0 imports. Dead code. |
| `PrivacyPipeline` inline `IAIClient` interface | Replaced by `AIService` |
| `PrivacyPipeline.context.aiClient.summarizeLocally()` direct call | Absorbed into `AIService.generateSummary(content, { mode: 'local_only' })` |
| `PrivacyPipeline` local availability check | Absorbed into `FallbackAIService` |

### What Changes

| File | Change |
|------|--------|
| `src/background/ai/AIService.ts` | New: interface + mode types |
| `src/background/ai/RemoteAIService.ts` | New: wraps existing `AIClient` |
| `src/background/ai/LocalAIService.ts` | New: wraps `localAiClient.ts`, owns offscreen lifecycle |
| `src/background/ai/FallbackAIService.ts` | New: composes local + remote |
| `src/background/pipeline/PrivacyPipeline.ts` | Accept `AIService` instead of `context.aiClient` with two shapes |
| `src/background/service-worker.ts` | Construct `FallbackAIService` at composition time |
| `src/background/aiClient.ts` | Deprecated; logic moves to `RemoteAIService` |
| `src/background/localAiClient.ts` | Deprecated; logic moves to `LocalAIService` |

### File Structure

```
src/background/ai/
├── AIService.ts              # interface + AISummaryMode + AISummaryOptions
├── RemoteAIService.ts        # wraps AIClient/provider strategy
├── LocalAIService.ts         # wraps localAiClient, owns offscreen
├── FallbackAIService.ts      # local → remote fallback chain
├── providers/
│   └── ProviderStrategy.ts   # unchanged
├── aiClient.ts               # [deprecated] removed after migration
└── localAiClient.ts          # [deprecated] removed after migration
```

### Tests

- **Unit**: `RemoteAIService` delegates to mock `AIProviderStrategy`
- **Unit**: `FallbackAIService` fallback chain: local available → uses local, local unavailable → uses remote
- **Unit**: `FallbackAIService` error propagation (both fail)
- **E2E**: Full recording flow with `local_only` mode
- **E2E**: Full recording flow with `auto` mode (local available → uses local)

### Risks

- **LocalAIService + chrome.offscreen = untestable in Jest**: Accepted. E2E covers this path. This is consistent with how other chrome API-dependent modules are tested.
- **Dead interface removal might uncover hidden imports**: `grep` confirmed 0 imports of `interfaces/index.ts`. Safe to delete.
