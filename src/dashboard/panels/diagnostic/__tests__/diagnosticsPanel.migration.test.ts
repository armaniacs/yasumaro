// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { diagnosticsCollector, type DiagnosticsSnapshot } from '../DiagnosticsCollector.js';
import { createDiagnosticsPanel } from '../diagnosticsPanel.js';
import type { PanelLifecycle } from '../../types.js';

vi.mock('../DiagnosticsCollector.js', () => ({
  diagnosticsCollector: {
    collect: vi.fn(),
  },
}));

function baseSnapshot(overrides: Partial<DiagnosticsSnapshot['sqlite']> = {}): DiagnosticsSnapshot {
  return {
    storage: { bytesUsedKb: '0', savedUrls: '0' },
    sqlite: {
      initialized: true,
      path: 'OPFS:/test.db',
      fallback: false,
      fts5: true,
      opfsMigrationV2Done: true,
      idbMigrationV2Done: true,
      ...overrides,
    },
    deficiencies: [],
    builtInAi: null,
    obsidian: { protocol: 'https', port: '27124', apiKey: '', dailyPath: '' },
    aiProviders: [],
    aiProviderDetails: [],
    extInfo: { version: '0.0.0', name: 'Yasumaro' },
    divergence: { dashboardDetectsOpfs: false, offscreenUsesFallback: false },
    settingsLoadFailed: false,
    debugMode: false,
  };
}

describe('diagnosticsPanel — legacy migration status', () => {
  let panel: PanelLifecycle;
  let container: HTMLDivElement;

  beforeEach(() => {
    if (!(global as unknown as Record<string, unknown>).chrome) {
      (global as unknown as Record<string, unknown>).chrome = {} as unknown as never;
    }
    const chromeAny = (global as unknown as { chrome: Record<string, unknown> }).chrome as Record<string, unknown>;
    const runtime = (chromeAny.runtime as Record<string, unknown>) || {};
    runtime.getManifest = vi.fn(() => ({ version: '0.0.0', name: 'Yasumaro', manifest_version: 3 }));
    chromeAny.runtime = runtime as unknown as typeof chromeAny.runtime;

    vi.mocked(diagnosticsCollector).collect.mockReset();

    panel = createDiagnosticsPanel();
    container = document.createElement('div');
    container.id = 'panel-diagnostics';
    container.innerHTML = `
      <div id="diagStorageStats"></div>
      <div id="diagExtInfo"></div>
      <div id="diagObsidianSettings"></div>
      <div id="diagAiSettings"></div>
      <div id="diagConnectionResult"></div>
      <div id="diagSqliteStats"></div>
      <div id="diagDeficiencyStats"></div>
      <div id="diagBuiltInAiStats"></div>
      <button id="diagBuiltInAiDownloadBtn"></button>
      <div id="diagCompileOptionsStats"></div>
      <div id="diagDivergenceWarning"></div>
      <div id="diagMigrationStats"></div>
      <div id="diagCompileOptionsSection"></div>
      <input id="diagDebugModeToggle" type="checkbox" />
      <button id="diagTestObsidianBtn"></button>
      <button id="diagTestAiBtn"></button>
      <button id="diagTestSqliteBtn"></button>
      <div id="diagSqliteResult"></div>
      <button id="diagOpfsSpikeBtn"></button>
      <div id="diagOpfsSpikeResult"></div>
      <button id="diagMigrateBtn"></button>
      <div id="diagMigrateResult"></div>
      <button id="diagBackfillBtn"></button>
      <div id="diagBackfillResult"></div>
      <button id="diagCleanupBtn"></button>
      <div id="diagCleanupResult"></div>
      <div id="diagBuiltInAiDownloadResult"></div>
    `;
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('shows completed when both migration flags are true', async () => {
    vi.mocked(diagnosticsCollector).collect.mockResolvedValue(baseSnapshot());

    await panel.mount(container);
    await panel.load?.();

    const migrationStats = container.querySelector('#diagMigrationStats');
    expect(migrationStats?.textContent).toContain('Completed');
  });

  it('shows not completed when either migration flag is false', async () => {
    vi.mocked(diagnosticsCollector).collect.mockResolvedValue(baseSnapshot({ idbMigrationV2Done: false }));

    await panel.mount(container);
    await panel.load?.();

    const migrationStats = container.querySelector('#diagMigrationStats');
    expect(migrationStats?.textContent).toContain('Not completed');
  });

  it('shows unavailable when sqlite status is null', async () => {
    vi.mocked(diagnosticsCollector).collect.mockResolvedValue({
      ...baseSnapshot(),
      sqlite: null,
    });

    await panel.mount(container);
    await panel.load?.();

    const migrationStats = container.querySelector('#diagMigrationStats');
    expect(migrationStats?.textContent).toContain('Failed to check');
  });
});
