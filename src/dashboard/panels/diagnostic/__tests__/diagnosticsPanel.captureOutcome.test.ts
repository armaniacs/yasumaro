// @vitest-environment jsdom
/**
 * diagnosticsPanel.captureOutcome.test.ts
 * PBI 2026-10-22-06 slice 2 (diag wiring): the diagnostics panel renders
 * the last settled capture outcome through the failure-reason table —
 * recorded, excluded-with-reason, and nothing-yet — plus the scope summary.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDiagnosticsPanel } from '../diagnosticsPanel.js';

// Keep the backoff instant so the retries do not slow the suite down.
vi.mock('../../../utils/retry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/retry.js')>();
  return {
    retryWithExponentialBackoff: (fn: () => Promise<unknown>, options: Record<string, unknown> = {}) =>
      actual.retryWithExponentialBackoff(fn as never, { ...options, baseDelayMs: 0, maxDelayMs: 0 }),
  };
});

function mockChrome(outcome: { code: string; at: number } | null): void {
  // The shared setup already provides chrome (i18n, runtime, storage).
  // Layer the outcome record onto the in-memory local area only.
  const chromeObj = (globalThis as unknown as { chrome: Record<string, unknown> }).chrome as unknown as {
    storage: { local: { set: (items: Record<string, unknown>) => Promise<void> } };
  };
  const store: Record<string, unknown> =
    outcome === null ? {} : { last_capture_outcome: outcome };
  void chromeObj.storage.local.set(store);
}

function mountPanel(): { container: HTMLDivElement; load: () => Promise<void> } {
  const panel = createDiagnosticsPanel();
  const container = document.createElement('div');
  container.id = 'panel-diagnostics';
  container.innerHTML = `
    <div id="diagCaptureStats"></div>
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
    <button id="diagMigrateBtn"></button>
    <div id="diagMigrateResult"></div>
    <button id="diagBackfillBtn"></button>
    <div id="diagBackfillResult"></div>
    <button id="diagResyncBtn"></button>
    <div id="diagResyncResult"></div>
    <button id="diagCleanupBtn"></button>
    <div id="diagCleanupResult"></div>
    <div id="diagBuiltInAiDownloadResult"></div>
  `;
  document.body.appendChild(container);
  return {
    container,
    load: async (): Promise<void> => {
      await panel.mount(container);
      await panel.load?.();
    },
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('diagnosticsPanel capture section (table-driven final result)', () => {
  it('renders Recorded for a successful last capture plus the scope', async () => {
    mockChrome({ code: 'recorded', at: 1729650000000 });
    const { container, load } = mountPanel();
    await load();

    const section = container.querySelector('#diagCaptureStats');
    expect(section?.textContent ?? '').toContain('Recorded');
    expect(section?.textContent ?? '').toContain('Scope');
  });

  it('renders the classified reason for an excluded page (no silent failure)', async () => {
    mockChrome({ code: 'domain_excluded', at: 1729650000000 });
    const { container, load } = mountPanel();
    await load();

    const section = container.querySelector('#diagCaptureStats');
    const text = section?.textContent ?? '';
    expect(text).toContain('domain_excluded');
    expect(text).toContain('Permission');
  });

  it('renders the internal category for an unlisted code (drift stays visible)', async () => {
    mockChrome({ code: 'future-code', at: 1729650000000 });
    const { container, load } = mountPanel();
    await load();

    const section = container.querySelector('#diagCaptureStats');
    const text = section?.textContent ?? '';
    expect(text).toContain('future-code');
    expect(text).toContain('unlisted reason');
  });

  it('renders nothing-yet plus the scope when no capture settled', async () => {
    mockChrome(null);
    const { container, load } = mountPanel();
    await load();

    const section = container.querySelector('#diagCaptureStats');
    const text = section?.textContent ?? '';
    expect(text).toContain('Not recorded yet');
    expect(text).toContain('Scope');
  });
});
