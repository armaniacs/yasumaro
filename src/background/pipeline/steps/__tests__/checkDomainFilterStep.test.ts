/**
 * checkDomainFilterStep のテスト
 *
 * 検証対象:
 * - ドメイン許可時: isDomainAllowed=true を返す
 * - ドメイン拒否 + force=false: DOMAIN_BLOCKED エラー
 * - ドメイン拒否 + force=true: isDomainAllowed=false で通過
 */

import { jest } from '@jest/globals';

jest.mock('../../../../utils/logger.js', () => ({
  addLog: jest.fn(),
  logError: jest.fn(),
  LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
  ErrorCode: { INTERNAL_ERROR: 'INT_001', UNKNOWN_ERROR: 'UNKN_001' },
}));
jest.mock('../../../../utils/domainUtils.js', () => ({
  isDomainAllowed: jest.fn(),
}));

import { checkDomainFilterStep } from '../checkDomainFilterStep.js';
import * as domainUtils from '../../../../utils/domainUtils.js';
import type { RecordingContext } from '../../types.js';

const mockIsDomainAllowed = domainUtils.isDomainAllowed as jest.MockedFunction<typeof domainUtils.isDomainAllowed>;

function makeContext(overrides: Partial<RecordingContext> = {}): RecordingContext {
  return {
    data: {
      title: 'Test Page',
      url: 'https://example.com/page',
      content: 'Some content',
    },
    settings: {} as any,
    force: false,
    errors: [],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('checkDomainFilterStep', () => {
  describe('ドメイン許可', () => {
    it('isDomainAllowed=true の場合 isDomainAllowed=true を返す', async () => {
      mockIsDomainAllowed.mockResolvedValue(true);

      const context = makeContext();
      const result = await checkDomainFilterStep(context);

      expect(result.isDomainAllowed).toBe(true);
    });
  });

  describe('ドメイン拒否 + force=false', () => {
    it('isDomainAllowed=false かつ force=false の場合 DOMAIN_BLOCKED を throw する', async () => {
      mockIsDomainAllowed.mockResolvedValue(false);

      const context = makeContext({ force: false });
      await expect(checkDomainFilterStep(context)).rejects.toThrow('DOMAIN_BLOCKED');
    });
  });

  describe('ドメイン拒否 + force=true', () => {
    it('isDomainAllowed=false でも force=true なら通過する', async () => {
      mockIsDomainAllowed.mockResolvedValue(false);

      const context = makeContext({ force: true });
      const result = await checkDomainFilterStep(context);

      expect(result.isDomainAllowed).toBe(false);
    });

    it('force=true 時に WARN ログが出力される', async () => {
      mockIsDomainAllowed.mockResolvedValue(false);

      const context = makeContext({
        force: true,
        data: { title: 'Test', url: 'https://blocked.example.com', content: '' },
      });

      await checkDomainFilterStep(context);

      const { addLog } = await import('../../../../utils/logger.js');
      expect(addLog).toHaveBeenCalledWith(
        'WARN',
        expect.stringContaining('Force recording blocked domain'),
        expect.objectContaining({ url: 'https://blocked.example.com' })
      );
    });
  });

  describe('URL パススルー', () => {
    it('isDomainAllowed に URL が渡される', async () => {
      mockIsDomainAllowed.mockResolvedValue(true);

      const context = makeContext({
        data: { title: 'Test', url: 'https://specific-domain.org/path', content: '' },
      });

      await checkDomainFilterStep(context);

      expect(mockIsDomainAllowed).toHaveBeenCalledWith('https://specific-domain.org/path');
    });
  });
});
