# Architecture Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor 5 architectural friction areas across dashboard UI, background, and pipeline layers — introducing typed abstractions, eliminating dead code, and improving testability.

**Architecture:** Phase 1 builds foundations (types, registries, mappers) in parallel across all 5 candidates. Phase 2 migrates panels one-by-one and integrates new abstractions. Phase 3 deletes dead code. Each task produces a self-contained commit.

**Tech Stack:** TypeScript, Chrome Extension Manifest V3, Jest, Playwright, WXT

**Spec Refs:**
- `dev-docs/superpowers/specs/2026-07-13-dashboard-panel-abstraction-design.md`
- `dev-docs/superpowers/specs/2026-07-13-html-datastoragekey-convention-design.md`
- `dev-docs/superpowers/specs/2026-07-13-ai-client-interface-unification-design.md`
- `dev-docs/superpowers/specs/2026-07-13-sw-handler-deps-narrowing-registry-design.md`
- `dev-docs/superpowers/specs/2026-07-13-pipeline-mapper-extraction-design.md`

---

## Parallel Phases Overview

```
Phase 1 ──┬── C1-1: Panel types + NavRegistry + Bootstrapper ──┐
          ├── C3-1: AIService interface + Remote/Local/Fallback ─┤
          ├── C4-1: Registry + createBackgroundServices ─────────┤  ALL PARALLEL
          ├── C5-1: BrowsingLogRecordMapper ─────────────────────┤
          └── C5-2: MarkdownBufferManager ───────────────────────┤
                                                                 │
Phase 2 ──┬── C1-2: Migrate panels (1-18) ──────────────────────┤
          ├── C2-1: data-storage-key HTML + generic utils ───────┤  MOSTLY PARALLEL
          ├── C3-2: Refactor PrivacyPipeline → AIService ────────┤
          └── C4-2: Refactor handlers + wire registry ───────────┤
                                                                 │
Phase 3 ──┬── C1-3: Delete old nav, getDashboardElements ────────┤
          ├── C2-2: Delete getSettingsMapping ───────────────────┤
          ├── C3-3: Delete dead interfaces/index.ts ─────────────┤
          ├── C4-3: Delete old if-else dispatch ─────────────────┤
          └── C5-3: Delete inline pipeline mapper code ──────────┘
```

---

## Phase 1: Foundations (All candidates, max parallel)

### Task 1.1: C1 — Create Panel types and NavigationRegistry

**Files:**
- Create: `src/dashboard/panels/types.ts`
- Create: `src/dashboard/panels/NavigationRegistry.ts`
- Create: `src/dashboard/panels/__tests__/NavigationRegistry.test.ts`
- Create: `src/dashboard/panels/DashboardBootstrapper.ts`
- Create: `src/dashboard/panels/__tests__/DashboardBootstrapper.test.ts`

- [ ] **Step 1.1a: Write Panel types**

```typescript
// src/dashboard/panels/types.ts

export type Panel = AsyncDataPanel | StaticFormPanel | DiagnosticPanel;

export interface AsyncDataPanel {
  readonly id: string;
  readonly category: 'async-data';
  mount(container: HTMLElement): void;
  loadData(): Promise<void>;
  unmount?(): void;
  onActivate?(init?: Record<string, unknown>): void;
  onDeactivate?(): void;
}

export interface StaticFormPanel {
  readonly id: string;
  readonly category: 'static-form';
  mount(container: HTMLElement): Promise<void>;
  refresh(): Promise<void>;
  onActivate?(): void;
}

export interface DiagnosticPanel {
  readonly id: string;
  readonly category: 'diagnostic';
  mount(container: HTMLElement): Promise<void>;
  refresh(): Promise<void>;
}

export interface PanelInitMap {
  'panel-sqlite-history'?: { searchTag?: string; searchDomain?: string };
  'panel-tag-cluster'?: { focusTag?: string };
}
```

- [ ] **Step 1.1b: Write NavigationRegistry tests**

```typescript
// src/dashboard/panels/__tests__/NavigationRegistry.test.ts

import { NavigationRegistry } from '../NavigationRegistry';
import { type AsyncDataPanel, type StaticFormPanel } from '../types';

function mockAsyncPanel(overrides?: Partial<AsyncDataPanel>): AsyncDataPanel {
  return {
    id: 'panel-test',
    category: 'async-data',
    mount: jest.fn(),
    loadData: jest.fn().mockResolvedValue(undefined),
    onActivate: jest.fn(),
    onDeactivate: jest.fn(),
    ...overrides,
  };
}

describe('NavigationRegistry', () => {
  let registry: NavigationRegistry;

  beforeEach(() => {
    registry = new NavigationRegistry();
  });

  test('register stores a panel', () => {
    const panel = mockAsyncPanel();
    registry.register(panel);
    expect(registry.activeId).toBeNull();
  });

  test('register throws on duplicate id', () => {
    registry.register(mockAsyncPanel({ id: 'panel-a' }));
    expect(() => registry.register(mockAsyncPanel({ id: 'panel-a' }))).toThrow('already registered');
  });

  test('navigate activates a panel and calls lifecycle methods', async () => {
    const panel = mockAsyncPanel({ id: 'panel-a' });
    registry.register(panel);
    registry.navigate('panel-a');
    expect(registry.activeId).toBe('panel-a');
    expect(panel.onActivate).toHaveBeenCalled();
    expect(panel.loadData).toHaveBeenCalled();
  });

  test('navigate deactivates previous panel before activating new one', async () => {
    const panelA = mockAsyncPanel({ id: 'panel-a' });
    const panelB = mockAsyncPanel({ id: 'panel-b' });
    registry.register(panelA);
    registry.register(panelB);
    registry.navigate('panel-a');
    registry.navigate('panel-b');
    expect(panelA.onDeactivate).toHaveBeenCalled();
    expect(panelB.onActivate).toHaveBeenCalled();
    expect(registry.activeId).toBe('panel-b');
  });

  test('navigate to same panel does nothing', () => {
    const panel = mockAsyncPanel({ id: 'panel-a' });
    registry.register(panel);
    registry.navigate('panel-a');
    jest.clearAllMocks();
    registry.navigate('panel-a');
    expect(panel.onDeactivate).not.toHaveBeenCalled();
    expect(panel.onActivate).not.toHaveBeenCalled();
  });

  test('navigate throws on unregistered panel', () => {
    expect(() => registry.navigate('panel-unknown')).toThrow('not registered');
  });

  test('navigate passes init context to onActivate', () => {
    const panel = mockAsyncPanel({ id: 'panel-a' });
    registry.register(panel);
    registry.navigate('panel-a', { searchTag: 'AI' });
    expect(panel.onActivate).toHaveBeenCalledWith({ searchTag: 'AI' });
  });

  test('StaticFormPanel does not call loadData (only refresh is available)', () => {
    const panel: StaticFormPanel = {
      id: 'panel-form',
      category: 'static-form',
      mount: jest.fn().mockResolvedValue(undefined),
      refresh: jest.fn().mockResolvedValue(undefined),
    };
    registry.register(panel);
    registry.navigate('panel-form');
    expect(registry.activeId).toBe('panel-form');
    // loadData is not called; refresh is up to the panel
  });
});
```

- [ ] **Step 1.1c: Run tests to verify they fail**

Run: `npx jest src/dashboard/panels/__tests__/NavigationRegistry.test.ts`
Expected: FAIL — module not found

- [ ] **Step 1.1d: Implement NavigationRegistry**

```typescript
// src/dashboard/panels/NavigationRegistry.ts

import { type Panel, type PanelInitMap } from './types';

export class NavigationRegistry {
  private panels = new Map<string, Panel>();
  private activePanelId: string | null = null;

  register(panel: Panel): void {
    if (this.panels.has(panel.id)) {
      throw new Error(`Panel "${panel.id}" is already registered`);
    }
    this.panels.set(panel.id, panel);
  }

  navigate<K extends keyof PanelInitMap>(panelId: K, init?: PanelInitMap[K]): void {
    const panel = this.panels.get(panelId as string);
    if (!panel) {
      throw new Error(`Panel "${panelId as string}" is not registered`);
    }

    if (this.activePanelId === panelId) return;

    // Deactivate current
    if (this.activePanelId) {
      const current = this.panels.get(this.activePanelId);
      current?.onDeactivate?.();
    }

    this.activePanelId = panelId as string;

    // Activate new
    panel.onActivate?.(init);

    // Load data for async panels
    if (panel.category === 'async-data') {
      void (panel as { loadData(): Promise<void> }).loadData();
    }
  }

  get activeId(): string | null {
    return this.activePanelId;
  }
}
```

- [ ] **Step 1.1e: Run tests to verify they pass**

Run: `npx jest src/dashboard/panels/__tests__/NavigationRegistry.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 1.1f: Implement DashboardBootstrapper**

```typescript
// src/dashboard/panels/DashboardBootstrapper.ts

import { NavigationRegistry } from './NavigationRegistry';
import { type Panel } from './types';

export class DashboardBootstrapper {
  constructor(private registry: NavigationRegistry) {}

  registerPanels(panels: Panel[]): void {
    for (const panel of panels) {
      this.registry.register(panel);
    }
  }

  wireSidebar(sidebar: HTMLElement): void {
    sidebar.addEventListener('click', (e: Event) => {
      const target = e.target as HTMLElement;
      const btn = target.closest<HTMLElement>('[data-panel]');
      if (!btn) return;

      const panelId = btn.getAttribute('data-panel');
      if (!panelId) return;

      try {
        this.registry.navigate(panelId);
      } catch {
        // Panel not yet migrated to new system; old navigation handles it
      }
    });
  }

  async start(defaultPanelId?: string): Promise<void> {
    if (defaultPanelId) {
      this.registry.navigate(defaultPanelId);
    }
  }
}
```

- [ ] **Step 1.1g: Write DashboardBootstrapper tests**

```typescript
// src/dashboard/panels/__tests__/DashboardBootstrapper.test.ts

import { NavigationRegistry } from '../NavigationRegistry';
import { DashboardBootstrapper } from '../DashboardBootstrapper';
import { type StaticFormPanel } from '../types';

describe('DashboardBootstrapper', () => {
  let registry: NavigationRegistry;
  let bootstrapper: DashboardBootstrapper;
  let sidebar: HTMLElement;

  beforeEach(() => {
    registry = new NavigationRegistry();
    bootstrapper = new DashboardBootstrapper(registry);
    sidebar = document.createElement('nav');
  });

  test('registerPanels registers all panels', () => {
    const panelA: StaticFormPanel = {
      id: 'panel-a', category: 'static-form',
      mount: jest.fn().mockResolvedValue(undefined),
      refresh: jest.fn().mockResolvedValue(undefined),
    };
    const panelB: StaticFormPanel = {
      id: 'panel-b', category: 'static-form',
      mount: jest.fn().mockResolvedValue(undefined),
      refresh: jest.fn().mockResolvedValue(undefined),
    };
    bootstrapper.registerPanels([panelA, panelB]);
    expect(registry.activeId).toBeNull(); // not activated, just registered
  });

  test('start activates default panel', () => {
    const panel: StaticFormPanel = {
      id: 'panel-default', category: 'static-form',
      mount: jest.fn().mockResolvedValue(undefined),
      refresh: jest.fn().mockResolvedValue(undefined),
      onActivate: jest.fn(),
    };
    bootstrapper.registerPanels([panel]);
    bootstrapper.start('panel-default');
    expect(registry.activeId).toBe('panel-default');
    expect(panel.onActivate).toHaveBeenCalled();
  });

  test('wireSidebar navigates on button click', () => {
    const panel: StaticFormPanel = {
      id: 'panel-settings', category: 'static-form',
      mount: jest.fn().mockResolvedValue(undefined),
      refresh: jest.fn().mockResolvedValue(undefined),
    };
    bootstrapper.registerPanels([panel]);

    const btn = document.createElement('button');
    btn.setAttribute('data-panel', 'panel-settings');
    sidebar.appendChild(btn);
    bootstrapper.wireSidebar(sidebar);

    btn.click();
    expect(registry.activeId).toBe('panel-settings');
  });

  test('wireSidebar ignores clicks on non-data-panel elements', () => {
    const div = document.createElement('div');
    sidebar.appendChild(div);
    bootstrapper.wireSidebar(sidebar);
    div.click();
    expect(registry.activeId).toBeNull();
  });
});
```

- [ ] **Step 1.1h: Run all tests**

Run: `npx jest src/dashboard/panels/__tests__/`
Expected: PASS (11 tests total)

- [ ] **Step 1.1i: Commit**

```bash
git add src/dashboard/panels/types.ts src/dashboard/panels/NavigationRegistry.ts src/dashboard/panels/DashboardBootstrapper.ts src/dashboard/panels/__tests__/
git commit -m "feat(dashboard): add Panel types, NavigationRegistry, and DashboardBootstrapper"
```

### Task 1.2: C3 — Create AIService interface and implementations

**Files:**
- Create: `src/background/ai/AIService.ts`
- Create: `src/background/ai/RemoteAIService.ts`
- Create: `src/background/ai/LocalAIService.ts`
- Create: `src/background/ai/FallbackAIService.ts`
- Create: `src/background/ai/__tests__/FallbackAIService.test.ts`

- [ ] **Step 1.2a: Write AIService interface**

```typescript
// src/background/ai/AIService.ts

export type AISummaryMode = 'full_pipeline' | 'local_only' | 'masked_cloud' | 'auto';

export interface AISummaryOptions {
  mode?: AISummaryMode;
  tagSummaryMode?: boolean;
  url?: string;
}

export interface AISummaryResult {
  summary: string;
  tags?: string[];
  /** Whether local AI was actually used (for telemetry) */
  usedLocal?: boolean;
}

export interface AIService {
  generateSummary(content: string, options?: AISummaryOptions): Promise<AISummaryResult>;
  /** Returns which modes this implementation supports */
  getSupportedModes(): AISummaryMode[];
}
```

- [ ] **Step 1.2b: Write FallbackAIService test**

```typescript
// src/background/ai/__tests__/FallbackAIService.test.ts

import { FallbackAIService } from '../FallbackAIService';
import { type AIService, type AISummaryResult } from '../AIService';

function mockAIService(results: Partial<AISummaryResult>): AIService {
  return {
    generateSummary: jest.fn().mockResolvedValue({ summary: 'test', ...results }),
    getSupportedModes: jest.fn().mockReturnValue(['full_pipeline']),
  };
}

describe('FallbackAIService', () => {
  test('uses local when available', async () => {
    const local = mockAIService({ summary: 'local summary', usedLocal: true });
    (local.getSupportedModes as jest.Mock).mockReturnValue(['local_only']);
    const remote = mockAIService({ summary: 'remote summary' });
    const fallback = new FallbackAIService({ local, remote });

    const result = await fallback.generateSummary('test content', { mode: 'auto' });
    expect(result.summary).toBe('local summary');
    expect(remote.generateSummary).not.toHaveBeenCalled();
  });

  test('falls back to remote when local unavailable', async () => {
    const local: AIService = {
      generateSummary: jest.fn().mockRejectedValue(new Error('unavailable')),
      getSupportedModes: jest.fn().mockReturnValue([]),
    };
    const remote = mockAIService({ summary: 'remote fallback' });
    const fallback = new FallbackAIService({ local, remote });

    const result = await fallback.generateSummary('test content', { mode: 'auto' });
    expect(result.summary).toBe('remote fallback');
  });

  test('explicit mode bypasses fallback logic', async () => {
    const local = mockAIService({ summary: 'local' });
    const remote = mockAIService({ summary: 'remote' });
    const fallback = new FallbackAIService({ local, remote });

    const result = await fallback.generateSummary('test', { mode: 'full_pipeline' });
    expect(result.summary).toBe('remote');
    expect(local.generateSummary).not.toHaveBeenCalled();
  });

  test('errors when both fail', async () => {
    const local: AIService = {
      generateSummary: jest.fn().mockRejectedValue(new Error('local down')),
      getSupportedModes: jest.fn().mockReturnValue([]),
    };
    const remote: AIService = {
      generateSummary: jest.fn().mockRejectedValue(new Error('remote down')),
      getSupportedModes: jest.fn().mockReturnValue([]),
    };
    const fallback = new FallbackAIService({ local, remote });
    await expect(fallback.generateSummary('test', { mode: 'auto' })).rejects.toThrow();
  });

  test('getSupportedModes returns union of both', () => {
    const local = mockAIService();
    const remote = mockAIService();
    (local.getSupportedModes as jest.Mock).mockReturnValue(['local_only']);
    (remote.getSupportedModes as jest.Mock).mockReturnValue(['full_pipeline', 'masked_cloud']);
    const fallback = new FallbackAIService({ local, remote });
    const modes = fallback.getSupportedModes();
    expect(modes).toContain('local_only');
    expect(modes).toContain('full_pipeline');
    expect(modes).toContain('masked_cloud');
  });
});
```

- [ ] **Step 1.2c: Run tests to verify they fail**

Run: `npx jest src/background/ai/__tests__/FallbackAIService.test.ts`
Expected: FAIL

- [ ] **Step 1.2d: Implement FallbackAIService**

```typescript
// src/background/ai/FallbackAIService.ts

import { type AIService, type AISummaryOptions, type AISummaryResult, type AISummaryMode } from './AIService';

interface FallbackConfig {
  local: AIService;
  remote: AIService;
}

export class FallbackAIService implements AIService {
  constructor(private config: FallbackConfig) {}

  async generateSummary(content: string, options?: AISummaryOptions): Promise<AISummaryResult> {
    const mode = options?.mode ?? 'full_pipeline';

    if (mode === 'local_only') {
      return this.config.local.generateSummary(content, options);
    }

    if (mode === 'full_pipeline' || mode === 'masked_cloud') {
      return this.config.remote.generateSummary(content, options);
    }

    // mode === 'auto': try local, fall back to remote
    try {
      return await this.config.local.generateSummary(content, options);
    } catch {
      return this.config.remote.generateSummary(content, options);
    }
  }

  getSupportedModes(): AISummaryMode[] {
    const localModes = this.config.local.getSupportedModes();
    const remoteModes = this.config.remote.getSupportedModes();
    return [...new Set([...localModes, ...remoteModes])];
  }
}
```

- [ ] **Step 1.2e: Run tests to verify they pass**

Run: `npx jest src/background/ai/__tests__/FallbackAIService.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 1.2f: Implement RemoteAIService**

```typescript
// src/background/ai/RemoteAIService.ts

import { type AIService, type AISummaryOptions, type AISummaryResult, type AISummaryMode } from './AIService';
// Note: imports the existing AIClient. Wraps it behind the AIService interface.
// The actual AIClient import path will be resolved during implementation
// when we trace how AIClient is currently constructed.

interface RemoteAIServiceConfig {
  aiClient: {
    generateSummary(content: string, tagSummaryMode?: boolean, url?: string): Promise<AISummaryResult>;
  };
}

export class RemoteAIService implements AIService {
  constructor(private config: RemoteAIServiceConfig) {}

  async generateSummary(content: string, options?: AISummaryOptions): Promise<AISummaryResult> {
    return this.config.aiClient.generateSummary(
      content,
      options?.tagSummaryMode,
      options?.url,
    );
  }

  getSupportedModes(): AISummaryMode[] {
    return ['full_pipeline', 'masked_cloud'];
  }
}
```

- [ ] **Step 1.2g: Implement LocalAIService**

```typescript
// src/background/ai/LocalAIService.ts

import { type AIService, type AISummaryOptions, type AISummaryResult, type AISummaryMode } from './AIService';

interface LocalAIServiceConfig {
  localAiClient: {
    summarizeLocally(content: string): Promise<AISummaryResult>;
    getLocalAvailability(): Promise<boolean>;
  };
  /** Callback to ensure offscreen document is ready */
  ensureOffscreenDocument?(): Promise<void>;
}

export class LocalAIService implements AIService {
  constructor(private config: LocalAIServiceConfig) {}

  async generateSummary(content: string, options?: AISummaryOptions): Promise<AISummaryResult> {
    if (this.config.ensureOffscreenDocument) {
      await this.config.ensureOffscreenDocument();
    }
    return this.config.localAiClient.summarizeLocally(content);
  }

  getSupportedModes(): AISummaryMode[] {
    return ['local_only'];
  }
}
```

- [ ] **Step 1.2h: Commit**

```bash
git add src/background/ai/
git commit -m "feat(ai): add AIService interface, Remote/Local/Fallback implementations"
```

---

### Task 1.3: C4 — Create MessageHandlerRegistry and createBackgroundServices

**Files:**
- Create: `src/background/handlers/MessageHandlerRegistry.ts`
- Create: `src/background/handlers/__tests__/MessageHandlerRegistry.test.ts`
- Create: `src/background/createBackgroundServices.ts`

- [ ] **Step 1.3a: Write MessageHandlerRegistry test**

```typescript
// src/background/handlers/__tests__/MessageHandlerRegistry.test.ts

import { MessageHandlerRegistry } from '../MessageHandlerRegistry';

describe('MessageHandlerRegistry', () => {
  let registry: MessageHandlerRegistry;

  beforeEach(() => {
    registry = new MessageHandlerRegistry();
  });

  test('register and dispatch a handler', () => {
    const handler = jest.fn().mockReturnValue(false);
    registry.register('VALID_VISIT' as any, handler);

    const sendResponse = jest.fn();
    const result = registry.dispatch('VALID_VISIT' as any, { type: 'VALID_VISIT' }, {} as any, sendResponse);

    expect(handler).toHaveBeenCalledWith({ type: 'VALID_VISIT' }, {}, sendResponse);
    expect(result).toBe(false);
  });

  test('unknown message type returns error', () => {
    const sendResponse = jest.fn();
    const result = registry.dispatch('UNKNOWN' as any, { type: 'UNKNOWN' }, {} as any, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    expect(result).toBe(false);
  });

  test('duplicate registration throws', () => {
    const handler = jest.fn();
    registry.register('TEST' as any, handler);
    expect(() => registry.register('TEST' as any, handler)).toThrow('Duplicate handler');
  });

  test('async handler returns true to keep channel open', () => {
    const handler = jest.fn().mockReturnValue(true);
    registry.register('ASYNC_TEST' as any, handler);

    const sendResponse = jest.fn();
    const result = registry.dispatch('ASYNC_TEST' as any, { type: 'ASYNC_TEST' }, {} as any, sendResponse);

    expect(result).toBe(true);
  });
});
```

- [ ] **Step 1.3b: Run tests to verify they fail**

Run: `npx jest src/background/handlers/__tests__/MessageHandlerRegistry.test.ts`
Expected: FAIL

- [ ] **Step 1.3c: Implement MessageHandlerRegistry**

```typescript
// src/background/handlers/MessageHandlerRegistry.ts

export type MessageHandler = (
  message: Record<string, unknown>,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: Record<string, unknown>) => void,
) => boolean;

export class MessageHandlerRegistry {
  private handlers = new Map<string, MessageHandler>();

  register(type: string, handler: MessageHandler): void {
    if (this.handlers.has(type)) {
      throw new Error(`Duplicate handler for message type: ${type}`);
    }
    this.handlers.set(type, handler);
  }

  dispatch(
    type: string,
    message: Record<string, unknown>,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: Record<string, unknown>) => void,
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

- [ ] **Step 1.3d: Run tests to verify they pass**

Run: `npx jest src/background/handlers/__tests__/MessageHandlerRegistry.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 1.3e: Implement createBackgroundServices**

```typescript
// src/background/createBackgroundServices.ts

import { ObsidianClient } from './obsidianClient';
import { SqliteClient } from './sqliteClient';
import { RecordingLogic } from './recordingLogic';
import { type ITabCache } from './TabCache';
import { RateLimiter } from './rateLimiter';
import { ManualContentFetcher } from './manualContentFetcher';
// Note: exact import paths verified against existing code during implementation

export interface BackgroundServices {
  obsidian: ObsidianClient;
  sqliteClient: SqliteClient;
  recordingLogic: RecordingLogic;
  tabCache: ITabCache;
  rateLimiter: RateLimiter;
  manualContentFetcher: ManualContentFetcher;
}

export function createBackgroundServices(): BackgroundServices {
  const obsidian = new ObsidianClient();
  const sqliteClient = new SqliteClient();
  const tabCache: ITabCache = { /* existing TabCache construction */ } as ITabCache;
  const rateLimiter = new RateLimiter();
  const manualContentFetcher = new ManualContentFetcher();

  const recordingLogic = new RecordingLogic({
    obsidian,
    sqliteClient,
    tabCache,
    rateLimiter,
  });

  return {
    obsidian,
    sqliteClient,
    recordingLogic,
    tabCache,
    rateLimiter,
    manualContentFetcher,
  };
}
```

> **Note at Step 1.3e**: The exact constructor signatures for `ObsidianClient`, `SqliteClient`, `RecordingLogic`, `TabCache`, `RateLimiter`, and `ManualContentFetcher` must be verified against the existing code. Read each class's constructor to determine required arguments and adapt the `createBackgroundServices` implementation accordingly. The interface types are the stable contract; constructor details may vary.

- [ ] **Step 1.3f: Commit**

```bash
git add src/background/handlers/MessageHandlerRegistry.ts src/background/handlers/__tests__/ src/background/createBackgroundServices.ts
git commit -m "feat(sw): add MessageHandlerRegistry and createBackgroundServices"
```

---

### Task 1.4: C5 — Create BrowsingLogRecordMapper

**Files:**
- Create: `src/background/pipeline/mappers/BrowsingLogRecordMapper.ts`
- Create: `src/background/pipeline/mappers/__tests__/BrowsingLogRecordMapper.test.ts`

- [ ] **Step 1.4a: Read existing context and record types**

Read `src/background/pipeline/types.ts` for `RecordingContext` shape.
Read `src/utils/storage/types.ts` (or wherever `BrowsingLogRecord` is defined) for the record schema.
Read `src/background/pipeline/RecordingPipeline.ts` lines 155-223 for the current inline mapping logic.

- [ ] **Step 1.4b: Write mapper test**

```typescript
// src/background/pipeline/mappers/__tests__/BrowsingLogRecordMapper.test.ts

import { mapToBrowsingLogRecord } from '../BrowsingLogRecordMapper';
import { type RecordingContext } from '../../types';

describe('BrowsingLogRecordMapper', () => {
  const baseContext: RecordingContext = {
    recordId: 'rec-1',
    url: 'https://example.com/page',
    title: 'Example Page',
    visitedAt: 1700000000000,
    duration: 120,
    scrollDepth: 75,
    truncatedContent: 'Some page content with email test@example.com',
    sanitizedSummary: 'Summary text',
    extractedTags: ['tag1', 'tag2'],
    isDomainAllowed: true,
    // Fill remaining required fields from RecordingContext type
  } as RecordingContext;

  test('maps all fields from context to record', () => {
    const record = mapToBrowsingLogRecord(baseContext);
    expect(record.url).toBe('https://example.com/page');
    expect(record.title).toBe('Example Page');
    expect(record.domain).toBe('example.com');
    expect(record.visited_at).toBe(1700000000000);
    expect(record.duration).toBe(120);
    expect(record.scroll_depth).toBe(75);
    expect(record.summary).toBe('Summary text');
    expect(record.tags).toEqual(['tag1', 'tag2']);
  });

  test('extracts domain from url', () => {
    const ctx = { ...baseContext, url: 'https://sub.example.co.jp/path?q=1' };
    const record = mapToBrowsingLogRecord(ctx);
    expect(record.domain).toBe('sub.example.co.jp');
  });

  test('handles missing optional fields', () => {
    const ctx = {
      ...baseContext,
      title: undefined,
      truncatedContent: undefined,
      sanitizedSummary: undefined,
      extractedTags: undefined,
    } as unknown as RecordingContext;
    const record = mapToBrowsingLogRecord(ctx);
    expect(record.title).toBe('');
    expect(record.content).toBe('');
    expect(record.summary).toBe('');
    expect(record.tags).toEqual([]);
  });

  test('content field is empty when content storage disabled', () => {
    // If contentStorageEnabled flag is false, content should be empty
    const ctx = { ...baseContext, contentStorageEnabled: false } as unknown as RecordingContext;
    const record = mapToBrowsingLogRecord(ctx);
    expect(record.content).toBe('');
  });
});
```

- [ ] **Step 1.4c: Run tests to verify they fail**

Run: `npx jest src/background/pipeline/mappers/__tests__/BrowsingLogRecordMapper.test.ts`
Expected: FAIL

- [ ] **Step 1.4d: Implement BrowsingLogRecordMapper**

```typescript
// src/background/pipeline/mappers/BrowsingLogRecordMapper.ts

import { type RecordingContext } from '../types';
import { type BrowsingLogRecord } from '../../../utils/storage/types';

/**
 * Maps the accumulated RecordingContext to a BrowsingLogRecord.
 * Pure function — no side effects, no storage access, no chrome APIs.
 */
export function mapToBrowsingLogRecord(context: RecordingContext): BrowsingLogRecord {
  return {
    url: context.url,
    title: context.title ?? '',
    domain: extractDomain(context.url),
    visited_at: context.visitedAt ?? Date.now(),
    duration: context.duration ?? 0,
    scroll_depth: context.scrollDepth ?? 0,
    content: context.contentStorageEnabled !== false ? (context.truncatedContent ?? '') : '',
    summary: context.sanitizedSummary ?? '',
    tags: context.extractedTags ?? [],
    reading_time: context.readingTime ?? 0,
    is_domain_allowed: context.isDomainAllowed ?? true,
    // Map remaining fields from context. Field names in BrowsingLogRecord
    // use snake_case; context uses camelCase. Verify exact mapping against
    // the existing inline code in RecordingPipeline.ts:155-223.
  };
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}
```

> **Note at Step 1.4d**: After reading `RecordingContext` and `BrowsingLogRecord` type definitions in Step 1.4a, update the mapper to include all fields. The existing inline mapping in `RecordingPipeline.ts:155-223` is the authoritative source for field correspondence.

- [ ] **Step 1.4e: Run tests to verify they pass**

Run: `npx jest src/background/pipeline/mappers/__tests__/BrowsingLogRecordMapper.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 1.4f: Commit**

```bash
git add src/background/pipeline/mappers/
git commit -m "feat(pipeline): extract BrowsingLogRecordMapper from RecordingPipeline"
```

---

### Task 1.5: C5 — Create MarkdownBufferManager

**Files:**
- Create: `src/background/pipeline/buffers/MarkdownBufferManager.ts`
- Create: `src/background/pipeline/buffers/__tests__/MarkdownBufferManager.test.ts`

- [ ] **Step 1.5a: Read existing markdown step**

Read `src/background/pipeline/steps/saveLocalMarkdownStep.ts` to understand:
- What alarm name is used for daily flush
- What storage key the buffer uses
- The shape of a `MarkdownEntry`

- [ ] **Step 1.5b: Write MarkdownBufferManager test**

```typescript
// src/background/pipeline/buffers/__tests__/MarkdownBufferManager.test.ts

import { MarkdownBufferManager } from '../MarkdownBufferManager';

interface MarkdownEntry {
  visitedAt: number;
  url: string;
  title: string;
  markdown: string;
}

// Mock chrome APIs
const mockChromeStorage = {
  local: {
    get: jest.fn().mockResolvedValue({}),
    set: jest.fn().mockResolvedValue(undefined),
  },
};
const mockChromeAlarms = {
  create: jest.fn(),
  clear: jest.fn(),
};

(global as any).chrome = {
  storage: mockChromeStorage,
  alarms: mockChromeAlarms,
};

describe('MarkdownBufferManager', () => {
  const alarmName = 'daily-markdown-flush';
  let manager: MarkdownBufferManager;

  beforeEach(() => {
    jest.clearAllMocks();
    manager = new MarkdownBufferManager({
      alarmName,
      storageKey: 'dailyMarkdownBuffer',
    });
  });

  test('add buffers an entry without writing to storage', () => {
    const entry: MarkdownEntry = {
      visitedAt: Date.now(),
      url: 'https://example.com',
      title: 'Test',
      markdown: '# Test',
    };
    manager.add(entry);
    expect(manager.count).toBe(1);
    expect(mockChromeStorage.local.set).not.toHaveBeenCalled();
  });

  test('flush writes all buffered entries to storage', async () => {
    manager.add({ visitedAt: 1, url: 'a', title: 'A', markdown: '#' });
    manager.add({ visitedAt: 2, url: 'b', title: 'B', markdown: '#' });
    await manager.flush();
    expect(mockChromeStorage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ dailyMarkdownBuffer: expect.any(Array) }),
    );
    expect(manager.count).toBe(0);
  });

  test('flush with empty buffer does not write', async () => {
    await manager.flush();
    expect(mockChromeStorage.local.set).not.toHaveBeenCalled();
  });

  test('scheduleDailyFlush creates a chrome alarm', () => {
    manager.scheduleDailyFlush(alarmName);
    expect(mockChromeAlarms.create).toHaveBeenCalledWith(
      alarmName,
      expect.objectContaining({ periodInMinutes: expect.any(Number) }),
    );
  });
});
```

- [ ] **Step 1.5c: Run tests to verify they fail**

Run: `npx jest src/background/pipeline/buffers/__tests__/MarkdownBufferManager.test.ts`
Expected: FAIL

- [ ] **Step 1.5d: Implement MarkdownBufferManager**

```typescript
// src/background/pipeline/buffers/MarkdownBufferManager.ts

interface MarkdownEntry {
  visitedAt: number;
  url: string;
  title: string;
  markdown: string;
}

interface MarkdownBufferConfig {
  alarmName: string;
  storageKey: string;
}

export class MarkdownBufferManager {
  private buffer: MarkdownEntry[] = [];
  private storageKey: string;
  private alarmName: string;

  constructor(config: MarkdownBufferConfig) {
    this.storageKey = config.storageKey;
    this.alarmName = config.alarmName;
  }

  add(entry: MarkdownEntry): void {
    this.buffer.push(entry);
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    // Merge with existing entries in storage (append mode)
    const existing = await chrome.storage.local.get(this.storageKey);
    const existingEntries: MarkdownEntry[] = existing[this.storageKey] ?? [];
    const combined = [...existingEntries, ...this.buffer];

    await chrome.storage.local.set({ [this.storageKey]: combined });
    this.buffer = [];
  }

  scheduleDailyFlush(alarmName?: string): void {
    const name = alarmName ?? this.alarmName;
    chrome.alarms.create(name, {
      periodInMinutes: 24 * 60, // daily
    });
  }

  get count(): number {
    return this.buffer.length;
  }
}
```

- [ ] **Step 1.5e: Run tests to verify they pass**

Run: `npx jest src/background/pipeline/buffers/__tests__/MarkdownBufferManager.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 1.5f: Commit**

```bash
git add src/background/pipeline/buffers/
git commit -m "feat(pipeline): extract MarkdownBufferManager from saveLocalMarkdownStep"
```

---

## Phase 2: Migration & Integration

### Task 2.1: C1 — Migrate DiagnosticPanel (simplest panels first)

**Files:**
- Create: `src/dashboard/panels/diagnostic/diagnosticsPanel.ts`
- Create: `src/dashboard/panels/diagnostic/exportLogsPanel.ts`
- Modify: `src/dashboard/dashboard.ts` (remove init calls)

- [ ] **Step 2.1a: Read existing diagnostics panel**

Read `src/dashboard/diagnosticsPanel.ts` to understand:
- What DOM elements it creates/appends to
- What event listeners it registers
- What data it loads from storage

- [ ] **Step 2.1b: Refactor diagnosticsPanel into descriptor**

```typescript
// src/dashboard/panels/diagnostic/diagnosticsPanel.ts

import { type DiagnosticPanel } from '../types';
// Import existing helper functions from the old diagnosticsPanel.ts

export const diagnosticsPanel: DiagnosticPanel = {
  id: 'panel-diagnostics',
  category: 'diagnostic',

  async mount(container: HTMLElement): Promise<void> {
    // Move the existing initDiagnosticsPanel logic here.
    // Replace direct DOM queries with container.querySelector().
    // Extract data-loading function calls; they stay the same.
    // Event listeners attach to elements within `container`.
  },

  async refresh(): Promise<void> {
    // Re-run data loading + re-render. Same as mount but without
    // creating new DOM structure (just updating values).
  },
};
```

- [ ] **Step 2.1c: Refactor exportLogsPanel into descriptor**

```typescript
// src/dashboard/panels/diagnostic/exportLogsPanel.ts

import { type DiagnosticPanel } from '../types';

export const exportLogsPanel: DiagnosticPanel = {
  id: 'panel-export-logs',
  category: 'diagnostic',

  async mount(container: HTMLElement): Promise<void> {
    // Move initExportLogsPanel logic here
  },

  async refresh(): Promise<void> {
    // Re-render log list
  },
};
```

- [ ] **Step 2.1d: Add E2E test for diagnostics panel**

Add to `testDir/e2e/`:

```typescript
// testDir/e2e/dashboard-diagnostics.spec.ts

import { test, expect } from '../fixtures/extension.fixture';

test.describe('Dashboard - Diagnostics Panel', () => {
  test('navigates to diagnostics and shows content', async ({ page, extensionId }) => {
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForLoadState('domcontentloaded');

    // Click diagnostics sidebar button
    await page.click('[data-panel="panel-diagnostics"]');

    // Verify panel is visible
    const panel = page.locator('#panel-diagnostics');
    await expect(panel).toBeVisible();

    // Verify key elements are present
    await expect(panel.locator('#diagTestObsidianBtn')).toBeVisible();
    await expect(panel.locator('#diagTestAiBtn')).toBeVisible();
  });
});
```

- [ ] **Step 2.1e: Run E2E test**

Run: `npx playwright test testDir/e2e/dashboard-diagnostics.spec.ts --project=extension`
Expected: PASS

- [ ] **Step 2.1f: Remove old init calls from dashboard.ts**

In `src/dashboard/dashboard.ts`, comment out or remove:
- `initDiagnosticsPanel()` call (line 1505)
- `initExportLogsPanel()` call (line 1501)

- [ ] **Step 2.1g: Wire into Bootstrapper**

In the new dashboard entry point (or temporary wiring in dashboard.ts), add:

```typescript
import { NavigationRegistry } from './panels/NavigationRegistry';
import { DashboardBootstrapper } from './panels/DashboardBootstrapper';
import { diagnosticsPanel } from './panels/diagnostic/diagnosticsPanel';
import { exportLogsPanel } from './panels/diagnostic/exportLogsPanel';

const registry = new NavigationRegistry();
const boot = new DashboardBootstrapper(registry);
boot.registerPanels([diagnosticsPanel, exportLogsPanel]);
boot.wireSidebar(document.getElementById('sidebar')!);
```

- [ ] **Step 2.1h: Commit**

```bash
git add src/dashboard/panels/diagnostic/ src/dashboard/dashboard.ts testDir/e2e/dashboard-diagnostics.spec.ts
git commit -m "refactor(dashboard): migrate diagnostics and export-logs to DiagnosticPanel descriptors"
```

---

### Task 2.2: C1 — Migrate AsyncDataPanels (history panels + tagCluster + domainSearch + auditLog)

This task follows the same pattern as 2.1 but for 6 panels. Each panel migration is independent and can be parallelized.

**Pattern per panel:**

- [ ] Read existing panel code
- [ ] Create `src/dashboard/panels/asyncData/<name>Panel.ts` with `AsyncDataPanel` descriptor
- [ ] Add Playwright E2E test
- [ ] Remove old `init*()` call from `dashboard.ts`
- [ ] Register in Bootstrapper
- [ ] Commit

**Panels to migrate (in this order — independent of each other):**

| # | Panel | File | E2E test |
|---|-------|------|----------|
| 2.2a | auditLogPanel | `panels/asyncData/auditLogPanel.ts` | `dashboard-audit-log.spec.ts` |
| 2.2b | domainSearchPanel | `panels/asyncData/domainSearchPanel.ts` | `dashboard-domain-search.spec.ts` |
| 2.2c | historyPendingPanel | `panels/asyncData/historyPendingPanel.ts` | `dashboard-pending.spec.ts` |
| 2.2d | historyPanel | `panels/asyncData/historyPanel.ts` | `dashboard-history.spec.ts` |
| 2.2e | tagClusterPanel | `panels/asyncData/tagClusterPanel.ts` | `dashboard-tag-cluster.spec.ts` |
| 2.2f | sqliteHistoryPanel | `panels/asyncData/sqliteHistoryPanel.ts` | `dashboard-sqlite-history.spec.ts` |

> **Note for sqliteHistoryPanel**: This is the most complex panel (1141 lines). Pay special attention to the mount/unmount optimization (`isPanelMounted()` / `renderState()` vs `updateDynamicRegions()`). The `unmount()` method should clear event listeners and cancel debounce timers. The `onActivate(init?)` method should handle `searchTag` and `searchDomain` from `PanelInitMap`.

---

### Task 2.3: C1 — Migrate StaticFormPanels (11 panels)

Same pattern as 2.2 but with `StaticFormPanel` interface. Each panel migration is independent.

**Panels to migrate (in this order — independent of each other):**

| # | Panel | File |
|---|-------|------|
| 2.3a | generalSettingsPanel | `panels/staticForm/generalSettingsPanel.ts` |
| 2.3b | domainFilterPanel | `panels/staticForm/domainFilterPanel.ts` |
| 2.3c | promptSettingsPanel | `panels/staticForm/promptSettingsPanel.ts` |
| 2.3d | privacySettingsPanel | `panels/staticForm/privacySettingsPanel.ts` |
| 2.3e | contentSettingsPanel | `panels/staticForm/contentSettingsPanel.ts` |
| 2.3f | aiSummaryCleansingPanel | `panels/staticForm/aiSummaryCleansingPanel.ts` |
| 2.3g | trustSettingsPanel | `panels/staticForm/trustSettingsPanel.ts` |
| 2.3h | cspSettingsPanel | `panels/staticForm/cspSettingsPanel.ts` |
| 2.3i | tagsSettingsPanel | `panels/staticForm/tagsSettingsPanel.ts` |
| 2.3j | recordingConditionsPanel | `panels/staticForm/recordingConditionsPanel.ts` |
| 2.3k | exportImportPanel | `panels/staticForm/exportImportPanel.ts` |

---

### Task 2.4: C2 — Add data-storage-key attributes to HTML

**Files:**
- Modify: `entrypoints/options/index.html`
- Modify: `src/popup/popup.html`

- [ ] **Step 2.4a: List all settings inputs**

Read both HTML files and list every `<input>`, `<select>`, `<textarea>` that stores a setting value.

- [ ] **Step 2.4b: Add data-storage-key attributes**

For each settings input found, add `data-storage-key="<StorageKey.fieldName>"`. Example:

```html
<!-- Before -->
<input id="obsidianPort" type="number" value="27124">

<!-- After -->
<input id="obsidianPort" type="number" value="27124" data-storage-key="obsidianPort">
```

The `data-storage-key` value must match the camelCase field name used in settings objects (which corresponds to the StorageKeys constant name in lowerCamelCase).

- [ ] **Step 2.4c: Commit**

```bash
git add entrypoints/options/index.html src/popup/popup.html
git commit -m "feat(html): add data-storage-key attributes to all settings inputs"
```

---

### Task 2.5: C2 — Implement generic settingsFormBinding utilities

**Files:**
- Create: `src/utils/settingsFormBinding.ts`
- Create: `src/utils/__tests__/settingsFormBinding.test.ts`
- Modify: `src/popup/settingsUiHelper.ts` (replace manual logic)
- Modify: `src/dashboard/dashboard.ts` (remove getSettingsMapping)

- [ ] **Step 2.5a: Write settingsFormBinding tests**

```typescript
// src/utils/__tests__/settingsFormBinding.test.ts

import { loadSettingsToInputs, extractSettingsFromInputs } from '../settingsFormBinding';

describe('settingsFormBinding', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
  });

  describe('loadSettingsToInputs', () => {
    test('populates text input from settings', () => {
      container.innerHTML = '<input type="text" data-storage-key="obsidianPort">';
      loadSettingsToInputs(container, { obsidianPort: 27124 });
      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.value).toBe('27124');
    });

    test('populates checkbox from settings', () => {
      container.innerHTML = '<input type="checkbox" data-storage-key="domainFilterEnabled">';
      loadSettingsToInputs(container, { domainFilterEnabled: true });
      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.checked).toBe(true);
    });

    test('populates select from settings', () => {
      container.innerHTML = `
        <select data-storage-key="aiProvider">
          <option value="openai">OpenAI</option>
          <option value="gemini">Gemini</option>
        </select>`;
      loadSettingsToInputs(container, { aiProvider: 'gemini' });
      const select = container.querySelector('select') as HTMLSelectElement;
      expect(select.value).toBe('gemini');
    });

    test('skips elements without data-storage-key', () => {
      container.innerHTML = '<input type="text" id="plainInput">';
      expect(() => loadSettingsToInputs(container, {})).not.toThrow();
    });

    test('skips missing settings keys gracefully', () => {
      container.innerHTML = '<input type="text" data-storage-key="missingKey">';
      expect(() => loadSettingsToInputs(container, {})).not.toThrow();
    });
  });

  describe('extractSettingsFromInputs', () => {
    test('extracts text input value', () => {
      container.innerHTML = '<input type="text" data-storage-key="obsidianPort" value="27124">';
      const result = extractSettingsFromInputs(container);
      expect(result.obsidianPort).toBe('27124');
    });

    test('extracts checkbox boolean', () => {
      container.innerHTML = '<input type="checkbox" data-storage-key="enabled" checked>';
      const result = extractSettingsFromInputs(container);
      expect(result.enabled).toBe(true);
    });

    test('extracts number input as number', () => {
      container.innerHTML = '<input type="number" data-storage-key="port" value="27124">';
      const result = extractSettingsFromInputs(container);
      expect(result.port).toBe(27124);
    });

    test('skips masked API key fields', () => {
      container.innerHTML = '<input type="text" data-storage-key="geminiApiKey" value="••••••••">';
      const result = extractSettingsFromInputs(container);
      // API keys with masked values should not be extracted
      expect(result.geminiApiKey).toBeUndefined();
    });

    test('extracts unmasked API key fields', () => {
      container.innerHTML = '<input type="text" data-storage-key="geminiApiKey" value="sk-abc123">';
      const result = extractSettingsFromInputs(container);
      expect(result.geminiApiKey).toBe('sk-abc123');
    });
  });
});
```

- [ ] **Step 2.5b: Run tests to verify they fail**

Run: `npx jest src/utils/__tests__/settingsFormBinding.test.ts`
Expected: FAIL

- [ ] **Step 2.5c: Implement settingsFormBinding**

```typescript
// src/utils/settingsFormBinding.ts

const MASKED_PLACEHOLDER = '••••••••';

/**
 * Populate all form inputs in the container from a settings object.
 * Matches elements by data-storage-key attribute.
 */
export function loadSettingsToInputs(
  container: HTMLElement,
  settings: Record<string, unknown>,
): void {
  const inputs = container.querySelectorAll<HTMLElement>('[data-storage-key]');
  for (const el of inputs) {
    const key = el.getAttribute('data-storage-key');
    if (!key || !(key in settings)) continue;

    const value = settings[key];

    if (el instanceof HTMLInputElement) {
      if (el.type === 'checkbox') {
        el.checked = !!value;
      } else if (el.type === 'range') {
        el.value = String(value ?? '');
        // Dispatch input event for range display updates
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        el.value = String(value ?? '');
      }
    } else if (el instanceof HTMLSelectElement) {
      el.value = String(value ?? '');
    } else if (el instanceof HTMLTextAreaElement) {
      el.value = String(value ?? '');
    }
  }
}

/**
 * Extract all settings from form inputs in the container.
 * Matches elements by data-storage-key attribute.
 * API key fields with masked values are skipped.
 */
export function extractSettingsFromInputs(
  container: HTMLElement,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const inputs = container.querySelectorAll<HTMLElement>('[data-storage-key]');

  for (const el of inputs) {
    const key = el.getAttribute('data-storage-key');
    if (!key) continue;

    // Skip masked API key fields
    if (_isApiKeyField(key) && _isMasked(el)) continue;

    if (el instanceof HTMLInputElement) {
      if (el.type === 'checkbox') {
        result[key] = el.checked;
      } else if (el.type === 'number' || el.type === 'range') {
        result[key] = el.value === '' ? undefined : Number(el.value);
      } else {
        result[key] = el.value;
      }
    } else if (el instanceof HTMLSelectElement) {
      result[key] = el.value;
    } else if (el instanceof HTMLTextAreaElement) {
      result[key] = el.value;
    }
  }

  return result;
}

function _isApiKeyField(key: string): boolean {
  return /apiKey/i.test(key);
}

function _isMasked(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement) {
    return el.value === MASKED_PLACEHOLDER || el.value === '';
  }
  return false;
}
```

- [ ] **Step 2.5d: Run tests to verify they pass**

Run: `npx jest src/utils/__tests__/settingsFormBinding.test.ts`
Expected: PASS

- [ ] **Step 2.5e: Update settingsUiHelper.ts**

Replace `loadSettingsToInputs` and `extractSettingsFromInputs` in `src/popup/settingsUiHelper.ts` with re-exports from the new utility, or replace their implementations with calls to the generic versions. Remove `apiKeyFields` and the manual mapping logic.

- [ ] **Step 2.5f: Remove getSettingsMapping from dashboard.ts**

Delete `getSettingsMapping()` and `getDashboardElements()` from `src/dashboard/dashboard.ts`. Update `loadGeneralSettings` to use `loadSettingsToInputs(document.body, settings)`.

- [ ] **Step 2.5g: Commit**

```bash
git add src/utils/settingsFormBinding.ts src/utils/__tests__/settingsFormBinding.test.ts src/popup/settingsUiHelper.ts src/dashboard/dashboard.ts
git commit -m "refactor(settings): replace manual mapping with data-storage-key convention"
```

---

### Task 2.6: C3 — Refactor PrivacyPipeline to use AIService

**Files:**
- Modify: `src/background/pipeline/PrivacyPipeline.ts`

- [ ] **Step 2.6a: Read current PrivacyPipeline**

Read `src/background/pipeline/PrivacyPipeline.ts` to understand:
- How `context.aiClient` is currently used
- Where `summarizeLocally()` is called
- Where local availability is checked

- [ ] **Step 2.6b: Refactor to use AIService**

Replace `context.aiClient` (which had two shapes) with a single `aiService: AIService`. Replace:
- `context.aiClient.generateSummary(...)` → `aiService.generateSummary(content, { mode: 'full_pipeline' })`
- `context.aiClient.summarizeLocally(...)` → `aiService.generateSummary(content, { mode: 'local_only' })`
- Local availability check → handled by `FallbackAIService` internally (caller passes `mode: 'auto'`)

- [ ] **Step 2.6c: Update service-worker.ts composition**

In `service-worker.ts`, construct `FallbackAIService`:

```typescript
import { FallbackAIService } from './ai/FallbackAIService';
import { RemoteAIService } from './ai/RemoteAIService';
import { LocalAIService } from './ai/LocalAIService';

const aiService = new FallbackAIService({
  local: new LocalAIService({ localAiClient, ensureOffscreenDocument }),
  remote: new RemoteAIService({ aiClient }),
});
```

Pass `aiService` to `PrivacyPipeline` instead of the old `context.aiClient`.

- [ ] **Step 2.6d: Commit**

```bash
git add src/background/pipeline/PrivacyPipeline.ts src/background/service-worker.ts
git commit -m "refactor(ai): replace PrivacyPipeline direct AI calls with AIService interface"
```

---

### Task 2.7: C4 — Refactor handlers with narrowed dependencies

**Files:**
- Modify: `src/background/handlers/*.ts` (15 handler files)
- Modify: `src/background/service-worker.ts` (wire registry)

- [ ] **Step 2.7a: Refactor one handler as template**

Pick `validVisitHandler` as the first handler. Create:

```typescript
// src/background/handlers/validVisitHandler.ts

interface ValidVisitHandlerDeps {
  recordVisit: (data: RecordingData) => Promise<RecordingResult>;
  getCachedTab: (url: string) => CachedTab | undefined;
  setCachedTab: (url: string, tab: CachedTab) => void;
  checkRateLimit: (url: string) => boolean;
}

export function createValidVisitHandler(deps: ValidVisitHandlerDeps) {
  return async (
    message: ValidVisitMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: Record<string, unknown>) => void,
  ): Promise<boolean> => {
    try {
      const allowed = deps.checkRateLimit(message.url);
      if (!allowed) {
        sendResponse({ success: false, error: 'Rate limited' });
        return false;
      }

      const cached = deps.getCachedTab(message.url);
      if (cached) {
        deps.setCachedTab(message.url, { ...cached, lastVisit: Date.now() });
        sendResponse({ success: true, cached: true });
        return false;
      }

      const result = await deps.recordVisit(message.data);
      sendResponse({ success: true, data: result });
      return true; // async — keep channel open
    } catch (err) {
      sendResponse({ success: false, error: (err as Error).message });
      return false;
    }
  };
}
```

- [ ] **Step 2.7b: Repeat for all 15 handlers**

Each handler follows the same pattern:
1. Define a `*HandlerDeps` interface with only the methods the handler actually uses
2. Rewrite the factory function to accept `deps` instead of singleton objects
3. Adapt the internal logic to use `deps.methodName()` instead of `singleton.methodName()`

Handlers to refactor: validVisit, manualRecord, saveRecord, obsidianTest, aiTest, getSettings, saveSettings, dashboardSqlite, contentExtraction, gistBackup, exportImport, migrateUrlSet, checkObsidianStatus, getPendingPages, recordingConditions.

- [ ] **Step 2.7c: Wire registry in service-worker.ts**

Replace the 15-branch if-else chain:

```typescript
import { createValidVisitHandler } from './handlers/validVisitHandler';
// ... import all other handlers
import { MessageHandlerRegistry } from './handlers/MessageHandlerRegistry';
import { createBackgroundServices } from './createBackgroundServices';

const services = createBackgroundServices();
const registry = new MessageHandlerRegistry();

registry.register('VALID_VISIT', createValidVisitHandler({
  recordVisit: services.recordingLogic.record.bind(services.recordingLogic),
  getCachedTab: services.tabCache.get.bind(services.tabCache),
  setCachedTab: services.tabCache.set.bind(services.tabCache),
  checkRateLimit: services.rateLimiter.check.bind(services.rateLimiter),
}));
// ... register all other handlers

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  return registry.dispatch(message.type, message, sender, sendResponse);
});
```

- [ ] **Step 2.7d: Run existing tests**

Run: `npm test`
Expected: Existing tests pass (adapt if handler signatures changed)

- [ ] **Step 2.7e: Commit**

```bash
git add src/background/handlers/ src/background/service-worker.ts
git commit -m "refactor(sw): narrow handler dependencies and wire MessageHandlerRegistry"
```

---

### Task 2.8: C5 — Wire mapper and buffer manager into pipeline

**Files:**
- Modify: `src/background/pipeline/RecordingPipeline.ts`
- Modify: `src/background/pipeline/steps/saveLocalMarkdownStep.ts`

- [ ] **Step 2.8a: Replace inline mapper in RecordingPipeline**

In `src/background/pipeline/RecordingPipeline.ts`, replace lines 155-223 (inline `BrowsingLogRecord` construction) with:

```typescript
import { mapToBrowsingLogRecord } from './mappers/BrowsingLogRecordMapper';

// Inside createSaveSqliteStep():
createSaveSqliteStep() {
  return async (context: RecordingContext) => {
    const record = mapToBrowsingLogRecord(context);
    await saveSqliteStep({
      recordId: context.recordId,
      record,
      sqliteClient: this.sqliteClient,
    });
  };
}
```

- [ ] **Step 2.8b: Replace alarm and storage calls in saveLocalMarkdownStep**

In `src/background/pipeline/steps/saveLocalMarkdownStep.ts`, replace direct `chrome.alarms` and `chrome.storage.local` calls with `MarkdownBufferManager`:

```typescript
import { MarkdownBufferManager } from '../buffers/MarkdownBufferManager';

const markdownBuffer = new MarkdownBufferManager({
  alarmName: 'daily-markdown-flush',
  storageKey: 'dailyMarkdownBuffer',
});

// Replace inline chrome.alarms.create with:
markdownBuffer.scheduleDailyFlush();

// Replace inline chrome.storage.local.get/set with:
markdownBuffer.add(entry);
// ... and at flush time:
await markdownBuffer.flush();
```

- [ ] **Step 2.8c: Run mapper and buffer tests**

Run: `npx jest src/background/pipeline/mappers/ src/background/pipeline/buffers/`
Expected: ALL PASS

- [ ] **Step 2.8d: Commit**

```bash
git add src/background/pipeline/RecordingPipeline.ts src/background/pipeline/steps/saveLocalMarkdownStep.ts
git commit -m "refactor(pipeline): wire BrowsingLogRecordMapper and MarkdownBufferManager into pipeline"
```

---

## Phase 3: Cleanup

### Task 3.1: C1 — Delete old navigation and getDashboardElements

**Files:**
- Modify: `src/dashboard/dashboard.ts` (delete old code)

- [ ] **Step 3.1a: Verify all 18 panels migrated**

Run: `npm run type-check`
Expected: No errors

Confirm no remaining `init*()` calls in `dashboard.ts` that reference panels already migrated.

- [ ] **Step 3.1b: Delete initSidebarNav and initNavigation**

Remove both functions and their calls from `dashboard.ts`. The sidebar is now handled by `DashboardBootstrapper.wireSidebar()`.

- [ ] **Step 3.1c: Delete getDashboardElements**

Remove `getDashboardElements()` and all its references. Settings form handling is now done via `data-storage-key` convention.

- [ ] **Step 3.1d: Create main.ts entry point**

```typescript
// src/dashboard/main.ts

import { NavigationRegistry } from './panels/NavigationRegistry';
import { DashboardBootstrapper } from './panels/DashboardBootstrapper';
// Import all panel descriptors
import { diagnosticsPanel } from './panels/diagnostic/diagnosticsPanel';
import { exportLogsPanel } from './panels/diagnostic/exportLogsPanel';
import { sqliteHistoryPanel } from './panels/asyncData/sqliteHistoryPanel';
// ... all other panels

const registry = new NavigationRegistry();
const boot = new DashboardBootstrapper(registry);
boot.registerPanels([
  diagnosticsPanel,
  exportLogsPanel,
  sqliteHistoryPanel,
  // ... all panels
]);
boot.wireSidebar(document.getElementById('sidebar')!);
boot.start('panel-general');
```

Update `entrypoints/options/index.html` to reference `main.ts` instead of `dashboard.ts` (or keep `dashboard.ts` as the entry that delegates to `main.ts`).

- [ ] **Step 3.1e: Run full E2E suite**

Run: `npm run test:e2e`
Expected: All dashboard E2E tests pass

- [ ] **Step 3.1f: Commit**

```bash
git add src/dashboard/
git commit -m "refactor(dashboard): delete old nav systems and getDashboardElements"
```

---

### Task 3.2: C2 / C3 — Delete dead code

- [ ] **Step 3.2a: Delete interfaces/index.ts**

```bash
rm src/background/interfaces/index.ts
```

Verify: `grep -r "from.*interfaces" src/` returns zero results.

- [ ] **Step 3.2b: Delete dead imports from dashboard.ts**

Remove remaining popup imports from `dashboard.ts` that are now handled by `data-storage-key` convention or panel descriptors.

- [ ] **Step 3.2c: Commit**

```bash
git add -u
git commit -m "chore: delete dead interfaces/index.ts and unused popup imports from dashboard"
```

---

### Task 3.3: Final validation

- [ ] **Step 3.3a: Full type check**

Run: `npm run type-check`
Expected: No errors

- [ ] **Step 3.3b: Full unit test suite**

Run: `npm test`
Expected: ALL PASS

- [ ] **Step 3.3c: Full E2E suite**

Run: `npm run test:e2e`
Expected: ALL PASS

- [ ] **Step 3.3d: Build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 3.3e: Commit**

```bash
git add -A
git commit -m "chore: final validation — all tests pass, build succeeds"
```

---

## Task Dependency Graph

```
Phase 1 (ALL PARALLEL):
  1.1 (C1 types/registry) ─┐
  1.2 (C3 AIService)       ─┤
  1.3 (C4 registry/services)─┤── all independent
  1.4 (C5 mapper)          ─┤
  1.5 (C5 buffer mgr)      ─┘

Phase 2 (MOSTLY PARALLEL — after Phase 1):
  2.1 (C1 diagnostic panels)  ─┐
  2.2 (C1 async panels)       ─┤── independent of each other
  2.3 (C1 static form panels) ─┤── (each panel migration is independent)
                               ─┤
  2.4 (C2 HTML attrs) ──→ 2.5 ─┤── 2.4 must finish before 2.5
  2.6 (C3 pipeline refactor)  ─┤── independent (depends on 1.2 only)
  2.7 (C4 handler refactor)   ─┤── independent (depends on 1.3 only)
  2.8 (C5 pipeline wire)      ─┘── independent (depends on 1.4/1.5 only)

Phase 3 (AFTER all Phase 2 complete):
  3.1 (C1 nav cleanup)   ─┐
  3.2 (dead code delete)  ─┤── all must run in sequence
  3.3 (final validation)  ─┘
```

---

## Parallel Execution Strategy

For maximum parallelism, dispatch these as parallel workstreams:

**Workstream A (Dashboard UI)**: Tasks 1.1 → 2.1 → 2.2 → 2.3 → 3.1
**Workstream B (Settings)**: Tasks 2.4 → 2.5
**Workstream C (AI)**: Tasks 1.2 → 2.6
**Workstream D (Service Worker)**: Tasks 1.3 → 2.7
**Workstream E (Pipeline)**: Tasks 1.4 → 1.5 → 2.8
**Workstream F (Cleanup)**: Tasks 3.2 → 3.3

Workstreams A-E can run in parallel. Workstream F runs after all others complete.

Within Workstream A, panel migrations (2.1, 2.2, 2.3) can be further parallelized: each panel migration is independent.
