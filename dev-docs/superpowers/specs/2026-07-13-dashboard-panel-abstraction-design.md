# C1: Dashboard Panel Abstraction — Design Spec

**Date:** 2026-07-13
**Scope:** Introduce typed Panel lifecycle abstractions, NavigationRegistry, and DashboardBootstrapper. Migrate 18 panels one-by-one from the monolithic `dashboard.ts`.

## Motivation

`dashboard.ts` is 1521 lines with 59 exports, 31 `init*()` calls, two competing navigation systems, a 50-field `getDashboardElements()` blob, and no teardown logic. The 5-Why deep-dig identified the root cause as **absence of a Panel abstraction** — the file is a dumpster, not an orchestrator.

## Decision

Introduce three category-specific Panel interfaces, an event-driven `NavigationRegistry`, and a `DashboardBootstrapper` composition root. Panels are plain objects that satisfy a typed contract; there is no inheritance.

### Panel Categories

| Category | Panels | Interface |
|----------|--------|-----------|
| **AsyncDataPanel** | sqliteHistory, history, historyPending, tagCluster, domainSearch, auditLog (6) | `mount(container)`, `loadData()`, `unmount?()`, `onActivate?(init?)`, `onDeactivate?()` |
| **StaticFormPanel** | general, domain, prompt, content, ai-summary-cleansing, trust, privacy, csp, tags, recording-conditions, export-import (11) | `mount(container)`, `refresh()`, `onActivate?()` |
| **DiagnosticPanel** | diagnostics, export-logs (2) | `mount(container)`, `refresh()` |

### Interfaces

```typescript
// src/dashboard/panels/types.ts

type Panel = AsyncDataPanel | StaticFormPanel | DiagnosticPanel;

interface AsyncDataPanel {
  readonly id: string;
  readonly category: 'async-data';
  mount(container: HTMLElement): void;
  loadData(): Promise<void>;
  unmount?(): void;
  onActivate?(init?: Record<string, unknown>): void;
  onDeactivate?(): void;
}

interface StaticFormPanel {
  readonly id: string;
  readonly category: 'static-form';
  mount(container: HTMLElement): Promise<void>;
  refresh(): Promise<void>;
  onActivate?(): void;
}

interface DiagnosticPanel {
  readonly id: string;
  readonly category: 'diagnostic';
  mount(container: HTMLElement): Promise<void>;
  refresh(): Promise<void>;
}

// Cross-panel communication: per-panel init types, aggregated here
interface PanelInitMap {
  'panel-sqlite-history'?: { searchTag?: string; searchDomain?: string };
  'panel-tag-cluster'?: { focusTag?: string };
}
```

### NavigationRegistry

```typescript
// src/dashboard/panels/NavigationRegistry.ts

class NavigationRegistry {
  register(panel: Panel): void;
  navigate<K extends keyof PanelInitMap>(panelId: K, init?: PanelInitMap[K]): void;
  get activeId(): string | null;
}
```

**Lifecycle on navigate**: `currentPanel.onDeactivate?.()` → DOM 非表示 → `nextPanel.onActivate?.(init)` → `nextPanel.loadData?.()` (AsyncDataPanel のみ)

### DashboardBootstrapper

```typescript
// src/dashboard/DashboardBootstrapper.ts

class DashboardBootstrapper {
  constructor(registry: NavigationRegistry);
  registerPanels(panels: Panel[]): void;
  wireSidebar(sidebarElement: HTMLElement): void;
  start(defaultPanelId?: string): Promise<void>;
}
```

`wireSidebar` reads existing `data-panel` attributes on sidebar buttons, delegates click → `registry.navigate()`. No new HTML attributes or DOM structure changes required.

### Migration Plan

1. Create `src/dashboard/panels/` directory with types, NavRegistry, Bootstrapper
2. Extract one panel at a time into its own file under `panels/{category}/`
3. Register in `Bootstrapper`, remove corresponding `init*()` from `dashboard.ts`
4. Add Playwright E2E test: navigate to panel → assert key elements visible → basic interaction
5. After all 18 panels migrated: delete `initSidebarNav()`, `initNavigation()`, `getDashboardElements()`
6. After all panels migrated: delete old `dashboard.ts` (entry switches to `main.ts`)

### Target File Structure

```
src/dashboard/
├── panels/
│   ├── types.ts
│   ├── NavigationRegistry.ts
│   ├── DashboardBootstrapper.ts
│   ├── asyncData/   (6 panels)
│   ├── staticForm/  (11 panels)
│   └── diagnostic/  (2 panels)
├── main.ts                   # new entry
└── dashboard.ts              # deprecated, removed after migration
```

### Tests

- **Unit**: `NavigationRegistry` lifecycle sequencing, `DashboardBootstrapper` registration order
- **Unit**: Each panel descriptor's methods called with correct container
- **E2E (Playwright)**: Per-panel: navigate → visibility → key interaction
- **No visual regression suite** — final one-time manual review after full migration

### Risks

- **Panel migration overhead**: 18 panels × (extract + test) is significant. Mitigation: simpler panels (DiagnosticPanel) migrate first to prove the pattern, complex ones (sqliteHistoryPanel) last.
- **Old nav interference**: Both old and new nav systems coexist during migration. Mitigation: `DashboardBootstrapper.wireSidebar` attaches click→`navigate()` on sidebar buttons. `initSidebarNav()` / `initNavigation()` are still called for panels not yet migrated — they skip buttons whose panel already has a descriptor (checked via `registry.activeId` or by removing `data-panel` from HTML as panels are migrated). Once all 18 panels have descriptors, both old nav functions are deleted entirely.
- **Cross-panel communication**: Tag → history search must survive migration. Mitigation: `PanelInitMap` + `navigate('panel-sqlite-history', { searchTag })` replaces the custom event → direct call chain.
