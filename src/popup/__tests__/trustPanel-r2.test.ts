// @vitest-environment jsdom
/**
 * trustPanel-r2.test.ts
 *
 * PBI 2026-11-08-08 (7): a failure inside updateTrustStatus must surface as
 * an error instead of being absorbed by the generic fallback (which made an
 * outage look like "no info yet"). These tests pin the contract: the
 * fallback still renders, and the failure is additionally reported on the
 * shared status seam and logged.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const {
  mockIsAllUrlsPermitted,
  mockIsHostPermitted,
  mockRequestPermission,
  mockRecordDeniedVisit,
  mockGetTrustLevelDisplay,
  mockCheckDomainTrust,
  mockLogError,
} = vi.hoisted(() => ({
  mockIsAllUrlsPermitted: vi.fn(),
  mockIsHostPermitted: vi.fn(),
  mockRequestPermission: vi.fn(),
  mockRecordDeniedVisit: vi.fn(),
  mockGetTrustLevelDisplay: vi.fn(),
  mockCheckDomainTrust: vi.fn(),
  mockLogError: vi.fn(),
}));

vi.mock('../../utils/permissionManager.js', () => ({
  isAllUrlsPermitted: mockIsAllUrlsPermitted,
  isHostPermitted: mockIsHostPermitted,
  requestPermission: mockRequestPermission,
  recordDeniedVisit: mockRecordDeniedVisit,
}));

vi.mock('../../utils/trustChecker.js', () => ({
  getTrustLevelDisplay: mockGetTrustLevelDisplay,
  checkDomainTrust: mockCheckDomainTrust,
}));

vi.mock('../../utils/logger/types.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logError: mockLogError,
    ErrorCode: { INTERNAL_ERROR: 'INT_001' },
  }),
);
vi.mock('../../utils/logger/core.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logError: mockLogError,
    ErrorCode: { INTERNAL_ERROR: 'INT_001' },
  }),
);
vi.mock('../../utils/logger/api.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logError: mockLogError,
    ErrorCode: { INTERNAL_ERROR: 'INT_001' },
  }),
);

import { updateTrustStatus } from '../trustPanel.js';

describe('trustPanel', () => {
  describe('updateTrustStatus failure visibility', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      document.body.innerHTML =
        '<div id="statusTrustContent"></div>' + '<div id="mainStatus"></div>';
      mockIsAllUrlsPermitted.mockResolvedValue(true);
      mockIsHostPermitted.mockResolvedValue(true);
    });

    afterEach(() => {
      document.body.innerHTML = '';
    });

    it('renders the fallback and reports the failure visibly when the trust check rejects', async () => {
      mockGetTrustLevelDisplay.mockRejectedValue(new Error('trust backend down'));
      mockCheckDomainTrust.mockResolvedValue({ showAlert: false, trustResult: {} });

      await updateTrustStatus('https://example.com');

      const trustContent = document.getElementById('statusTrustContent')!;
      expect(trustContent.innerHTML).toContain('status-muted');
      const status = document.getElementById('mainStatus')!;
      expect(status.textContent).toContain('trust backend down');
      expect(status.className).toBe('status-message error');
      expect(mockLogError).toHaveBeenCalledWith(
        'Failed to update trust status',
        expect.objectContaining({ cause: expect.any(Error) }),
        'INT_001',
      );
    });

    it('renders the trust level with no error surface when the check succeeds', async () => {
      mockGetTrustLevelDisplay.mockResolvedValue({ level: 'Trusted' });
      mockCheckDomainTrust.mockResolvedValue({ showAlert: false, trustResult: {} });

      await updateTrustStatus('https://example.com');

      expect(document.getElementById('statusTrustContent')!.innerHTML).toContain(
        'status-trust-trusted',
      );
      expect(document.getElementById('mainStatus')!.textContent).toBe('');
      expect(mockLogError).not.toHaveBeenCalled();
    });
  });
});
