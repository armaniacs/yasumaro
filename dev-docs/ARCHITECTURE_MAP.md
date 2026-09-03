# Architecture Map

> Component layout and feature-location map for the extension. Referenced from [AGENTS.md](../AGENTS.md). Deep design decisions live in [DESIGN_SPECIFICATIONS.md](DESIGN_SPECIFICATIONS.md) and [ADR/](ADR/).

## Component Tree

```
Service Worker (entrypoints/background/ + src/background/)
  ├── index.ts → WXT entrypoint
  ├── ObsidianClient → Obsidian Local REST API
  ├── AIClient (multiple implementations) → AI Providers
  ├── localAiClient → Local AI provider (Ollama, etc.)
  ├── sessionAlarmsManager → Session timeout management
  ├── Mutex / ServiceWorkerContext → Concurrency management
  ├── recordingLogic → Core recording orchestration
  └── service-worker.ts → Service worker lifecycle

Popup UI (entrypoints/popup/ + src/popup/)
  ├── index.html / main.ts → WXT entrypoints
  ├── navigation.ts → Tab management
  ├── domainFilter.ts → Domain filter settings
  ├── main.ts → Core popup logic
  ├── ublockImport/ → uBlock filter import functionality
  ├── settings/ → Settings management
  └── utils/ → Shared utilities (focusTrap, i18n, etc.)

Dashboard / Options (entrypoints/options/ + src/dashboard/)
  ├── index.html → Settings configuration interface (WXT entrypoint)
  ├── main.ts → Dashboard entrypoint
  └── src/dashboard/ → Dashboard logic modules

Offscreen (entrypoints/offscreen.html + src/offscreen/)
  ├── offscreen.html → WXT entrypoint
  └── src/offscreen/offscreen.ts → DOM operations requiring offscreen document

Content Scripts (entrypoints/content/ + src/content/)
  ├── index.ts → WXT content script entrypoint
  ├── loader.ts → Injection orchestrator
  └── extractor.ts → DOM content extraction
```

## Where to Add New Features

| Feature Type | Location | Notes |
|--------------|----------|-------|
| UI features | `src/popup/` (HTML/CSS/TS) | Follow accessibility patterns (see ACCESSIBILITY.md) |
| Dashboard settings | `src/dashboard/` (HTML/CSS/TS) | Settings management interface |
| uBlock Import | `src/popup/ublockImport/` | Filter list import functionality |
| Background processing | `src/background/` service-worker.ts | Use modular client classes |
| Local AI Integration | `src/background/ai/LocalAIService.ts`, `src/background/builtInAIClient.ts` | Built-in AI (Chrome Gemini Nano / Edge Phi-mini); Ollama/LM Studio go through `src/background/ai/providers/OpenAIProvider.ts` |
| Page interaction | `src/content/` extractor.ts | Consider CSP restrictions |
| Storage | `src/utils/storage.ts` | Use StorageKeys constant |
| API Key Encryption | `src/utils/crypto/` | PBKDF2 + AES-GCM encryption |
| PII Masking | `src/utils/piiSanitizer.ts` | Privacy-preserving data handling |
| DOM operations | `src/offscreen/` offscreen.ts | For operations requiring offscreen document |
| Trust Database | `src/utils/trustDb/` | Domain trust verification with 3-step check |
| Permission Manager | `src/utils/permissionManager.ts` | chrome.permissions API wrapper + denied domain tracking |
| CSP Settings | `src/dashboard/cspSettings.ts` | Conditional CSP configuration for AI providers |

**Before implementing major features**, review [ADR/](ADR/) for existing architectural decisions and consistency.
