# C4: Service Worker Handler Dependency Narrowing + Registry — Design Spec

**Date:** 2026-07-13
**Scope:** Refactor handler dependencies from singleton-object injection to method-level injection. Replace the 15-branch if-else dispatch chain with a typed `MessageHandlerRegistry`. Extract composition into `createBackgroundServices()`.

## Motivation

`service-worker.ts` bundles composition (10+ singleton constructions), message dispatch (15-branch if-else), handler implementations (200+ lines inline), and Chrome event wiring. The 5-Why deep-dig identified the root cause as **singleton-object-level injection**: handlers receive entire objects when they only need 1-3 methods. This prevents typing the handler signature uniformly and blocks testability.

## Decision

**Step 1**: Narrow handler dependencies to method-level (required methods only).
**Step 2**: Introduce `MessageHandlerRegistry` with typed dispatch.
**Step 3**: Extract `createBackgroundServices()` for explicit composition.

### Step 1: Dependency Interface Per Handler

Each handler defines its own lightweight dependency interface:

```typescript
// src/background/handlers/validVisitHandler.ts

interface ValidVisitHandlerDeps {
  recordVisit: RecordingLogic['record'];
  getCachedTab: ITabCache['get'];
  setCachedTab: ITabCache['set'];
  checkRateLimit: RateLimiter['check'];
}

function createValidVisitHandler(deps: ValidVisitHandlerDeps): MessageHandler {
  return async (message, sender, sendResponse) => {
    // Uses deps.recordVisit, deps.getCachedTab, etc.
    // No access to the full singleton objects
  };
}
```

### Step 2: MessageHandlerRegistry

```typescript
// src/background/handlers/MessageHandlerRegistry.ts

type MessageHandler = (
  message: ValidMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: MessageResponse) => void
) => boolean; // true = async (keep channel open)

class MessageHandlerRegistry {
  private handlers = new Map<MessageType, MessageHandler>();

  register(type: MessageType, handler: MessageHandler): void {
    if (this.handlers.has(type)) throw new Error(`Duplicate handler: ${type}`);
    this.handlers.set(type, handler);
  }

  dispatch(
    type: MessageType,
    message: ValidMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: MessageResponse) => void
  ): boolean {
    const handler = this.handlers.get(type);
    if (!handler) {
      sendResponse({ success: false, error: `Unknown message type: ${type}` });
      return false;
    }
    return handler(message, sender, sendResponse);
  }
}
```

### Step 3: createBackgroundServices()

```typescript
// src/background/createBackgroundServices.ts

interface BackgroundServices {
  obsidian: ObsidianClient;
  aiService: AIService;
  sqliteClient: SqliteClient;
  recordingLogic: RecordingLogic;
  tabCache: ITabCache;
  rateLimiter: RateLimiter;
  manualContentFetcher: ManualContentFetcher;
  migrationService: MigrationService;
}

function createBackgroundServices(): BackgroundServices {
  // All singleton construction. This is the only place with `new`.
}
```

### service-worker.ts After

```typescript
// ~100 lines (down from 993)

const services = createBackgroundServices();

const registry = new MessageHandlerRegistry();
registry.register('VALID_VISIT', createValidVisitHandler({
  recordVisit: services.recordingLogic.record.bind(services.recordingLogic),
  getCachedTab: services.tabCache.get.bind(services.tabCache),
  setCachedTab: services.tabCache.set.bind(services.tabCache),
  checkRateLimit: services.rateLimiter.check.bind(services.rateLimiter),
}));
registry.register('MANUAL_RECORD', createManualRecordHandler({ /* ... */ }));
// ... 13 more handlers

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  return registry.dispatch(message.type, message, sender, sendResponse);
});

// Chrome event wiring stays in service-worker.ts:
chrome.alarms.onAlarm.addListener(handleAlarm);
chrome.tabs.onUpdated.addListener(handleTabUpdate);
// ...
```

### Handlers (15 total)

| Handler | Dependencies (methods) | Message Type |
|---------|----------------------|-------------|
| `validVisitHandler` | `recordingLogic.record`, `tabCache.get/set`, `rateLimiter.check` | `VALID_VISIT` |
| `manualRecordHandler` | `recordingLogic.record`, `manualContentFetcher.fetch` | `MANUAL_RECORD` |
| `saveRecordHandler` | `obsidian.writeNote`, `sqliteClient.call` | `SAVE_RECORD` |
| `obsidianTestHandler` | `obsidian.testConnection` | `TEST_OBSIDIAN` |
| `aiTestHandler` | `aiService.generateSummary` | `TEST_AI` |
| `getSettingsHandler` | `chrome.storage.local.get` | `GET_SETTINGS` |
| `saveSettingsHandler` | `chrome.storage.local.set` | `SAVE_SETTINGS` |
| `dashboardSqliteHandler` | `sqliteClient.call` | `DASHBOARD_SQLITE` |
| `contentExtractionHandler` | `manualContentFetcher.extract` | `EXTRACT_CONTENT` |
| `gistBackupHandler` | resolved at impl (reads existing handler) | `GIST_BACKUP` |
| `exportImportHandler` | resolved at impl (reads existing handler) | `EXPORT_IMPORT` |
| `migrateUrlSetHandler` | `migrationService.migrate` | `MIGRATE_URL_SET` |
| `checkObsidianStatusHandler` | `obsidian.getStatus` | `CHECK_OBSIDIAN_STATUS` |
| `getPendingPagesHandler` | `recordingLogic.getPending` | `GET_PENDING_PAGES` |
| `recordingConditionsHandler` | resolved at impl (reads existing handler) | `RECORDING_CONDITIONS` |

> **Note on TBD entries**: `gistBackupHandler`, `exportImportHandler`, and `recordingConditionsHandler` have dependencies that must be traced by reading the existing handler code during implementation. Their dep interfaces will follow the same method-level extraction pattern.

### Files Changed

| File | Change |
|------|--------|
| `src/background/handlers/*.ts` | Rewrite factory functions to accept typed method-level deps |
| `src/background/handlers/MessageHandlerRegistry.ts` | New |
| `src/background/createBackgroundServices.ts` | New |
| `src/background/service-worker.ts` | Shrinks to composition + event wiring (~100 lines) |
| `src/background/handlers/tabEventHandlers.ts` | Unchanged (tab events, not message handlers) |
| `src/background/handlers/lifecycleHandlers.ts` | Unchanged |

### Tests

- **Unit**: Each handler with stubbed deps — verify correct method calls, error paths
- **Unit**: `MessageHandlerRegistry` — duplicate registration, unknown type, dispatch routing
- **Unit**: `createBackgroundServices()` — composition order, all services created

### Risks

- **`.bind()` correctness**: Method references must be bound to their instances. Mitigation: type system catches if the wrong shape is passed to the handler deps interface.
- **Handler count**: 15 handlers × per-handler deps interface = significant boilerplate. Mitigation: deps interfaces are co-located with handlers, not centralized.
