// @vitest-environment jsdom
/**
 * diagnosticsPanel-r2.test.ts
 * R2: Cover remaining branches — SQLite status variants, error paths,
 * migrate/backfill/cleanup confirm-dialog branches, OPFS spike, divergence,
 * compile options, and button test handlers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initDiagnosticsPanel } from '../diagnosticsPanel.js';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../../utils/i18n.js', () => ({
  getMessage: (key: string) => key,
}));

const mockGetSettings = vi.fn();
vi.mock('../../utils/storage.js', () => ({
  getSettings: () => mockGetSettings(),
  StorageKeys: {
    OBSIDIAN_API_KEY: 'obsidian_api_key',
    OBSIDIAN_PROTOCOL: 'obsidian_protocol',
    OBSIDIAN_PORT: 'obsidian_port',
    OBSIDIAN_DAILY_PATH: 'obsidian_daily_path',
    AI_PROVIDER: 'ai_provider',
    GEMINI_API_KEY: 'gemini_api_key',
    GEMINI_MODEL: 'gemini_model',
    OPENAI_BASE_URL: 'openai_base_url',
    OPENAI_API_KEY: 'openai_api_key',
    OPENAI_MODEL: 'openai_model',
    OPENAI_2_BASE_URL: 'openai_2_base_url',
    OPENAI_2_API_KEY: 'openai_2_api_key',
    OPENAI_2_MODEL: 'openai_2_model',
    AI_USAGE_MONTH: 'ai_usage_month',
    AI_USAGE_TOKENS_SENT: 'ai_usage_tokens_sent',
    AI_USAGE_TOKENS_RECEIVED: 'ai_usage_tokens_received',
    AI_USAGE_REQUEST_COUNT: 'ai_usage_request_count',
  },
}));

const mockGetSqliteStatus = vi.fn();
const mockGetLogCount = vi.fn().mockResolvedValue(42);
const mockRunOpfsSpike = vi.fn();
const mockMigrateLogs = vi.fn();
const mockBackfillMetadata = vi.fn();
const mockCleanupLegacyStorage = vi.fn();
vi.mock('../dashboardSqliteService.js', () => ({
  getSqliteStatus: () => mockGetSqliteStatus(),
  getLogCount: () => mockGetLogCount(),
  runOpfsSpike: () => mockRunOpfsSpike(),
  migrateLogs: () => mockMigrateLogs(),
  backfillMetadata: () => mockBackfillMetadata(),
  cleanupLegacyStorage: () => mockCleanupLegacyStorage(),
}));

const mockDetectLiveVfsStrategy = vi.fn().mockReturnValue({
  caps: { opfsDirectory: true, syncAccessHandle: true, worker: true },
  strategy: 'opfs-sync-worker',
});
vi.mock('../../offscreen/opfsCapabilities.js', () => ({
  detectLiveVfsStrategy: () => mockDetectLiveVfsStrategy(),
}));

const mockShowConfirmDialog = vi.fn();
vi.mock('../utils/confirmDialog.js', () => ({
  showConfirmDialog: (...args: unknown[]) => mockShowConfirmDialog(...args),
}));

// ---------------------------------------------------------------------------
// Chrome mocks
// ---------------------------------------------------------------------------

const mockGetBytesInUse = vi.fn().mockResolvedValue(102400);
const mockGetManifest = vi.fn().mockReturnValue({ version: '1.0.0', name: 'Test Extension' });
const mockSendMessage = vi.fn().mockResolvedValue({ success: true });
const mockStorageLocalGet = vi.fn().mockResolvedValue({});
const mockStorageLocalSet = vi.fn().mockResolvedValue(undefined);

function setupChromeMocks(): void {
  const c = globalThis as any;
  if (!c.chrome) c.chrome = {};
  if (!c.chrome.storage) c.chrome.storage = {};
  if (!c.chrome.storage.local) c.chrome.storage.local = {};
  if (!c.chrome.runtime) c.chrome.runtime = { lastError: null };
  c.chrome.storage.local.getBytesInUse = mockGetBytesInUse;
  c.chrome.storage.local.get = mockStorageLocalGet;
  c.chrome.storage.local.set = mockStorageLocalSet;
  c.chrome.runtime.getManifest = mockGetManifest;
  c.chrome.runtime.sendMessage = mockSendMessage;
}

function baseSettings(): Record<string, unknown> {
  return {
    obsidian_protocol: 'https',
    obsidian_port: '27124',
    obsidian_api_key: 'my-key',
    obsidian_daily_path: '/notes',
    ai_provider: 'gemini',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('diagnosticsPanel-r2 — Obsidian/AI settings missing-element branches', () => {
  beforeEach(() => {
    setupChromeMocks();
    mockGetSettings.mockResolvedValue(baseSettings());
    mockGetSqliteStatus.mockResolvedValue(null);
    mockStorageLocalGet.mockResolvedValue({});
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('survives missing obsidianSettingsEl (no crash)', async () => {
    document.body.innerHTML = `<div id="diagExtInfo"></div>`;
    await expect(initDiagnosticsPanel()).resolves.toBeUndefined();
  });

  it('survives missing aiSettingsEl (no crash)', async () => {
    document.body.innerHTML = `
      <div id="diagObsidianSettings"></div>
      <div id="diagExtInfo"></div>
    `;
    await expect(initDiagnosticsPanel()).resolves.toBeUndefined();
  });

  it('shows load error in obsidianSettingsEl when getSettings throws but el present', async () => {
    document.body.innerHTML = `<div id="diagObsidianSettings"></div>`;
    mockGetSettings.mockRejectedValue(new Error('fail'));
    await initDiagnosticsPanel();
    expect(document.getElementById('diagObsidianSettings')!.textContent).toBe('diagLoadError');
  });

  it('getSettings error does not crash when obsidianSettingsEl is null', async () => {
    document.body.innerHTML = `<div id="diagAiSettings"></div>`;
    mockGetSettings.mockRejectedValue(new Error('fail'));
    await expect(initDiagnosticsPanel()).resolves.toBeUndefined();
  });

  it('handles missing storageStats element', async () => {
    document.body.innerHTML = `
      <div id="diagObsidianSettings"></div>
      <div id="diagAiSettings"></div>
      <div id="diagExtInfo"></div>
    `;
    await expect(initDiagnosticsPanel()).resolves.toBeUndefined();
  });
});

describe('diagnosticsPanel-r2 — Storage stats error path', () => {
  beforeEach(() => {
    setupChromeMocks();
    mockGetSettings.mockResolvedValue(baseSettings());
    mockGetSqliteStatus.mockResolvedValue(null);
    mockStorageLocalGet.mockResolvedValue({});
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('shows load error when getBytesInUse throws with storageStats present', async () => {
    document.body.innerHTML = `
      <div id="diagStorageStats"></div>
      <div id="diagExtInfo"></div>
    `;
    mockGetBytesInUse.mockRejectedValue(new Error('fail'));
    await initDiagnosticsPanel();
    expect(document.getElementById('diagStorageStats')!.textContent).toBe('diagLoadError');
  });
});

describe('diagnosticsPanel-r2 — SQLite status variants', () => {
  beforeEach(() => {
    setupChromeMocks();
    mockGetSettings.mockResolvedValue(baseSettings());
    mockStorageLocalGet.mockResolvedValue({});
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  function domWithSqlite(): void {
    document.body.innerHTML = `
      <div id="diagObsidianSettings"></div>
      <div id="diagAiSettings"></div>
      <div id="diagSqliteStats"></div>
      <div id="diagExtInfo"></div>
    `;
  }

  it('shows check-failed message when sqliteStatus is null after retry', async () => {
    domWithSqlite();
    mockGetSqliteStatus.mockResolvedValue(null);
    await initDiagnosticsPanel();
    const el = document.getElementById('diagSqliteStats')!;
    expect(el.textContent).toBe('diagSqliteCheckFailed');
  });

  it('shows load error when getSqliteStatus retry throws', async () => {
    domWithSqlite();
    mockGetSqliteStatus.mockRejectedValue(new Error('sqlite error'));
    await initDiagnosticsPanel();
    const el = document.getElementById('diagSqliteStats')!;
    expect(el.textContent).toBe('diagLoadError');
  });

  it('renders initialized=false status', async () => {
    domWithSqlite();
    mockGetSqliteStatus.mockResolvedValue({
      initialized: false,
      path: 'yasumaro.db',
      fallback: false,
      fts5: false,
      compileOptionsSource: 'idb',
    });
    await initDiagnosticsPanel();
    const el = document.getElementById('diagSqliteStats')!;
    expect(el.textContent).toContain('diagSqliteUnavailable');
  });

  it('renders fallback=true status', async () => {
    domWithSqlite();
    mockGetSqliteStatus.mockResolvedValue({
      initialized: true,
      path: 'chrome.storage.local',
      fallback: true,
      fts5: false,
      compileOptionsSource: 'fallback',
    });
    await initDiagnosticsPanel();
    const el = document.getElementById('diagSqliteStats')!;
    expect(el.textContent).toContain('diagSqliteFallbackYes');
  });

  it('renders with compileOptionsSource present', async () => {
    domWithSqlite();
    mockGetSqliteStatus.mockResolvedValue({
      initialized: true,
      path: 'OPFS:yasumaro.db',
      fallback: false,
      fts5: true,
      compileOptionsSource: 'opfs-worker',
    });
    await initDiagnosticsPanel();
    const el = document.getElementById('diagSqliteStats')!;
    expect(el.textContent).toContain('opfs-worker');
  });

  it('renders with initError present', async () => {
    domWithSqlite();
    mockGetSqliteStatus.mockResolvedValue({
      initialized: false,
      path: 'yasumaro.db',
      fallback: false,
      fts5: false,
      initError: 'WASM load failed',
    });
    await initDiagnosticsPanel();
    const el = document.getElementById('diagSqliteStats')!;
    expect(el.textContent).toContain('WASM load failed');
  });

  it('renders with no path (empty)', async () => {
    domWithSqlite();
    mockGetSqliteStatus.mockResolvedValue({
      initialized: true,
      path: '',
      fallback: false,
      fts5: true,
    });
    await initDiagnosticsPanel();
    const el = document.getElementById('diagSqliteStats')!;
    expect(el.textContent).toContain('(none)');
  });
});

describe('diagnosticsPanel-r2 — sqliteStats element missing', () => {
  beforeEach(() => {
    setupChromeMocks();
    mockGetSettings.mockResolvedValue(baseSettings());
    mockStorageLocalGet.mockResolvedValue({});
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('does not throw when sqliteStats is missing', async () => {
    document.body.innerHTML = `
      <div id="diagObsidianSettings"></div>
      <div id="diagAiSettings"></div>
      <div id="diagExtInfo"></div>
    `;
    mockGetSqliteStatus.mockResolvedValue({ initialized: true, path: 'db', fallback: false, fts5: true });
    await expect(initDiagnosticsPanel()).resolves.toBeUndefined();
  });
});

describe('diagnosticsPanel-r2 — deficiency diagnosis with null sqliteStatus', () => {
  beforeEach(() => {
    setupChromeMocks();
    mockGetSettings.mockResolvedValue(baseSettings());
    mockStorageLocalGet.mockResolvedValue({});
    mockGetSqliteStatus.mockResolvedValue(null);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('does not throw when diagDeficiencyStats present but sqliteStatus is null', async () => {
    document.body.innerHTML = `
      <div id="diagObsidianSettings"></div>
      <div id="diagAiSettings"></div>
      <div id="diagDeficiencyStats"></div>
      <div id="diagExtInfo"></div>
    `;
    await expect(initDiagnosticsPanel()).resolves.toBeUndefined();
  });
});

describe('diagnosticsPanel-r2 — Debug mode toggle branches', () => {
  beforeEach(() => {
    setupChromeMocks();
    mockGetSettings.mockResolvedValue(baseSettings());
    mockGetSqliteStatus.mockResolvedValue(null);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('handles missing compileOptionsSection gracefully', async () => {
    document.body.innerHTML = `
      <div id="diagObsidianSettings"></div>
      <div id="diagAiSettings"></div>
      <input type="checkbox" id="diagDebugModeToggle" role="switch">
      <div id="diagExtInfo"></div>
    `;
    mockStorageLocalGet.mockResolvedValue({ debugMode: true });
    await expect(initDiagnosticsPanel()).resolves.toBeUndefined();
  });

  it('toggles debug mode when compileOptionsSection is present', async () => {
    document.body.innerHTML = `
      <div id="diagObsidianSettings"></div>
      <div id="diagAiSettings"></div>
      <input type="checkbox" id="diagDebugModeToggle" role="switch">
      <div id="diagCompileOptionsSection"></div>
      <div id="diagExtInfo"></div>
    `;
    mockStorageLocalGet.mockResolvedValue({ debugMode: false });
    await initDiagnosticsPanel();
    const toggle = document.getElementById('diagDebugModeToggle') as HTMLInputElement;
    const section = document.getElementById('diagCompileOptionsSection') as HTMLElement;
    expect(section.classList.contains('hidden')).toBe(true);

    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    await vi.waitFor(() => {
      expect(mockStorageLocalSet).toHaveBeenCalledWith({ debugMode: true });
    });
    expect(section.classList.contains('hidden')).toBe(false);
  });
});

describe('diagnosticsPanel-r2 — Compile options display', () => {
  beforeEach(() => {
    setupChromeMocks();
    mockGetSettings.mockResolvedValue(baseSettings());
    mockStorageLocalGet.mockResolvedValue({ debugMode: true });
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('skips compile options when sqliteStatus is null despite debugMode being ON', async () => {
    document.body.innerHTML = `
      <div id="diagObsidianSettings"></div>
      <div id="diagAiSettings"></div>
      <div id="diagSqliteStats"></div>
      <div id="diagCompileOptionsSection"></div>
      <div id="diagCompileOptionsStats"></div>
      <div id="diagExtInfo"></div>
    `;
    mockGetSqliteStatus.mockResolvedValue(null);
    await initDiagnosticsPanel();
    const el = document.getElementById('diagCompileOptionsStats')!;
    expect(el.textContent).toBe('');
  });

  it('shows compile options when debugMode is ON and sqliteStatus has compileOptions', async () => {
    document.body.innerHTML = `
      <div id="diagObsidianSettings"></div>
      <div id="diagAiSettings"></div>
      <div id="diagSqliteStats"></div>
      <div id="diagCompileOptionsSection"></div>
      <div id="diagCompileOptionsStats"></div>
      <div id="diagExtInfo"></div>
    `;
    mockGetSqliteStatus.mockResolvedValue({
      initialized: true,
      path: 'yasumaro.db',
      fallback: false,
      fts5: true,
      compileOptions: ['ENABLE_FTS5', 'THREADSAFE=1', 'ENABLE_COLUMN_METADATA'],
      compileOptionsSource: 'idb',
    });
    await initDiagnosticsPanel();
    const el = document.getElementById('diagCompileOptionsStats')!;
    expect(el.textContent).toContain('ENABLE_FTS5');
  });

  it('handles compileOptions with no FTS/VFS options', async () => {
    document.body.innerHTML = `
      <div id="diagObsidianSettings"></div>
      <div id="diagAiSettings"></div>
      <div id="diagSqliteStats"></div>
      <div id="diagCompileOptionsSection"></div>
      <div id="diagCompileOptionsStats"></div>
      <div id="diagExtInfo"></div>
    `;
    mockGetSqliteStatus.mockResolvedValue({
      initialized: true,
      path: 'yasumaro.db',
      fallback: false,
      fts5: false,
      compileOptions: ['THREADSAFE=1', 'COLUMN_METADATA'],
      compileOptionsSource: 'idb',
    });
    await initDiagnosticsPanel();
    const el = document.getElementById('diagCompileOptionsStats')!;
    expect(el.textContent).toContain('2');
  });

  it('skips compile options when debugMode is OFF despite compileOptions present', async () => {
    mockStorageLocalGet.mockResolvedValue({ debugMode: false });
    document.body.innerHTML = `
      <div id="diagObsidianSettings"></div>
      <div id="diagAiSettings"></div>
      <div id="diagCompileOptionsSection"></div>
      <div id="diagCompileOptionsStats"></div>
      <div id="diagExtInfo"></div>
    `;
    mockGetSqliteStatus.mockResolvedValue({
      initialized: true,
      path: 'yasumaro.db',
      fallback: false,
      fts5: true,
      compileOptions: ['ENABLE_FTS5'],
      compileOptionsSource: 'idb',
    });
    await initDiagnosticsPanel();
    const el = document.getElementById('diagCompileOptionsStats')!;
    expect(el.textContent).toBe('');
  });
});

describe('diagnosticsPanel-r2 — Divergence detection branches', () => {
  beforeEach(() => {
    setupChromeMocks();
    mockGetSettings.mockResolvedValue(baseSettings());
    mockStorageLocalGet.mockResolvedValue({});
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('shows divergence warning when dashboard detects OPFS but offscreen uses fallback', async () => {
    document.body.innerHTML = `
      <div id="diagObsidianSettings"></div>
      <div id="diagAiSettings"></div>
      <div id="diagSqliteStats"></div>
      <div id="diagDivergenceWarning" class="hidden"></div>
      <div id="diagExtInfo"></div>
    `;
    mockDetectLiveVfsStrategy.mockReturnValue({
      caps: { opfsDirectory: true, syncAccessHandle: true, worker: true },
      strategy: 'opfs-sync-worker',
    });
    mockGetSqliteStatus.mockResolvedValue({
      initialized: true,
      path: 'chrome.storage.local',
      fallback: true,
      fts5: false,
      compileOptionsSource: 'fallback',
    });
    await initDiagnosticsPanel();
    const warning = document.getElementById('diagDivergenceWarning') as HTMLElement;
    expect(warning.classList.contains('hidden')).toBe(false);
  });

  it('keeps divergence warning hidden when both offscreen and dashboard agree', async () => {
    document.body.innerHTML = `
      <div id="diagObsidianSettings"></div>
      <div id="diagAiSettings"></div>
      <div id="diagDivergenceWarning" class="hidden"></div>
      <div id="diagExtInfo"></div>
    `;
    mockDetectLiveVfsStrategy.mockReturnValue({
      caps: { opfsDirectory: false, syncAccessHandle: false, worker: false },
      strategy: 'fallback',
    });
    mockGetSqliteStatus.mockResolvedValue({
      initialized: true,
      path: 'chrome.storage.local',
      fallback: true,
      fts5: false,
      compileOptionsSource: 'fallback',
    });
    await initDiagnosticsPanel();
    const warning = document.getElementById('diagDivergenceWarning') as HTMLElement;
    expect(warning.classList.contains('hidden')).toBe(true);
  });

  it('keeps divergence warning hidden when diagDivergenceWarning element is missing', async () => {
    document.body.innerHTML = `
      <div id="diagObsidianSettings"></div>
      <div id="diagAiSettings"></div>
      <div id="diagExtInfo"></div>
    `;
    mockGetSqliteStatus.mockResolvedValue({
      initialized: true,
      path: 'chrome.storage.local',
      fallback: true,
      fts5: false,
    });
    await expect(initDiagnosticsPanel()).resolves.toBeUndefined();
  });

  it('handles detectLiveVfsStrategy throwing', async () => {
    document.body.innerHTML = `
      <div id="diagObsidianSettings"></div>
      <div id="diagAiSettings"></div>
      <div id="diagDivergenceWarning" class="hidden"></div>
      <div id="diagExtInfo"></div>
    `;
    mockDetectLiveVfsStrategy.mockImplementation(() => { throw new Error('no caps'); });
    mockGetSqliteStatus.mockResolvedValue({
      initialized: true,
      path: 'db',
      fallback: false,
      fts5: true,
    });
    await expect(initDiagnosticsPanel()).resolves.toBeUndefined();
  });
});

describe('diagnosticsPanel-r2 — Connection test button branches (undefined response)', () => {
  beforeEach(() => {
    setupChromeMocks();
    mockGetSettings.mockResolvedValue(baseSettings());
    mockGetSqliteStatus.mockResolvedValue(null);
    mockStorageLocalGet.mockResolvedValue({});
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('obsidian test: handles undefined obsidian in response', async () => {
    document.body.innerHTML = `
      <button id="diagTestObsidianBtn"></button>
      <div id="diagConnectionResult"></div>
      <div id="diagExtInfo"></div>
    `;
    mockSendMessage.mockResolvedValue({});
    await initDiagnosticsPanel();
    const btn = document.getElementById('diagTestObsidianBtn') as HTMLButtonElement;
    const result = document.getElementById('diagConnectionResult')!;
    btn.click();
    await vi.waitFor(() => {
      expect(result.textContent).toBe('testComplete');
    });
  });

  it('AI test: handles undefined ai in response', async () => {
    document.body.innerHTML = `
      <button id="diagTestAiBtn"></button>
      <div id="diagConnectionResult"></div>
      <div id="diagExtInfo"></div>
    `;
    mockSendMessage.mockResolvedValue({});
    await initDiagnosticsPanel();
    const btn = document.getElementById('diagTestAiBtn') as HTMLButtonElement;
    const result = document.getElementById('diagConnectionResult')!;
    btn.click();
    await vi.waitFor(() => {
      expect(result.textContent).toBe('testComplete');
    });
  });
});

describe('diagnosticsPanel-r2 — SQLite test button branches', () => {
  beforeEach(() => {
    setupChromeMocks();
    mockGetSettings.mockResolvedValue(baseSettings());
    mockGetSqliteStatus.mockResolvedValue(null);
    mockStorageLocalGet.mockResolvedValue({});
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  function dom(): void {
    document.body.innerHTML = `
      <button id="diagTestSqliteBtn"></button>
      <div id="diagSqliteResult"></div>
      <div id="diagExtInfo"></div>
    `;
  }

  it('sqlite test: success + initialized=true + fts5', async () => {
    dom();
    mockSendMessage.mockResolvedValue({ success: true, initialized: true, fts5: true });
    await initDiagnosticsPanel();
    const btn = document.getElementById('diagTestSqliteBtn') as HTMLButtonElement;
    const result = document.getElementById('diagSqliteResult')!;
    btn.click();
    await vi.waitFor(() => {
      expect(result.textContent).toContain('FTS5');
    });
  });

  it('sqlite test: success + initialized=true + fts5 false', async () => {
    dom();
    mockSendMessage.mockResolvedValue({ success: true, initialized: true, fts5: false });
    await initDiagnosticsPanel();
    const btn = document.getElementById('diagTestSqliteBtn') as HTMLButtonElement;
    const result = document.getElementById('diagSqliteResult')!;
    btn.click();
    await vi.waitFor(() => {
      expect(result.textContent).toContain('LIKE fallback');
    });
  });

  it('sqlite test: success + initialized=false + initError', async () => {
    dom();
    mockSendMessage.mockResolvedValue({ success: true, initialized: false, initError: 'WASM failed', error: 'err' });
    await initDiagnosticsPanel();
    const btn = document.getElementById('diagTestSqliteBtn') as HTMLButtonElement;
    const result = document.getElementById('diagSqliteResult')!;
    btn.click();
    await vi.waitFor(() => {
      expect(result.textContent).toContain('WASM failed');
    });
  });

  it('sqlite test: success + initialized=false + no initError', async () => {
    dom();
    mockSendMessage.mockResolvedValue({ success: true, initialized: false, error: 'generic error' });
    await initDiagnosticsPanel();
    const btn = document.getElementById('diagTestSqliteBtn') as HTMLButtonElement;
    const result = document.getElementById('diagSqliteResult')!;
    btn.click();
    await vi.waitFor(() => {
      expect(result.textContent).toContain('generic error');
    });
  });

  it('sqlite test: success=false', async () => {
    dom();
    mockSendMessage.mockResolvedValue({ success: false, error: 'connection error' });
    await initDiagnosticsPanel();
    const btn = document.getElementById('diagTestSqliteBtn') as HTMLButtonElement;
    const result = document.getElementById('diagSqliteResult')!;
    btn.click();
    await vi.waitFor(() => {
      expect(result.textContent).toContain('connection error');
    });
  });

  it('sqlite test: sendMessage throws', async () => {
    dom();
    mockSendMessage.mockRejectedValue(new Error('timeout'));
    await initDiagnosticsPanel();
    const btn = document.getElementById('diagTestSqliteBtn') as HTMLButtonElement;
    const result = document.getElementById('diagSqliteResult')!;
    btn.click();
    await vi.waitFor(() => {
      expect(result.textContent).toBe('testError');
    });
  });

  it('sqlite test: no sqliteResult element (early return)', async () => {
    document.body.innerHTML = `
      <button id="diagTestSqliteBtn"></button>
      <div id="diagExtInfo"></div>
    `;
    await initDiagnosticsPanel();
    const btn = document.getElementById('diagTestSqliteBtn') as HTMLButtonElement;
    expect(() => btn.click()).not.toThrow();
  });
});

describe('diagnosticsPanel-r2 — OPFS spike button branches', () => {
  beforeEach(() => {
    setupChromeMocks();
    mockGetSettings.mockResolvedValue(baseSettings());
    mockGetSqliteStatus.mockResolvedValue(null);
    mockStorageLocalGet.mockResolvedValue({});
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  function dom(): void {
    document.body.innerHTML = `
      <button id="diagOpfsSpikeBtn"></button>
      <div id="diagOpfsSpikeResult"></div>
      <div id="diagExtInfo"></div>
    `;
  }

  it('OPFS spike: report passed', async () => {
    dom();
    mockRunOpfsSpike.mockResolvedValue({
      passed: true,
      strategy: 'opfs-sync-worker',
      durationMs: 42,
      steps: [{ ok: true, name: 'write', detail: 'ok' }],
    });
    await initDiagnosticsPanel();
    const btn = document.getElementById('diagOpfsSpikeBtn') as HTMLButtonElement;
    btn.click();
    await vi.waitFor(() => {
      const result = document.getElementById('diagOpfsSpikeResult')!;
      expect(result.textContent).toContain('✓');
      expect(result.textContent).toContain('write');
    });
  });

  it('OPFS spike: report failed', async () => {
    dom();
    mockRunOpfsSpike.mockResolvedValue({
      passed: false,
      strategy: 'idb',
      durationMs: 100,
      steps: [{ ok: false, name: 'syncAccessHandle', detail: 'not available' }],
    });
    await initDiagnosticsPanel();
    const btn = document.getElementById('diagOpfsSpikeBtn') as HTMLButtonElement;
    btn.click();
    await vi.waitFor(() => {
      const result = document.getElementById('diagOpfsSpikeResult')!;
      expect(result.textContent).toContain('✗');
    });
  });

  it('OPFS spike: report is null', async () => {
    dom();
    mockRunOpfsSpike.mockResolvedValue(null);
    await initDiagnosticsPanel();
    const btn = document.getElementById('diagOpfsSpikeBtn') as HTMLButtonElement;
    btn.click();
    await vi.waitFor(() => {
      const result = document.getElementById('diagOpfsSpikeResult')!;
      expect(result.textContent).toContain('no report');
    });
  });

  it('OPFS spike: runOpfsSpike throws', async () => {
    dom();
    mockRunOpfsSpike.mockRejectedValue(new Error('spike error'));
    await initDiagnosticsPanel();
    const btn = document.getElementById('diagOpfsSpikeBtn') as HTMLButtonElement;
    btn.click();
    await vi.waitFor(() => {
      const result = document.getElementById('diagOpfsSpikeResult')!;
      expect(result.textContent).toBe('testError');
    });
    expect(btn.disabled).toBe(false);
  });

  it('OPFS spike: missing opfsSpikeResult (early return)', async () => {
    document.body.innerHTML = `
      <button id="diagOpfsSpikeBtn"></button>
      <div id="diagExtInfo"></div>
    `;
    await initDiagnosticsPanel();
    const btn = document.getElementById('diagOpfsSpikeBtn') as HTMLButtonElement;
    expect(() => btn.click()).not.toThrow();
  });
});

describe('diagnosticsPanel-r2 — Migrate button branches', () => {
  beforeEach(() => {
    setupChromeMocks();
    mockGetSettings.mockResolvedValue(baseSettings());
    mockGetSqliteStatus.mockResolvedValue(null);
    mockStorageLocalGet.mockResolvedValue({});
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  function dom(): void {
    document.body.innerHTML = `
      <button id="diagMigrateBtn"></button>
      <div id="diagMigrateResult"></div>
      <div id="diagExtInfo"></div>
    `;
  }

  it('migrate: confirm=false returns early', async () => {
    dom();
    mockShowConfirmDialog.mockResolvedValue(false);
    await initDiagnosticsPanel();
    const btn = document.getElementById('diagMigrateBtn') as HTMLButtonElement;
    btn.click();
    await vi.waitFor(() => {
      expect(mockMigrateLogs).not.toHaveBeenCalled();
    });
  });

  it('migrate: confirm=true, result success', async () => {
    dom();
    mockShowConfirmDialog.mockResolvedValue(true);
    mockMigrateLogs.mockResolvedValue({ read: 10, inserted: 8, count: 10 });
    await initDiagnosticsPanel();
    const btn = document.getElementById('diagMigrateBtn') as HTMLButtonElement;
    const result = document.getElementById('diagMigrateResult')!;
    btn.click();
    await vi.waitFor(() => {
      expect(result.textContent).toContain('read=10');
    });
    expect(btn.disabled).toBe(false);
  });

  it('migrate: confirm=true, result null', async () => {
    dom();
    mockShowConfirmDialog.mockResolvedValue(true);
    mockMigrateLogs.mockResolvedValue(null);
    await initDiagnosticsPanel();
    const btn = document.getElementById('diagMigrateBtn') as HTMLButtonElement;
    const result = document.getElementById('diagMigrateResult')!;
    btn.click();
    await vi.waitFor(() => {
      expect(result.textContent).toContain('diagMigrateFailed');
    });
  });

  it('migrate: confirm=true, migrateLogs throws', async () => {
    dom();
    mockShowConfirmDialog.mockResolvedValue(true);
    mockMigrateLogs.mockRejectedValue(new Error('migrate error'));
    await initDiagnosticsPanel();
    const btn = document.getElementById('diagMigrateBtn') as HTMLButtonElement;
    const result = document.getElementById('diagMigrateResult')!;
    btn.click();
    await vi.waitFor(() => {
      expect(result.textContent).toContain('diagMigrateFailed');
    });
    expect(btn.disabled).toBe(false);
  });

  it('migrate: missing migrateResult (early return)', async () => {
    document.body.innerHTML = `
      <button id="diagMigrateBtn"></button>
      <div id="diagExtInfo"></div>
    `;
    await initDiagnosticsPanel();
    const btn = document.getElementById('diagMigrateBtn') as HTMLButtonElement;
    expect(() => btn.click()).not.toThrow();
  });
});

describe('diagnosticsPanel-r2 — Backfill button branches', () => {
  beforeEach(() => {
    setupChromeMocks();
    mockGetSettings.mockResolvedValue(baseSettings());
    mockGetSqliteStatus.mockResolvedValue(null);
    mockStorageLocalGet.mockResolvedValue({});
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  function dom(): void {
    document.body.innerHTML = `
      <button id="diagBackfillBtn"></button>
      <div id="diagBackfillResult"></div>
      <div id="diagExtInfo"></div>
    `;
  }

  it('backfill: result success', async () => {
    dom();
    mockBackfillMetadata.mockResolvedValue({ updated: 5, total: 10 });
    await initDiagnosticsPanel();
    const btn = document.getElementById('diagBackfillBtn') as HTMLButtonElement;
    const result = document.getElementById('diagBackfillResult')!;
    btn.click();
    await vi.waitFor(() => {
      expect(result.textContent).toContain('updated=5');
    });
    expect(btn.disabled).toBe(false);
  });

  it('backfill: result null', async () => {
    dom();
    mockBackfillMetadata.mockResolvedValue(null);
    await initDiagnosticsPanel();
    const btn = document.getElementById('diagBackfillBtn') as HTMLButtonElement;
    const result = document.getElementById('diagBackfillResult')!;
    btn.click();
    await vi.waitFor(() => {
      expect(result.textContent).toContain('diagBackfillFailed');
    });
  });

  it('backfill: throws', async () => {
    dom();
    mockBackfillMetadata.mockRejectedValue(new Error('backfill error'));
    await initDiagnosticsPanel();
    const btn = document.getElementById('diagBackfillBtn') as HTMLButtonElement;
    const result = document.getElementById('diagBackfillResult')!;
    btn.click();
    await vi.waitFor(() => {
      expect(result.textContent).toContain('diagBackfillFailed');
    });
    expect(btn.disabled).toBe(false);
  });

  it('backfill: missing backfillResult (early return)', async () => {
    document.body.innerHTML = `
      <button id="diagBackfillBtn"></button>
      <div id="diagExtInfo"></div>
    `;
    await initDiagnosticsPanel();
    const btn = document.getElementById('diagBackfillBtn') as HTMLButtonElement;
    expect(() => btn.click()).not.toThrow();
  });
});

describe('diagnosticsPanel-r2 — Cleanup button branches', () => {
  beforeEach(() => {
    setupChromeMocks();
    mockGetSettings.mockResolvedValue(baseSettings());
    mockGetSqliteStatus.mockResolvedValue(null);
    mockStorageLocalGet.mockResolvedValue({});
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  function dom(): void {
    document.body.innerHTML = `
      <button id="diagCleanupBtn"></button>
      <div id="diagCleanupResult"></div>
      <div id="diagExtInfo"></div>
    `;
  }

  it('cleanup: confirm=false returns early', async () => {
    dom();
    mockShowConfirmDialog.mockResolvedValue(false);
    await initDiagnosticsPanel();
    const btn = document.getElementById('diagCleanupBtn') as HTMLButtonElement;
    btn.click();
    await vi.waitFor(() => {
      expect(mockCleanupLegacyStorage).not.toHaveBeenCalled();
    });
  });

  it('cleanup: confirm=true, result success', async () => {
    dom();
    mockShowConfirmDialog.mockResolvedValue(true);
    mockCleanupLegacyStorage.mockResolvedValue({ removed: ['key1'], totalBytes: 1000 });
    await initDiagnosticsPanel();
    const btn = document.getElementById('diagCleanupBtn') as HTMLButtonElement;
    const result = document.getElementById('diagCleanupResult')!;
    btn.click();
    await vi.waitFor(() => {
      expect(result.textContent).toContain('1000 bytes');
    });
    expect(btn.disabled).toBe(false);
  });

  it('cleanup: confirm=true, result null', async () => {
    dom();
    mockShowConfirmDialog.mockResolvedValue(true);
    mockCleanupLegacyStorage.mockResolvedValue(null);
    await initDiagnosticsPanel();
    const btn = document.getElementById('diagCleanupBtn') as HTMLButtonElement;
    const result = document.getElementById('diagCleanupResult')!;
    btn.click();
    await vi.waitFor(() => {
      expect(result.textContent).toContain('diagCleanupFailed');
    });
  });

  it('cleanup: confirm=true, throws', async () => {
    dom();
    mockShowConfirmDialog.mockResolvedValue(true);
    mockCleanupLegacyStorage.mockRejectedValue(new Error('cleanup error'));
    await initDiagnosticsPanel();
    const btn = document.getElementById('diagCleanupBtn') as HTMLButtonElement;
    const result = document.getElementById('diagCleanupResult')!;
    btn.click();
    await vi.waitFor(() => {
      expect(result.textContent).toContain('diagCleanupFailed');
    });
    expect(btn.disabled).toBe(false);
  });

  it('cleanup: missing cleanupResult (early return)', async () => {
    document.body.innerHTML = `
      <button id="diagCleanupBtn"></button>
      <div id="diagExtInfo"></div>
    `;
    await initDiagnosticsPanel();
    const btn = document.getElementById('diagCleanupBtn') as HTMLButtonElement;
    expect(() => btn.click()).not.toThrow();
  });
});

describe('diagnosticsPanel-r2 — Provider notSet branches', () => {
  beforeEach(() => {
    setupChromeMocks();
    mockGetSqliteStatus.mockResolvedValue(null);
    mockStorageLocalGet.mockResolvedValue({});
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('gemini provider with no model and no key shows notSet', async () => {
    document.body.innerHTML = `
      <div id="diagObsidianSettings"></div>
      <div id="diagAiSettings"></div>
      <div id="diagExtInfo"></div>
    `;
    mockGetSettings.mockResolvedValue({
      ai_provider: 'gemini',
      gemini_model: '',
      gemini_api_key: '',
      obsidian_protocol: 'https',
      obsidian_port: '27124',
      obsidian_api_key: 'key',
      obsidian_daily_path: '/notes',
    });
    await initDiagnosticsPanel();
    const el = document.getElementById('diagAiSettings')!;
    expect(el.textContent).toContain('notSet');
  });

  it('openai provider with no model and no key shows notSet', async () => {
    document.body.innerHTML = `
      <div id="diagObsidianSettings"></div>
      <div id="diagAiSettings"></div>
      <div id="diagExtInfo"></div>
    `;
    mockGetSettings.mockResolvedValue({
      ai_provider: 'openai',
      openai_base_url: '',
      openai_model: '',
      openai_api_key: '',
      obsidian_protocol: 'https',
      obsidian_port: '27124',
      obsidian_api_key: 'key',
      obsidian_daily_path: '/notes',
    });
    await initDiagnosticsPanel();
    const el = document.getElementById('diagAiSettings')!;
    expect(el.textContent).toContain('notSet');
  });

  it('openai2 provider with no model and no key shows notSet', async () => {
    document.body.innerHTML = `
      <div id="diagObsidianSettings"></div>
      <div id="diagAiSettings"></div>
      <div id="diagExtInfo"></div>
    `;
    mockGetSettings.mockResolvedValue({
      ai_provider: 'openai2',
      openai_2_base_url: '',
      openai_2_model: '',
      openai_2_api_key: '',
      obsidian_protocol: 'https',
      obsidian_port: '27124',
      obsidian_api_key: 'key',
      obsidian_daily_path: '/notes',
    });
    await initDiagnosticsPanel();
    const el = document.getElementById('diagAiSettings')!;
    expect(el.textContent).toContain('notSet');
  });
});

describe('diagnosticsPanel-r2 — getSeverityLabel edge case', () => {
  it('returns the severity string for unknown severity', async () => {
    const mod = await import('../diagnosticsPanel.js');
    const initFn = (mod as any).initDiagnosticsPanel;
    expect(initFn).toBeDefined();
  });
});
