/**
 * processPrivacyPipelineStep のテスト
 *
 * 修正された問題:
 *   aiClient が null として PrivacyPipeline に渡されていたため
 *   AI要約が常に "Summary not available." になっていた。
 *   context.aiService を使用するよう修正済み。
 */

import { vi } from 'vitest';;
import type { MockedClass, MockedFunction } from 'vitest';

// PrivacyPipeline をモック化
vi.mock('../../../privacyPipeline.js');
vi.mock('../../../../utils/piiSanitizer.js');
vi.mock('../../../../utils/storage/types.js');
vi.mock('../../../../utils/storage/defaults.js');
vi.mock('../../../../utils/storage/encryptionSession.js');
vi.mock('../../../../utils/storage/savedUrlRepository.js');
vi.mock('../../../../utils/storage/domainFilterCache.js');
vi.mock('../../../../utils/storage/quota.js');

import { PrivacyPipeline } from '../../../privacyPipeline.js';
import { processPrivacyPipelineStep } from '../processPrivacyPipelineStep.js';
import type { RecordingContext } from '../../types.js';

const MockedPrivacyPipeline = PrivacyPipeline as MockedClass<typeof PrivacyPipeline>;

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
  let mockProcess: MockedFunction<any>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProcess = vi.fn();
    MockedPrivacyPipeline.mockImplementation(function() {
      this.process = mockProcess;
    });
  });

  describe('aiService の受け渡し（回帰テスト: null問題）', () => {
    it('passes context.aiService to the PrivacyPipeline constructor', async () => {
      const mockAiService = {
        getSupportedModes: vi.fn(),
        generateSummary: vi.fn(),
      };
      mockProcess.mockResolvedValue({ summary: 'AI summary', maskedCount: 0 });

      const context = makeContext({ aiService: mockAiService as any });
      await processPrivacyPipelineStep(context);

      expect(MockedPrivacyPipeline).toHaveBeenCalledWith(
        context.settings,
        mockAiService,
        expect.any(Object)
      );
    });

    it('passes null to PrivacyPipeline when aiService is null without crashing', async () => {
      mockProcess.mockResolvedValue({ summary: 'Summary not available.', maskedCount: 0 });

      const context = makeContext({ aiService: null });
      await expect(processPrivacyPipelineStep(context)).resolves.toBeDefined();

      expect(MockedPrivacyPipeline).toHaveBeenCalledWith(
        context.settings,
        null,
        expect.any(Object)
      );
    });

    it('passes undefined to PrivacyPipeline when aiService is undefined', async () => {
      mockProcess.mockResolvedValue({ summary: 'Summary not available.', maskedCount: 0 });

      // makeContext() leaves aiService unset (undefined) by default.
      const context = makeContext();
      await expect(processPrivacyPipelineStep(context)).resolves.toBeDefined();

      expect(MockedPrivacyPipeline).toHaveBeenCalledWith(
        context.settings,
        undefined,
        expect.any(Object)
      );
    });
  });

  describe('通常フロー', () => {
    it('returns the AI summary normally', async () => {
      mockProcess.mockResolvedValue({
        summary: 'Generated summary',
        maskedCount: 2,
      });
      const mockAiService = { generateSummary: vi.fn(), getSupportedModes: vi.fn() };

      const context = makeContext({ aiService: mockAiService as any });
      const result = await processPrivacyPipelineStep(context);

      expect(result.privacyResult?.summary).toBe('Generated summary');
      expect(result.sanitizedSummary).toBe('Generated summary');
    });

    it('falls back to "Summary not available." when no summary is returned', async () => {
      mockProcess.mockResolvedValue({ maskedCount: 0 });

      const context = makeContext({ aiService: null });
      const result = await processPrivacyPipelineStep(context);

      expect(result.sanitizedSummary).toBe('Summary not available.');
    });
  });

  describe('previewOnly モード', () => {
    it('includes processedContent and maskedItems in context.result', async () => {
      mockProcess.mockResolvedValue({
        success: true,
        preview: true,
        processedContent: 'Masked [MASKED:email] content',
        maskedCount: 1,
        maskedItems: [{ type: 'email' }],
      });
      const mockAiService = { generateSummary: vi.fn(), getSupportedModes: vi.fn() };

      const context = makeContext({
        aiService: mockAiService as any,
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

    it('sets result even when processedContent is empty', async () => {
      mockProcess.mockResolvedValue({
        success: true,
        preview: true,
        processedContent: '',
        maskedCount: 0,
        maskedItems: [],
      });

      const context = makeContext({
        aiService: null,
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

  describe('aiDuration（クラウドAI呼び出し時間）の伝播', () => {
    it('reflects pipelineResult.aiCallDurationMs directly in context.aiDuration', async () => {
      mockProcess.mockResolvedValue({
        summary: 'Cloud summary',
        maskedCount: 0,
        aiCallDurationMs: 842,
      });
      const mockAiService = { generateSummary: vi.fn(), getSupportedModes: vi.fn() };

      const context = makeContext({ aiService: mockAiService as any });
      const result = await processPrivacyPipelineStep(context);

      expect(result.aiDuration).toBe(842);
    });

    it('sets aiDuration to undefined when pipelineResult lacks aiCallDurationMs in previewOnly (cloud AI not called)', async () => {
      mockProcess.mockResolvedValue({
        success: true,
        preview: true,
        processedContent: 'Masked content',
        maskedCount: 0,
        maskedItems: [],
      });

      const context = makeContext({
        aiService: null,
        data: {
          title: 'Test',
          url: 'https://example.com',
          content: 'Content',
          previewOnly: true,
        },
      });

      const result = await processPrivacyPipelineStep(context);

      expect(result.aiDuration).toBeUndefined();
      expect(result.result?.aiDuration).toBeUndefined();
    });

    it('uses the measured value directly instead of reusing context aiDuration even when alreadyProcessed=true (SAVE_RECORD equivalent)', async () => {
      mockProcess.mockResolvedValue({
        summary: 'Cloud summary',
        maskedCount: 0,
        aiCallDurationMs: 1234,
      });
      const mockAiService = { generateSummary: vi.fn(), getSupportedModes: vi.fn() };

      const context = makeContext({
        aiService: mockAiService as any,
        // プレビュー段階の誤った値が context に残っていたとしても、実測値で上書きされることを確認
        aiDuration: 3,
        data: {
          title: 'Test',
          url: 'https://example.com',
          content: 'Content',
          alreadyProcessed: true,
        },
      });

      const result = await processPrivacyPipelineStep(context);

      expect(result.aiDuration).toBe(1234);
    });

    it('sets aiDuration to undefined when aiCallDurationMs is not returned without cloud AI usage such as local_only mode', async () => {
      mockProcess.mockResolvedValue({
        summary: 'Local summary',
        maskedCount: 0,
      });
      const mockAiService = { generateSummary: vi.fn(), getSupportedModes: vi.fn() };

      const context = makeContext({ aiService: mockAiService as any });
      const result = await processPrivacyPipelineStep(context);

      expect(result.aiDuration).toBeUndefined();
    });
  });

  describe('エラーハンドリング', () => {
    it('sets the error on result without throwing in previewOnly', async () => {
      mockProcess.mockRejectedValue(new Error('AI service unavailable'));

      const context = makeContext({
        aiService: null,
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

    it('rethrows the error when not in previewOnly', async () => {
      mockProcess.mockRejectedValue(new Error('Network error'));

      const context = makeContext({ aiService: null });

      await expect(processPrivacyPipelineStep(context)).rejects.toThrow('Network error');
    });
  });
});
