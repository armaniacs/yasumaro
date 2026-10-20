// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * PBI 2026-10-18-12, Scenario 5: a settings save that landed after coalescing
 * a CAS conflict must not look like a plain silent success — the stored base
 * is the re-derived one, so the form may not match what is stored. The status
 * area says so at least once, and a save whose CAS budget exhausted renders an
 * error instead of nothing.
 */

const { mockSaveDashboardSettings } = vi.hoisted(() => ({
  mockSaveDashboardSettings: vi.fn(),
}));

vi.mock('../../settingsPipeline.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../settingsPipeline.js')>()),
  saveDashboardSettings: mockSaveDashboardSettings,
}));

vi.mock('../../../utils/i18n.js', async () => {
  const { mockGetMessage } = await import('../../../../testDir/i18nMock.js');
  const getMessage = vi.fn((key: string) => key);
  return mockGetMessage(getMessage);
});

import { handleSaveOnly } from '../connectionTests.js';
import { saveDashboardSettings } from '../../settingsPipeline.js';

const mockedSaveDashboardSettings = vi.mocked(saveDashboardSettings);

function buildDom(): HTMLElement {
  document.body.innerHTML = `
    <button id="saveTop"></button>
    <button id="save"></button>
    <div id="statusTop"></div>
    <div id="status"></div>
  `;
  return document.getElementById('status') as HTMLElement;
}

describe('handleSaveOnly — coalesced conflict feedback (PBI 2026-10-18-12, Scenario 5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('chrome', {
      runtime: {
        id: 'test-extension-id',
        sendMessage: vi.fn().mockResolvedValue({}),
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      },
      i18n: { getMessage: vi.fn((key: string) => key), getUILanguage: vi.fn(() => 'en') },
      storage: { local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) } },
    });
  });

  it('reports the coalesced conflict instead of a plain silent success', async () => {
    const status = buildDom();
    mockedSaveDashboardSettings.mockResolvedValue({ success: true, conflictCoalesced: true });

    await handleSaveOnly();

    // Feedback at least once, after the plain success box: the final message
    // names the merge, so the save is never silent about the conflict.
    expect(status.textContent).toBe('saveConflictCoalesced');
    expect(status.className).toContain('success');
  });

  it('keeps the plain success box when no conflict was coalesced', async () => {
    const status = buildDom();
    // The mocked pipeline owns the success render: invoke onSuccess like the
    // real saveDashboardSettings does after a successful write.
    mockedSaveDashboardSettings.mockImplementation(async (opts?: { onSuccess?: () => void }) => {
      opts?.onSuccess?.();
      return { success: true };
    });

    await handleSaveOnly();

    expect(status.textContent).toBe('saveSuccess');
  });

  it('renders the save error when the CAS budget exhausts (no silent no-op)', async () => {
    const status = buildDom();
    mockedSaveDashboardSettings.mockResolvedValue({ success: false, error: 'conflict_unresolved' });

    await handleSaveOnly();

    expect(status.textContent).toBe('saveError');
    expect(status.className).toContain('error');
  });
});
