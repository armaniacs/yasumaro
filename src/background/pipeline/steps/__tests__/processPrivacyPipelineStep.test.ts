/**
 * processPrivacyPipelineStep のテスト
 *
 * 修正された問題:
 *   aiClient が null として PrivacyPipeline に渡されていたため
 *   AI要約が常に "Summary not available." になっていた。
 *   context.aiClient を使用するよう修正済み。
 */

import { jest } from '@jest/globals';

// PrivacyPipeline をモック化
jest.mock('../../../privacyPipeline.js');
jest.mock('../../../../utils/piiSanitizer.js');
jest.mock('../../../../utils/storage.js');

import { PrivacyPipeline } from '../../../privacyPipeline.js';
import { processPrivacyPipelineStep } from '../processPrivacyPipelineStep.js';
import type { RecordingContext } from '../../types.js';

const MockedPrivacyPipeline = PrivacyPipeline as jest.MockedClass<typeof PrivacyPipeline>;

function makeContext(overrides: Partial<RecordingContext> = {}): RecordingContext {
  return {
    data: {
      title: 'Test Page',
      url: 'https://example.com',
      content: 'Some page content',
    },
    settings: {
      PRIVACY_MODE: 'full_pipeline',
      PII_SANITIZE_LOGS: true,
      TAG_SUMMARY_MODE: false,
    } as any,
    force: false,
    errors: [],
    ...overrides,
  };
}

describe('processPrivacyPipelineStep', () => {
  let mockProcess: jest.MockedFunction<any>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockProcess = jest.fn();
    MockedPrivacyPipeline.mockImplementation(() => ({
      process: mockProcess,
    }) as any);
  });

  describe('aiClient の受け渡し（回帰テスト: null問題）', () => {
    it('context.aiClient を PrivacyPipeline コンストラクタに渡す', async () => {
      const mockAiClient = {
        getLocalAvailability: jest.fn(),
        summarizeLocally: jest.fn(),
        generateSummary: jest.fn(),
      };
      mockProcess.mockResolvedValue({ summary: 'AI summary', maskedCount: 0 });

      const context = makeContext({ aiClient: mockAiClient as any });
      await processPrivacyPipelineStep(context);

      // PrivacyPipeline が aiClient を受け取っていることを確認
      expect(MockedPrivacyPipeline).toHaveBeenCalledWith(
        context.settings,
        mockAiClient,
        expect.any(Object)  // sanitizers
      );
    });

    it('aiClient が null の場合も PrivacyPipeline に null を渡す（クラッシュしない）', async () => {
      mockProcess.mockResolvedValue({ summary: 'Summary not available.', maskedCount: 0 });

      const context = makeContext({ aiClient: null });
      await expect(processPrivacyPipelineStep(context)).resolves.toBeDefined();

      expect(MockedPrivacyPipeline).toHaveBeenCalledWith(
        context.settings,
        null,
        expect.any(Object)
      );
    });

    it('aiClient が undefined の場合も PrivacyPipeline に undefined を渡す', async () => {
      mockProcess.mockResolvedValue({ summary: 'Summary not available.', maskedCount: 0 });

      const context = makeContext({ aiClient: undefined });
      await expect(processPrivacyPipelineStep(context)).resolves.toBeDefined();

      expect(MockedPrivacyPipeline).toHaveBeenCalledWith(
        context.settings,
        undefined,
        expect.any(Object)
      );
    });
  });

  describe('通常フロー', () => {
    it('AI要約が正常に返される', async () => {
      mockProcess.mockResolvedValue({
        summary: 'Generated summary',
        maskedCount: 2,
      });
      const mockAiClient = { generateSummary: jest.fn() };

      const context = makeContext({ aiClient: mockAiClient as any });
      const result = await processPrivacyPipelineStep(context);

      expect(result.privacyResult?.summary).toBe('Generated summary');
      expect(result.sanitizedSummary).toBe('Generated summary');
    });

    it('summary が返されない場合は "Summary not available." にフォールバック', async () => {
      mockProcess.mockResolvedValue({ maskedCount: 0 });

      const context = makeContext({ aiClient: null });
      const result = await processPrivacyPipelineStep(context);

      expect(result.sanitizedSummary).toBe('Summary not available.');
    });
  });

  describe('previewOnly モード', () => {
    it('processedContent と maskedItems を context.result に含める', async () => {
      mockProcess.mockResolvedValue({
        success: true,
        preview: true,
        processedContent: 'Masked [MASKED:email] content',
        maskedCount: 1,
        maskedItems: [{ type: 'email' }],
      });
      const mockAiClient = { generateSummary: jest.fn() };

      const context = makeContext({
        aiClient: mockAiClient as any,
        data: {
          title: 'Test',
          url: 'https://example.com',
          content: 'Content with user@example.com',
          previewOnly: true,
        },
      });

      const result = await processPrivacyPipelineStep(context);

      expect(result.result?.processedContent).toBe('Masked [MASKED:email] content');
      expect(result.result?.maskedCount).toBe(1);
      expect(result.result?.maskedItems).toEqual([{ type: 'email' }]);
      expect(result.result?.success).toBe(true);
    });

    it('processedContent が空でも result が設定される', async () => {
      mockProcess.mockResolvedValue({
        success: true,
        preview: true,
        processedContent: '',
        maskedCount: 0,
        maskedItems: [],
      });

      const context = makeContext({
        aiClient: null,
        data: {
          title: 'Test',
          url: 'https://example.com',
          content: 'Clean content',
          previewOnly: true,
        },
      });

      const result = await processPrivacyPipelineStep(context);

      expect(result.result?.success).toBe(true);
      expect(result.result?.processedContent).toBe('');
    });
  });

  describe('エラーハンドリング', () => {
    it('previewOnly 時のエラーは result にセットして throw しない', async () => {
      mockProcess.mockRejectedValue(new Error('AI service unavailable'));

      const context = makeContext({
        aiClient: null,
        data: {
          title: 'Test',
          url: 'https://example.com',
          content: 'Content',
          previewOnly: true,
        },
      });

      const result = await processPrivacyPipelineStep(context);

      expect(result.result?.success).toBe(false);
      expect(result.result?.error).toBe('AI service unavailable');
    });

    it('previewOnly でない時のエラーは再スロー', async () => {
      mockProcess.mockRejectedValue(new Error('Network error'));

      const context = makeContext({ aiClient: null });

      await expect(processPrivacyPipelineStep(context)).rejects.toThrow('Network error');
    });
  });
});
