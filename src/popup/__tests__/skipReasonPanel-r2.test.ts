// @vitest-environment jsdom
/**
 * skipReasonPanel-r2.test.ts
 *
 * PBI 2026-11-08-08 (6): a failure to read the last skip reason must be
 * visible instead of silently collapsing to null (indistinguishable from
 * "no skip yet"). These tests pin the contract: the panel stays hidden
 * (fail-closed display) and the failure is logged.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockLogError = vi.hoisted(() => vi.fn());
const mockReadLastSkipReason = vi.hoisted(() => vi.fn());

vi.mock('../../utils/skipReason.js', () => ({
  readLastSkipReason: mockReadLastSkipReason,
}));

vi.mock('../../utils/logger/types.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logError: mockLogError,
    ErrorCode: { STORAGE_READ_FAILURE: 'STRG_RD_001' },
  }),
);
vi.mock('../../utils/logger/core.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logError: mockLogError,
    ErrorCode: { STORAGE_READ_FAILURE: 'STRG_RD_001' },
  }),
);
vi.mock('../../utils/logger/api.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logError: mockLogError,
    ErrorCode: { STORAGE_READ_FAILURE: 'STRG_RD_001' },
  }),
);

import { initSkipReasonPanel } from '../skipReasonPanel.js';

function setPanelDom(): void {
  document.body.innerHTML =
    '<div id="skipReasonPanel" class="skip-reason-panel hidden" role="status">' +
    '<span class="skip-reason-icon" aria-hidden="true">?</span>' +
    '<span id="skipReasonTitle" data-i18n="skipReasonPanelTitle"></span>' +
    '<span id="skipReasonText"></span>' +
    '<span id="skipReasonCount" class="skip-reason-count"></span>' +
    '</div>';
}

describe('skipReasonPanel', () => {
  describe('initSkipReasonPanel read failure', () => {
    beforeEach(() => {
      setPanelDom();
      mockLogError.mockClear();
      mockReadLastSkipReason.mockReset();
    });

    afterEach(() => {
      document.body.innerHTML = '';
    });

    it('logs the read failure and stays hidden when the read rejects', async () => {
      mockReadLastSkipReason.mockRejectedValue(new Error('session storage unavailable'));

      await initSkipReasonPanel();

      expect(document.getElementById('skipReasonPanel')?.classList.contains('hidden')).toBe(true);
      expect(mockLogError).toHaveBeenCalledWith(
        '[skipReasonPanel] Failed to read the last skip reason',
        expect.objectContaining({ cause: expect.any(Error) }),
        'STRG_RD_001',
      );
    });

    it('renders the record without logging when the read succeeds', async () => {
      mockReadLastSkipReason.mockResolvedValue({ reason: 'duplicate', count: 2 });

      await initSkipReasonPanel();

      expect(document.getElementById('skipReasonPanel')?.classList.contains('hidden')).toBe(false);
      expect(mockLogError).not.toHaveBeenCalled();
    });
  });
});
