/**
 * RecordingPipeline のテスト
 *
 * 修正された問題:
 *   RecordingPipeline に渡された aiClient が processPrivacyPipelineStep に
 *   伝達されず null のまま PrivacyPipeline に渡されていた。
 *   context.aiClient を通じて渡すよう修正済み。
 */

import { jest } from '@jest/globals';

jest.mock('../../../utils/storage.js');
jest.mock('../../../utils/storageUrls.js');
jest.mock('../../../utils/domainUtils.js');
jest.mock('../../../utils/permissionManager.js');
jest.mock('../../../utils/trustChecker.js', () => ({
  TrustChecker: jest.fn().mockImplementation(() => ({
    checkDomain: jest.fn().mockResolvedValue({
      canProceed: true,
      showAlert: false,
      reason: undefined,
      trustResult: { level: 'trusted' },
    }),
  })),
}));
jest.mock('../../privacyPipeline.js');
jest.mock('../../obsidianClient.js');
jest.mock('../../../utils/logger.js', () => ({
  addLog: jest.fn(),
  LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
}));
jest.mock('../../../utils/piiSanitizer.js', () => ({
  sanitizeRegex: jest.fn().mockResolvedValue({ text: 'sanitized', maskedItems: [] }),
}));

import * as storage from '../../../utils/storage.js';
import * as domainUtils from '../../../utils/domainUtils.js';
import * as permissionManager from '../../../utils/permissionManager.js';
import { PrivacyPipeline } from '../../privacyPipeline.js';
import { ObsidianClient } from '../../obsidianClient.js';
import { RecordingPipeline } from '../RecordingPipeline.js';

const MockedObsidianClient = ObsidianClient as jest.MockedClass<typeof ObsidianClient>;

const MockedPrivacyPipeline = PrivacyPipeline as jest.MockedClass<typeof PrivacyPipeline>;

function makeAiClient() {
  return {
    getLocalAvailability: jest.fn<() => Promise<string>>().mockResolvedValue('unavailable'),
    summarizeLocally: jest.fn(),
    generateSummary: jest.fn<() => Promise<any>>().mockResolvedValue({
      summary: 'AI summary',
      sentTokens: 100,
      receivedTokens: 50,
    }),
  };
}

function makeObsidian() {
  return {
    appendToDailyNote: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  };
}

function makeGetPrivacyInfo() {
  return jest.fn<() => Promise<any>>().mockResolvedValue({ isPrivate: false });
}

beforeEach(() => {
  jest.clearAllMocks();

  // @ts-expect-error - mock
  storage.getSettings.mockResolvedValue({
    PRIVACY_MODE: 'full_pipeline',
    PII_SANITIZE_LOGS: true,
    TAG_SUMMARY_MODE: false,
    AUTO_SAVE_PRIVACY_BEHAVIOR: 'save',
  });
  // @ts-expect-error - mock
  storage.StorageKeys = {
    PRIVACY_MODE: 'PRIVACY_MODE',
    PII_SANITIZE_LOGS: 'PII_SANITIZE_LOGS',
    TAG_SUMMARY_MODE: 'TAG_SUMMARY_MODE',
    AUTO_SAVE_PRIVACY_BEHAVIOR: 'AUTO_SAVE_PRIVACY_BEHAVIOR',
  };
  // @ts-expect-error - mock
  storage.getSavedUrlsWithTimestamps.mockResolvedValue(new Map());
  // @ts-expect-error - mock
  storage.setSavedUrlsWithTimestamps.mockResolvedValue(undefined);
  // @ts-expect-error - mock
  storage.MAX_URL_SET_SIZE = 10000;
  // @ts-expect-error - mock
  storage.URL_WARNING_THRESHOLD = 9000;

  // @ts-expect-error - mock
  domainUtils.isDomainAllowed.mockResolvedValue(true);
  // @ts-expect-error - mock
  domainUtils.extractDomain.mockReturnValue('example.com');

  // ObsidianClient のデフォルトモック
  MockedObsidianClient.mockImplementation(() => ({
    appendToDailyNote: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  }) as any);

  // @ts-expect-error - mock
  permissionManager.getPermissionManager.mockReturnValue({
    isHostPermitted: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
    recordDeniedVisit: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  });
});

describe('RecordingPipeline', () => {
  describe('aiClient の伝達（回帰テスト: null問題）', () => {
    it('コンストラクタに渡した aiClient が PrivacyPipeline コンストラクタに届く', async () => {
      const mockProcess = jest.fn<() => Promise<any>>().mockResolvedValue({
        summary: 'AI summary',
        maskedCount: 0,
      });
      MockedPrivacyPipeline.mockImplementation(() => ({ process: mockProcess }) as any);

      const aiClient = makeAiClient();
      const pipeline = new RecordingPipeline(
        makeGetPrivacyInfo(),
        makeObsidian() as any,
        aiClient as any
      );

      await pipeline.execute({
        title: 'Test',
        url: 'https://example.com',
        content: 'Some content',
      });

      // PrivacyPipeline が aiClient を受け取っていること
      expect(MockedPrivacyPipeline).toHaveBeenCalledWith(
        expect.any(Object),  // settings
        aiClient,
        expect.any(Object)   // sanitizers
      );
    });

    it('aiClient なし（null）で構築すると PrivacyPipeline に null が渡される', async () => {
      const mockProcess = jest.fn<() => Promise<any>>().mockResolvedValue({
        summary: 'Summary not available.',
        maskedCount: 0,
      });
      MockedPrivacyPipeline.mockImplementation(() => ({ process: mockProcess }) as any);

      const pipeline = new RecordingPipeline(
        makeGetPrivacyInfo(),
        makeObsidian() as any
        // aiClient を省略 → null がデフォルト
      );

      await pipeline.execute({
        title: 'Test',
        url: 'https://example.com',
        content: 'Some content',
      });

      expect(MockedPrivacyPipeline).toHaveBeenCalledWith(
        expect.any(Object),
        null,
        expect.any(Object)
      );
    });
  });

  describe('previewOnly モード', () => {
    it('processedContent と maskedItems を返す', async () => {
      const mockProcess = jest.fn<() => Promise<any>>().mockResolvedValue({
        success: true,
        preview: true,
        processedContent: 'Content with [MASKED:email]',
        maskedCount: 1,
        maskedItems: [{ type: 'email' }],
      });
      MockedPrivacyPipeline.mockImplementation(() => ({ process: mockProcess }) as any);

      const pipeline = new RecordingPipeline(
        makeGetPrivacyInfo(),
        makeObsidian() as any,
        makeAiClient() as any
      );

      const result = await pipeline.execute({
        title: 'Test',
        url: 'https://example.com',
        content: 'Content with user@example.com',
        previewOnly: true,
      });

      expect(result.success).toBe(true);
      expect(result.preview).toBe(true);
      expect(result.processedContent).toBe('Content with [MASKED:email]');
      expect(result.maskedCount).toBe(1);
      expect(result.maskedItems).toEqual([{ type: 'email' }]);
    });

    it('previewOnly 時は Obsidian に保存しない', async () => {
      const mockAppend = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
      MockedObsidianClient.mockImplementation(() => ({
        appendToDailyNote: mockAppend,
      }) as any);
      MockedPrivacyPipeline.mockImplementation(() => ({
        process: jest.fn<() => Promise<any>>().mockResolvedValue({
          success: true,
          preview: true,
          processedContent: 'Processed',
          maskedCount: 0,
          maskedItems: [],
        }),
      }) as any);

      const pipeline = new RecordingPipeline(
        makeGetPrivacyInfo(),
        makeObsidian() as any,
        makeAiClient() as any
      );

      await pipeline.execute({
        title: 'Test',
        url: 'https://example.com',
        content: 'Content',
        previewOnly: true,
      });

      expect(mockAppend).not.toHaveBeenCalled();
    });
  });

  describe('通常記録フロー', () => {
    it('AI要約が Obsidian に保存される', async () => {
      const mockAppend = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
      MockedObsidianClient.mockImplementation(() => ({
        appendToDailyNote: mockAppend,
      }) as any);
      MockedPrivacyPipeline.mockImplementation(() => ({
        process: jest.fn<() => Promise<any>>().mockResolvedValue({
          summary: 'Generated AI summary',
          maskedCount: 0,
        }),
      }) as any);

      const pipeline = new RecordingPipeline(
        makeGetPrivacyInfo(),
        makeObsidian() as any,
        makeAiClient() as any
      );

      const result = await pipeline.execute({
        title: 'Test Page',
        url: 'https://example.com',
        content: 'Page content',
      });

      expect(result.success).toBe(true);
      expect(mockAppend).toHaveBeenCalled();
      const callArg: string = mockAppend.mock.calls[0][0] as string;
      expect(callArg).toContain('Generated AI summary');
    });

    it('ドメインブロック時は DOMAIN_BLOCKED エラーを返す', async () => {
      // @ts-expect-error - mock
      domainUtils.isDomainAllowed.mockResolvedValue(false);

      const pipeline = new RecordingPipeline(
        makeGetPrivacyInfo(),
        makeObsidian() as any,
        makeAiClient() as any
      );

      const result = await pipeline.execute({
        title: 'Test',
        url: 'https://blocked.example.com',
        content: 'Content',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('DOMAIN_BLOCKED');
    });
  });
});
