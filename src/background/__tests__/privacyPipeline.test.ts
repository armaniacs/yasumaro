// src/background/__tests__/privacyPipeline.test.js
import { PrivacyPipeline } from '../privacyPipeline.js';

describe('PrivacyPipeline', () => {
  const mockSettings = {
    PRIVACY_MODE: 'full_pipeline',
    PII_SANITIZE_LOGS: true
  };

  const mockAiClient = {
    // @ts-expect-error - jest.fn() type narrowing issue
  
    getLocalAvailability: jest.fn().mockResolvedValue('readily'),
    // @ts-expect-error - jest.fn() type narrowing issue
  
    summarizeLocally: jest.fn().mockResolvedValue({
      success: true,
      summary: 'Local summary'
    }),
    // @ts-expect-error - jest.fn() type narrowing issue
  
    generateSummary: jest.fn().mockResolvedValue({
      summary: 'Cloud summary',
      sentTokens: 100,
      receivedTokens: 50
    })
  };

  const mockSanitizers = {
    sanitizeRegex: jest.fn().mockReturnValue({
      text: 'Sanitized text',
      maskedItems: [{ type: 'email' }]
    })
  };

  describe('process', () => {
    it('should process full pipeline (L1 -> L2 -> L3)', async () => {
      const pipeline = new PrivacyPipeline(mockSettings, mockAiClient, mockSanitizers);

      const result = await pipeline.process('Original content');

      expect(result.summary).toBe('Cloud summary');
      expect(result.maskedCount).toBe(1);
    });

    it('should return preview only when previewOnly is true', async () => {
      const pipeline = new PrivacyPipeline(mockSettings, mockAiClient, mockSanitizers);

      const result = await pipeline.process('Original content', { previewOnly: true });

      expect(result.preview).toBe(true);
      expect(result.processedContent).toBe('Sanitized text');
    });

    it('LLMがタグ付き形式で返したとき、summary は parseTagsFromSummary 後のテキストになる', async () => {
      const llmSummary = '#IT・プログラミング #インフラ | 1行目要約\n\n詳細説明\n\n#カテゴリ1 #カテゴリ2 | 要約文（改行なし）';
      const mockAiWithTags = {
        // @ts-expect-error
        getLocalAvailability: jest.fn().mockResolvedValue('no'),
        // @ts-expect-error
        summarizeLocally: jest.fn(),
        // @ts-expect-error
        generateSummary: jest.fn().mockResolvedValue({ summary: llmSummary })
      };
      const settingsNoLocal = { PRIVACY_MODE: 'masked_cloud', PII_SANITIZE_LOGS: false };
      const pipeline = new PrivacyPipeline(settingsNoLocal, mockAiWithTags, mockSanitizers);

      const result = await pipeline.process('content', { tagSummaryMode: true });

      // summary にはプロンプト例示行 "#カテゴリ1 ... | 要約文（改行なし）" が含まれないこと
      expect(result.summary).not.toContain('#カテゴリ1');
      expect(result.summary).not.toContain('要約文（改行なし）');
      // タグ部分を除いた要約文が含まれること
      expect(result.summary).toContain('1行目要約');
      // タグが抽出されていること
      expect(result.tags).toContain('IT・プログラミング');
    });

    it('返される summary に \\n が含まれない（保存・表示前に正規化済み）', async () => {
      const llmSummary = '1行目\n\n2行目\n3行目';
      const mockAiNoLocal = {
        // @ts-expect-error
        getLocalAvailability: jest.fn().mockResolvedValue('no'),
        // @ts-expect-error
        summarizeLocally: jest.fn(),
        // @ts-expect-error
        generateSummary: jest.fn().mockResolvedValue({ summary: llmSummary })
      };
      const settingsNoLocal = { PRIVACY_MODE: 'masked_cloud', PII_SANITIZE_LOGS: false };
      const pipeline = new PrivacyPipeline(settingsNoLocal, mockAiNoLocal, mockSanitizers);

      const result = await pipeline.process('content');

      expect(result.summary).not.toContain('\n');
      // selectBestBlock returns the FIRST block only
      expect(result.summary).toBe('1行目');
    });
  });
});