// src/background/__tests__/privacyPipeline.test.js
import { PrivacyPipeline } from '../privacyPipeline.js';

describe('PrivacyPipeline', () => {
  const mockSettings = {
    PRIVACY_MODE: 'full_pipeline',
    PII_SANITIZE_LOGS: true
  };

  const mockAiClient = {
    getLocalAvailability: jest.fn().mockResolvedValue('readily'),
    summarizeLocally: jest.fn().mockResolvedValue({
      success: true,
      summary: 'Local summary'
    }),
    generateSummary: jest.fn().mockResolvedValue('Cloud summary')
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
  });
});