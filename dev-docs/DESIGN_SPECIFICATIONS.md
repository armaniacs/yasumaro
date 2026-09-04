# Design Specifications

This document outlines the critical design decisions and technical constraints for the Yasumaro Chrome extension. These rules are derived from production issues and security requirements to prevent regressions.

## 1. Security & Network Policies

### 1.1 Content Security Policy (CSP)
The `manifest.json` CSP must accommodate the following needs:
- **Notifications**: `connect-src` and `img-src` must include `data:` to allow inline data URLs for notification icons.
- **Favicons**: `connect-src` and `img-src` must include `chrome-extension:` to allow the use of the Chrome Favicon API.
- **API Access**: `connect-src` must explicitly allow `localhost` (for Obsidian REST API) and configured AI provider domains.

### 1.2 SSRF Protection
All network requests to external sources (e.g., uBlock filter imports) must be validated:
- **Tool**: Use `src/utils/fetch.js:fetchWithTimeout`.
- **Validation**: Use `validateUrlForFilterImport()` to block private network addresses and `localhost` (specifically for imports).
- **Exception**: Direct communication with Obsidian on `localhost` is allowed but must be handled via the designated `ObsidianClient`.

## 2. Communication Architecture

### 2.1 Message Passing Validation
To prevent unauthorized or unexpected message processing in the Service Worker:
- **Sender Distinction**: Distinguish between `Content Script` (untrusted web page) and `Popup` (trusted extension UI).
- **Type Whitelisting**: Only process message types defined in `VALID_MESSAGE_TYPES`.
- **Envelope policy** (`src/background/handlers/envelopePolicy.ts`): shape + version + migration-skip + sender special-cases live in one ordered `checkEnvelope()` pipeline with the policy sets in a single table. Trust + handler lookup stay in `MessageRouter.dispatch`; its strict-sender check deliberately remains after trust so untrusted senders keep reporting the trust error.
- **Origin Check**: Message types that affect system state based on the current page (e.g., `VALID_VISIT`) MUST verify that `sender.tab` is present to ensure they originate from a Content Script.

### 2.2 Service Worker Composition Root
Long-lived collaborators are wired in `createBackgroundServices()` so every message path observes the same shared references (one `SqliteClient`, one `RecordingPipeline`, …).

- **`compositionManifest.ts`**: a declarative `CompositionEntry[]` — `{ key, factory(container), singleton, onReady?(container) }`. Adding a background dependency is one entry; there is no separate `register()` block, keys union, or subset-check type to keep in sync.
- **`ServiceContainer`** (`serviceContainer.ts`): a ~50-line string-keyed DI container. `createBackgroundServices` registers every manifest entry the container does not already have (so a test can `container.override(key, fake)` first), resolves them all, then runs each entry's `onReady` once.
- **`onReady`** is where cross-layer side effects live — `setPendingWriteQueue` and `setSqliteHealthCheck` (utils→background boundary) are declared next to the entry they depend on, not scattered through the composition body.
- **`dashboardSqliteHandler`** is an internal wiring value: it is a container key and reaches `MessageRouterDeps`, but it is not a field on `BackgroundServicesComposition`. Consumers get the handler via `messageRouter.getHandler('DASHBOARD_SQLITE')`.

## 3. UI Implementation Standards

### 3.1 Favicon Retrieval
- **Standard**: Always use the Chrome Favicon API (`chrome-extension://_favicon/`) instead of relying on `tab.favIconUrl`.
- **Reasoning**: `tab.favIconUrl` is often unavailable or restricted by site CSPs, whereas the official API is more robust for Manifest V3.

### 3.2 Error Reporting
- **Standard**: Network errors must be detailed and user-friendly.
- **Implementation**: Catch fetch errors and map them to localized messages using `errorUtils.js`. Avoid exposing technical stacks or private URLs in error strings.

### 3.1 Diagnostics Panel (collect → Snapshot → render)

The diagnostics panel follows a strict one-seam structure:

- **Collect:** `DiagnosticsCollector.collect(): Promise<DiagnosticsSnapshot>` is the single
  entry point for all diagnostic data (storage usage, SQLite status with retry,
  deficiencies, built-in AI, Obsidian settings, per-provider AI settings, ext info,
  VFS divergence, debug mode, settings-load failure flag). Chrome dependencies are
  injected as adapters so tests use plain fakes.
- **Render:** `diagnosticsPanel.ts` renders sections purely from the snapshot and must
  not import `getSettings` or `chrome.storage`.
- **Actions:** `diagnosticsActions.ts` owns all button handlers, including the confirm
  dialogs for destructive operations (migrate / cleanup).
- **Persistence:** the `debugMode` flag is read/written only through
  `debugModeStore.getDebugMode()/setDebugMode()`.

## 4. Accessibility (A11y)

### 4.1 Focus Management
- **Modals**: Must implement focus trapping (preventing Tab from leaving the modal) and ESC-to-close. Restore focus to the triggering element upon closing.
- **Navigation**: Tabbed interfaces must support keyboard navigation (Arrow keys, Home/End, Enter/Space) as per ARIA patterns.

## 5. Data Management & Storage

### 5.1 Storage Keys Structure

All settings are managed via `StorageKeys` defined in `src/utils/storage/types.js`.
Settings access goes through the `SettingsRepository` deep module (`src/utils/storage/SettingsRepository.ts`):

- **Single source of defaults**: `DEFAULT_SETTINGS` in `src/utils/storage/defaults.ts` is the only source of fallback values.
- **No inline fallbacks**: Callers must not use `|| 'default'` after reading settings.
- **Partial reads**: use `repo.getMany([StorageKeys.X, StorageKeys.Y])`.
- **Full reads**: use `repo.getAll()` when loading an entire form.
- **Testability**: tests inject `InMemoryStorageAdapter` via `SettingsReader` (`Pick<SettingsRepository, 'getMany' | 'getAll'>`) so they do not depend on `chrome.storage` mocks.

Key groups:
- **Obsidian Configuration**: `OBSIDIAN_API_KEY`, `OBSIDIAN_PROTOCOL`, `OBSIDIAN_PORT`, `OBSIDIAN_DAILY_PATH`
- **AI Provider Configuration**: `GEMINI_API_KEY`, `GEMINI_MODEL`, `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_2_*`
- **Visit Detection**: `MIN_VISIT_DURATION` (default: 5 seconds), `MIN_SCROLL_DEPTH` (default: 50%)
- **Domain Filtering**: `DOMAIN_WHITELIST`, `DOMAIN_BLACKLIST`, `DOMAIN_FILTER_MODE`
- **Privacy**: `PRIVACY_MODE`, `PII_CONFIRMATION_UI`, `PII_SANITIZE_LOGS`
- **uBlock Format**: `UBLOCK_RULES`, `UBLOCK_SOURCES`, `UBLOCK_FORMAT_ENABLED`, `SIMPLE_FORMAT_ENABLED`

### 5.2 URL History Limits
- **Maximum URLs**: `MAX_URL_SET_SIZE = 10,000`
- **Warning Threshold**: `URL_WARNING_THRESHOLD = 8,000`
- When limit is exceeded, recording is rejected with user notification
- When approaching threshold (≥ 8,000), warning is logged

### 5.3 Cache Strategy
RecordingCache is implemented as `RecordingCacheInstance` — a **facade composing 3 typed caches** (`src/background/cache/SettingsCache.ts` / `UrlCache.ts` / `PrivacyCache.ts`, each owning its TTL and `isStale()`), with injected `RecordingCacheStore` (no global state):
- **SettingsCache**: 30-second TTL (`SETTINGS_CACHE_TTL`) — `SettingsCache` owns `get()` / `invalidate()` / `isStale()`, cache version tracking
- **UrlCache**: 60-second TTL (`URL_CACHE_TTL`) — `UrlCache` owns `Map<string,number>` and `isStale()`
- **PrivacyCache**: 5-minute TTL (`PRIVACY_CACHE_TTL`) — `PrivacyCache` owns `Map<string,PrivacyInfo>` and `getWithFallback()` (session fallback `privacyCache_<url>` with TTL eviction)
- **Cross-context invalidation**: `ensureStorageListener()` is owned once by the facade and broadcasts `invalidateSettingsCache()` on `chrome.storage.onChanged` (`settings` key), with `dispose()` for deregistration
- **Redaction**: `redactSettingsApiKeys` in `src/utils/storage/storagePort.ts` empties API-key fields before session persistence; cache modules are unaware of API-key redaction (VULN-014)
- Cache persists across Service Worker restarts via `SessionStoreRecordingCacheStore`; tests use `InMemoryRecordingCacheStore` for isolation

### 5.4 SQLite Secondary Store (OPFS + FTS5)
A local SQLite database acts as a **secondary store for browsing/search**, independent of the Obsidian integration. It runs in the offscreen document, which proxies operations to a Web Worker over `postMessage`. See [ADR-014](ADR/2026-06-17-opfs-fts5-coexistence.md).

- **Engine**: `@subframe7536/sqlite-wasm` (`OPFSCoopSyncVFS` + FTS5-enabled WASM, SQLite 3.53.0). `createSyncAccessHandle` requires a Worker context, so all OPFS SQLite work happens in `src/offscreen/opfsWorker.ts`.
- **Persistence + full-text search coexist** in the same database (previously mutually exclusive with the old `wa-sqlite` npm builds).
- **3-tier fallback**: OPFS Worker → IndexedDB (`wa-sqlite` async, also FTS5-capable) → `chrome.storage.local`. Status is reported per active path via the `STATUS` message (`fts5`, `fallback`, `path`).
- **Full-text search**: FTS5 virtual table `browsing_logs_fts` (external content, synced by triggers) with the **`trigram` tokenizer** to support Japanese/CJK substring search. Queries shorter than 3 code points fall back to LIKE (trigram cannot match < 3 chars). User input is whitelisted and phrase-quoted (`sanitizeFtsTerm`) to prevent FTS5 operator injection.
- **Migration**: existing users' old `AccessHandlePoolVFS` database is migrated once (idempotent) into the new DB via `opfsMigrationV2.ts` (old `wa-sqlite` dependency is confined to `opfsMigrationV2Reader.ts`). Tracked by `StorageKeys.OPFS_MIGRATION_V2_DONE`.
- **Dashboard access**: the dashboard talks to the store via `DASHBOARD_SQLITE` messages (subtypes `query`/`search`/`status`/`import`/...). All read handlers wrap results as `{ success: true, rows, total }` so the dashboard service can distinguish success from failure.
- **Unified gateway — hop split** (`src/background/sqlite/offscreenGateway.ts` + `src/background/sqlite/dashboardGateway.ts`, facade `src/background/sqliteGateway.ts` re-exports both): both RPC hops share the single result vocabulary `SqliteResult<T>` but each hop has its own locality. `OffscreenGateway` (background → offscreen) exposes `query` / `mutate` / `maintain` / `status` via `ChromeOffscreenTransport`; `DashboardGateway` (dashboard → service worker) handles `DASHBOARD_SQLITE` with `tokenExempt` confirm-token dance and `DASHBOARD_SQLITE_TIMEOUT=10000`. `SqliteClient` is a thin shim delegating to `OffscreenGateway` so error classification never drifts.
  - The Service Worker hop classifies transport failures with `categorizeError`.
  - The Dashboard hop passes failure-response reasons through **verbatim** (the Service Worker already classified them); it only runs `categorizeError` on its own transport-level exceptions.
- **Query plan — single SSOT** (`src/offscreen/queryPlan.ts`): `buildQuerySpec` / `clampLimit` / `buildExtraWhereSql` / `matchesExtraWhere` / `QUERY_CAPS` (plain 1000 / FTS 100000) are the single source of truth for WHERE-clause generation and limit clamping. `IdbVfsBackend` and `opfsWorker/searchHandlers` consume them; `InMemoryTransport` now delegates to `matchesExtraWhere` and `sanitizeFtsTerm` instead of reimplementing, and uses `QUERY_CAPS` + `clampLimit` for limits. `ORDER BY` is string-aware (`localeCompare` for strings, numeric for numbers) so `InMemoryTransport` fidelity matches the real FTS ordering.
- **Backend facets** (`src/offscreen/StorageBackend.ts`): the storage backend interface is split into `Queryable` (read) and `Mutable` (write) so callers import only the facet they need.
- **Transport adapters** (`OffscreenTransport` interface): `ChromeOffscreenTransport` manages the real offscreen-document lifecycle in production; `InMemoryTransport` is a stateful in-memory store so `OffscreenGateway` can be exercised in tests via the shared `queryPlan` SSOT without an offscreen document or any `chrome.*` API.

### 5.5 Trust DB

Domain trust verification (used by the recording pipeline's trust step) is stored under `chrome.storage.local` key `trust_db:json` (canonical value `StorageKeys.TRUST_DB` in `src/utils/storage/types.ts`) and split into three deep modules plus a 2-seam façade:

- **`TrustDbKernel`** (`src/utils/trustDb/TrustDbKernel.ts`): owns the lifecycle — `initialize` / `save` / `rebuildCaches`. The **only** place that reads `chrome.storage.local.get(STORAGE_KEY)` where `STORAGE_KEY = StorageKeys.TRUST_DB`. `save()` uses a single `withOptimisticLock` (no separate lock for the Bloom filter). Settings access (Tranco version/domains) goes through an injectable `settingsReader` port; the default delegates to `settingsRepository.getAll()` / `setAll()` (i.e. the `SettingsRepository` / `StoragePort` path with cache / encryption / migration), not a direct `chrome.storage.local.get('settings')` — resolves circular #1 in [ADR 2026-08-20](ADR/2026-08-20-utils-layer-circular-dependency.md) without bypassing the repository seam.
- **`TrustPolicy`** (`src/utils/trustDb/TrustPolicy.ts`): the **readonly seam** — `isDomainTrusted` / `isTrancoDomain` only, **storage-free** (`grep -rn "chrome.storage" src/utils/trustDb/TrustPolicy.ts` is 0). Hides `DomainVerifier` / `BloomFilterManager` / `TrancoManager` as private collaborators. Readonly callers (e.g. pipeline trust step) should import only this seam.
- **`TrustDbAdmin`** (`src/utils/trustDb/TrustDbAdmin.ts`): the **mutation seam** — `addToWhitelist` / `addSensitiveDomain` / `updateTranco` / `save` / `repairDatabase` etc. Owns the persistence key via `export const TRUST_DB_STORAGE_KEY = StorageKeys.TRUST_DB` (re-exported from `StorageKeys`; Kernel consumes the same constant) and delegates to the Kernel, which persists through `StoragePort`/`withOptimisticLock`. Callers that mutate trust state (dashboard, whitelist updates) use this seam.
- **`ManagedCollections`** (`src/utils/trustDb/ManagedCollections.ts`): bundles the `userTlds` / `sensitive` / `whitelist` string lists behind one module. `ManagedStringList` remains the internal implementation; exposed to callers only through `TrustDbAdmin`.
- **`repairTrustDatabase`** (`src/utils/trustDb/trustDbRepair.ts`): a pure function that back-fills every missing field of a corrupted DB without in-place mutation.
- **Compatibility shim** (`src/utils/trustDb/trustDb.ts`): re-exports the 2-seam API (`getTrustPolicy()` / `getTrustDbAdmin()`) and keeps `getTrustDb()` for backward compatibility until all callers migrate. New code should not use the god object.

## 6. Domain Filtering Behavior

### 6.0 DomainFilter Deep Module (single seam)

All 4 gates that answer "is this URL allowed?" converge on one deep module `DomainFilter` (`src/utils/domainFilter/DomainFilter.ts`):

| Gate | Previous impl | Now |
|------|---------------|-----|
| Background live read | `domainUtils.isDomainAllowed` | `DomainFilter.isAllowed(url)` |
| Content-script 5-min TTL | `domainFilterCache` callback cache | `DomainFilterCacheAdapter.isAllowed(url)` |
| Dashboard textarea | `domainFilter.ts` textarea ↔ storage | `DomainFilter.parse(text)` / `parseAndValidate(list)` |
| Content extractor callback | `loader` callback cache | `DomainFilter.isAllowedCached` |

- **Single wildcard engine**: `wildcardToRegex` (`src/utils/wildcardToRegex.ts`) is the only implementation with the `MAX_WILDCARDS_PER_PATTERN` ReDoS guard. `domainUtils.isValidDomain` and `matchesPattern`, `urlSkipper.matchesPattern`, and `storage/domainFilterCache.matchesWildcardPattern` all delegate to it (the latter two are deprecated wrappers).
- **Cache generation**: `DomainFilter.buildCacheDomains(settings)` / `cache(settings, now)` returns the correct domain list for `whitelist` / `blacklist` / `disabled` (blacklist now returns blocked domains instead of `[]`). `updateDomainFilterCache` delegates to `buildCacheDomains` so there is no second whitelist/blacklist branch.
- **Two adapters make the seam real**: `DomainFilter` (live `chrome.storage` read) and `DomainFilterCacheAdapter` (in-memory copy of the 5-min cache, fallback to live when stale). One adapter = hypothetical seam; two = real.
- **TTL as construction param**: `new DomainFilter({ ttlMs })` and `new DomainFilterCacheAdapter(filter, { ttlMs })`; `DEFAULT_DOMAIN_FILTER_TTL_MS = 5*60*1000`. Tests inject a short TTL to exercise the boundary without timer manipulation.
- **Dashboard seam**: the hidden `whitelistTextarea` / `blacklistTextarea` trick is hidden behind `DomainFilter`; the dashboard only calls `parse`/`parseAndValidate`, never `wildcardToRegex` directly.

### 6.1 Default Blacklist
The following domains are blocked by default and persist unless explicitly removed by the user:
- amazon.co.jp, amazon.com
- yahoo.co.jp, yahoo.com
- facebook.com
- twitter.com, x.com
- instagram.com
- youtube.com
- google.com, google.co.jp

### 6.2 Filter Modes
- **Disabled**: No domain filtering applied
- **Whitelist**: Only allowed domains are recorded
- **Blacklist**: Blacklisted domains are blocked (default mode)

### 6.3 Force Recording
The `force` parameter in `record()` overrides domain filtering, but a warning is logged.

## 7. Privacy Pipeline Architecture

### 7.1 Privacy Modes
- **masked_cloud** (default): PII masking → Cloud AI summarization
- **full_pipeline**: Local AI → PII masking → Cloud AI
- **local_only**: Local AI only (fails if unavailable)
- **cloud_only**: Cloud AI only (no PII masking)

### 7.2 PII Confirmation UI
When enabled (`PII_CONFIRMATION_UI = true`):
- User must preview masked content before final confirmation
- Preview shows processed content with masked items count
- User can confirm or cancel before Cloud AI processing

### 7.3 Three-Layer Processing
- **L1: Local Summarization** (Optional): Uses Chrome Prompt API via offscreen document
- **L2: PII Masking** (Conditional): Regex-based PII detection and replacement
- **L3: Cloud Summarization** (Optional): External AI provider for final summary

## 8. Concurrency & Mutex

### 8.1 Global Write Lock
All Obsidian write operations are serialized via global mutex:
- **Max Queue Size**: 50 concurrent requests (`MAX_QUEUE_SIZE`)
- **Mutex Timeout**: 30 seconds per lock acquisition (`MUTEX_TIMEOUT_MS`)
- Queue uses Map for O(1) operations
- Lock transfers to next queued task (no unlock/lock gap)

### 8.2 Mutex Error Handling
- Release method never throws exceptions
- On release error, lock is forced unlocked and error is logged
- Prevents deadlocks from exceptions in release pathway

### 8.3 Recording Pipeline

All recording paths go through **`RecordingOrchestrator`** (`src/background/pipeline/RecordingOrchestrator.js`) — **3 distinct entry points** compiled at construction:

```
record(data: RecordingData, opts?: RecordOptions)            // delegates to one of below for backward compat
recordFull(data, opts)                                       // normal: full 13 steps
preview(data, opts)                                          // preview: short-circuits after privacy step (previewBreakpoint) via the same 13-step kernel with `previewOnly:true`
retryObsidianWrite(job: { title, url, summary, tags? })      // retryObsidian: 2-step subset `retrySteps` (formatMarkdown + saveObsidian) compiled at construction, no inline 2-step in `record()`; exposed also as `retryObsidianWriteOnly(job)` for backward compat
```

- `RecordMode` (`normal`/`preview`/`retryObsidian`) is now `@internal` on the delegating `record()` wrapper; new code should call the 3 distinct methods. `retryObsidian` no longer has an inline `formatMarkdownStep + saveToObsidianStep` inside `record()` — the 2-step subset is a `retrySteps` array compiled at construction and executed via `executeRetrySubset` + `PerUrlMutexMap.runExclusive`, so `PipelineKernel` sees one list per mode.
- `opts.settings` bypasses `getSettingsWithCache`; the manual/preview record handlers pass their already-resolved settings this way so a concurrent cache refresh cannot race them.
- **Typed context** (`src/background/pipeline/contextBuilder.ts`): the canonical context is `StagedContext<S>` (brand type `ContextStage` = `initial`/`checked`/`privacy`/`extracted`/`formatted`) with `createInitialContext` / `createRetryContext` / `createStepDeps` / `createSaveSqliteParams`. The 7-way `RecordingContext` intersection in `types.ts` is superseded; `pickDefined` conditional spreads are replaced by explicit `if (x !== undefined)` builders so `exactOptionalPropertyTypes` is satisfied and out-of-order reads become type errors.
- **`RetryPolicy`** (`src/background/pipeline/retryPolicy.ts`): `isNetworkError` / `shouldEnqueueForOffline` (string heuristic including `'ai '`) is extracted from `StepExecutor` so the policy is unit-testable without network; `StepExecutor` is injected with `RetryPolicy` (default `defaultRetryPolicy`) and no longer owns the heuristic.
- The step list, `PipelineKernel`, and `StepExecutor` are private implementation. Callers only see the 3 entry points / `RecordingData` / `RecordingResult`.
- **`RecordingOutcome`** (`src/background/pipeline/recordingOutcome.ts`): the single outcome-policy seam — `decideStepOutcome()` (catch path: PrivatePage / Duplicate / FATAL+RETRY mapping) and `finalizeSuccess()` (success path: non-fatal summary log, obsidian_sync recovery, save-success notice). Pending registration and user notices hide behind injectable `OutcomeNotifier` / `OutcomePendingWriter` adapters (production: chrome + storage; tests: in-memory fakes). `resultBuilder.ts` keeps pure shape construction only.
- Handler deps use the narrow `RecordingRunner` interface (`{ record }`), not the concrete class.

**Per-URL serialization** — `record()` runs each URL's work inside `PerUrlMutexMap` (`src/background/pipeline/perUrlMutex.js`):
- Each map instance owns a `Map<string, Mutex>` (per-URL, `maxQueueSize: 5`, `timeoutMs: 60000`).
- The map entry is dropped only when its mutex is fully idle (no current lock, no queued waiters), so a URL with a pending concurrent recording keeps its entry.
- **One shared instance**: registered as a container singleton (`perUrlMutexMap`) and wired into the orchestrator's deps by `compositionManifest.ts`. An orchestrator constructed without it falls back to a private map, losing cross-instance serialization and re-opening the duplicate-entry race.

## 9. Obsidian REST API Integration

### 9.1 Connection Configuration
- **Default Protocol**: `https`
- **Default Port**: `27124`
- **Port Validation**: 1-65535, integer only
- **Required**: API key (Bearer token)

### 9.2 Daily Note Path Format
Uses placeholder substitution with `buildDailyNotePath()`:
- `YYYY`: 4-digit year
- `MM`: 2-digit month (01-12)
- `DD`: 2-digit day (01-31)
- `YYYY-MM-DD`: Full date string
- **Default Path**: `{YYYY}-{MM}-{DD}.md`
- **Default Folder**: `092.Daily`

### 9.3 Request Behavior
- **Timeout**: 15 seconds (`FETCH_TIMEOUT_MS`)
- **Read-Modify-Write**: Fetch existing content → insert into section → write back
- **Section Header**: Content inserted after `## Web History` section (or default header)
- **404 Handling**: Empty string returned for non-existent notes

## 10. Content Extraction

### 10.1 Content Script Behavior
- **Source**: `src/content/extractor.ts`
- **Extraction Scope**: `document.body.innerText`
- **Length Limit**: Maximum 10,000 characters
- **Normalization**: Consecutive whitespace → single space
- **Trigger Conditions**:
  - Visit duration ≥ `MIN_VISIT_DURATION` (default: 5s)
  - Scroll depth ≥ `MIN_SCROLL_DEPTH` (default: 50%)
- **Frequency Check**: Every 1 second + on scroll events
- **Performance**: Stop periodic checking after conditions met

### 10.2 Content Format
Timestamp in Japanese locale (HH:MM format):
```markdown
- HH:MM [Page Title](URL)
  - AI要約: Summary text
```

## 11. Local AI (Chrome Prompt API)

### 11.1 Offscreen Document Architecture
- **Purpose**: Access `window.ai` Prompt API (not available in Service Worker)
- **Document Path**: `src/offscreen/offscreen.html`
- **Reason**: `chrome.offscreen.Reason.WORKERS`

### 11.2 Session Management
- **System Prompt**: Japanese instructions for web summarization
- **Content Limit**: 10,000 characters per prompt
- **Message Timeout**: 30 seconds
- **Status Checks**: `readily`, `after-download`, `no`, `unsupported`
- **Session Reuse**: Session cached for multiple prompts

### 11.3 Cloud AI Provider Catalog

`ProviderCatalog` (`src/background/ai/providerCatalog.ts`) is the single seam for per-provider wiring. `resolve(id)` / `tryResolve(id)` return one entry describing a provider:

- `baseUrlKey` / `apiKeyKey` / `modelKey` — the `StorageKeys` holding that provider's config
- `isLocal` — whether the base URL is expected to be a localhost address
- `defaultModel`, `cspDomain`, `label`, `contentCharsKey`

The catalog is built from `PROVIDER_REGISTRY` (wiring data) augmented with `cspDomain` / `label` / `contentCharsKey`. Consumers derive from the catalog instead of hard-coded switches:

- `cspValidator` / `cspSettings` add a provider's base-URL origin from `baseUrlKey` + `isLocal`, and conditional-CSP origins from `cspDomain`.
- `DiagnosticsCollector` reads each provider's model / base URL / API key via the catalog entry's keys.
- `getMaxContentChars` (`ProviderStrategy`) reads the typed `settings.providers[<id>]` bag, then the global `StorageKey`, then a default.

## 12. uBlock Origin Format Support

### 12.1 Strict Conformance
The implementation MUST strictly conform to uBlock Origin filter format:
- Support list-style domain filtering (`||example.com^`)
- Exception domains (`@@||example.com^`)
- Multi-source import capability
- Source metadata tracking (import timestamp, rule count)

### 12.2 Format Toggle
- **uBlock Format**: Full uBlock-compatible domain filtering
- **Simple Format**: Plain domain list (fallback method)
- Both formats can be enabled/disabled independently

## 13. Private Page Confirmation

### 13.1 Purpose
The Private Page Confirmation feature allows users to review and manage pages that were marked as private before saving. This prevents accidental saving of sensitive content while giving users control over what gets recorded.

### 13.2 Pending Pages Storage
- **Storage Key**: `pendingPages`
- **Structure**: Array of `PendingPage` objects
- **Data Fields**:
  - `url`: Page URL (required)
  - `title`: Page title (required)
  - `timestamp`: Detection timestamp (required)
  - `reason`: Detection reason - `cache-control`, `set-cookie`, or `authorization` (required)
  - `headerValue`: Header value that triggered detection (optional)
  - `expiry`: Expiration timestamp - 24 hours after detection (required)
- **Operations**:
  - `addPendingPage(page)`: Add page to pending list (deduplicates by URL)
  - `getPendingPages()`: Retrieve all non-expired pending pages
  - `removePendingPages(urls)`: Remove pages with matching URLs
  - `clearExpiredPages()`: Remove all expired pages (manual trigger)
- **Lib Module**: `src/utils/pendingStorage.ts`

### 13.3 Recording Data Extension
- **RecordingData interface**:
  - `requireConfirmation?`: Boolean flag to indicate confirmation is required (manual save)
  - `headerValue?`: Header value that triggered detection
- **RecordingResult interface**:
  - `confirmationRequired?`: Boolean flag indicating if user confirmation was required

### 13.4 Recording Behavior
- **Manual Save** (`requireConfirmation: true`):
  - Private page detected → Save to pending storage → Return `confirmationRequired: true`
  - Popup shows confirmation dialog with options
  - User can: Cancel, Save once, Save with domain whitelist, Save with path whitelist

- **Auto Recording** (`requireConfirmation: false` or undefined):
  - Private page detected → Save to pending storage → Return `PRIVATE_PAGE_DETECTED` error
  - No immediate user interaction required
  - User can review and batch-process pending pages from popup UI

### 13.5 Whitelist Addition
Users can add domains/paths to the whitelist from the confirmation dialog:
- **Source**: Confirmation dialog provides whitelist options
- **Pattern Support**:
  - Domain whitelist: Simple domain names or wildcard patterns (e.g., `*.example.com`)
  - Path whitelist: Regex patterns for precise path matching
- **PII Masking**: Always applied even for whitelisted domains
- **Privacy Bypass**: Whitelisted domains skip private page detection warning

### 13.6 UI Components
- **Confirmation Dialog**:
  - Shows privacy warning message with URL and header value
  - Options: Cancel, Save once, Save with domain whitelist, Save with path whitelist
  - Located in `src/popup/main.ts`

- **Pending Pages Panel**:
  - Located in `src/popup/popup.html` (#pending-section)
  - Shows list of pages with URLs, titles, and detection reasons
  - Batch actions: Save all, Save selected, Save with whitelist, Discard
  - Auto-excludes expired pages (24-hour TTL)

### 13.7 Security Considerations
- **Header Value Truncation**: Header values are truncated to 1024 characters to prevent storage abuse
- **24-Hour Expiry**: Pending pages automatically expire after 24 hours to prevent stale data accumulation
- **HTML Escaping**: Popup UI properly escapes user-provided content (URL, title, header value)
- **Whitelist Validation**: Domain patterns are validated before adding to whitelist

## 14. Message Passing Protocol

### 14.1 Valid Message Types (`VALID_MESSAGE_TYPES`)
- `VALID_VISIT`: Content Script → Service Worker (automatic visit recording)
- `GET_CONTENT`: Popup ↔ Content Script (manual content fetch)
- `FETCH_URL`: Popup → Service Worker (CORS bypass fetch)
- `MANUAL_RECORD`: Popup → Service Worker (manual record)
- `PREVIEW_RECORD`: Popup → Service Worker (preview with PII masking)
- `SAVE_RECORD`: Popup → Service Worker (save confirmed preview)

### 14.2 Message Payload Structure
```javascript
{
  type: string,           // Must be in VALID_MESSAGE_TYPES
  payload: {              // Required object
    // type-specific fields
  },
  target?: string         // Optional: 'offscreen' for offscreen messages
}
```

---
*Refer to [CHANGELOG.md](../CHANGELOG.md) for the version history that established these rules (v2.4.1 - v2.4.4).*
