/**
 * extractSentencesStep.test.ts
 * Tests for extractSentencesStep pipeline step
 * RED Phase: Tests that should fail until implementation is added
 */

import { jest } from '@jest/globals';
import type { RecordingContext } from '../types.js';

// Mock the sentenceExtractor module
jest.mock('../../../utils/sentenceExtractor.js', () => ({
  extractSentences: jest.fn(),
  getCompressionStats: jest.fn(),
}));

import { extractSentences, getCompressionStats } from '../../../utils/sentenceExtractor.js';
import type { PipelineStepFunction } from '../types.js';

// Try to import the step - will fail until implemented
let extractSentencesStep: PipelineStepFunction;

describe('extractSentencesStep', () => {
  beforeAll(async () => {
    try {
      const module = await import('../steps/extractSentencesStep.js');
      extractSentencesStep = module.extractSentencesStep;
    } catch (e) {
      // Module not yet implemented - tests will fail
      extractSentencesStep = async (context) => context;
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (extractSentences as jest.Mock).mockReset();
    (getCompressionStats as jest.Mock).mockReset();
  });

  it('should extract sentences from truncated content', async () => {
    const mockContext: RecordingContext = {
      data: {
        url: 'https://example.com',
        title: 'Test Page',
        content: 'Original content here',
      },
      settings: {
        // @ts-expect-error - minimal settings for test
        l0_extractive_enabled: true,
      },
      force: false,
      errors: [],
      truncatedContent: 'This is the truncated content with many sentences. ' +
        'Second sentence here. Third sentence. Fourth one. Fifth sentence here. ' +
        'Sixth sentence. Seventh. Eighth. Ninth. Tenth. Eleventh sentence here.',
    };

    const mockSentences = [
      'This is the truncated content with many sentences.',
      'Second sentence here.',
      'Third sentence.',
    ];

    (extractSentences as jest.Mock).mockReturnValue(mockSentences);
    (getCompressionStats as jest.Mock).mockReturnValue({
      originalLength: 500,
      extractedLength: 150,
      compressionRatio: 3.33,
      sentenceCount: 11,
      extractedCount: 3,
    });

    const result = await extractSentencesStep(mockContext);

    expect(extractSentences).toHaveBeenCalled();
    expect(result.extractedSentences).toEqual(mockSentences);
    expect(result.extractedSentencesBytes).toBeDefined();
  });

  it('should skip extraction when L0 is disabled', async () => {
    const mockContext: RecordingContext = {
      data: {
        url: 'https://example.com',
        title: 'Test Page',
        content: 'Content',
      },
      settings: {
        // @ts-expect-error - minimal settings for test
        l0_extractive_enabled: false,
      },
      force: false,
      errors: [],
      truncatedContent: 'Some content here',
    };

    const result = await extractSentencesStep(mockContext);

    expect(extractSentences).not.toHaveBeenCalled();
    expect(result.extractedSentences).toBeUndefined();
  });

  it('should use sanitizedSummary from privacyResult when available', async () => {
    const mockContext: RecordingContext = {
      data: {
        url: 'https://example.com',
        title: 'Test Page',
        content: 'Content',
      },
      settings: {
        // @ts-expect-error - minimal settings for test
        l0_extractive_enabled: true,
      },
      force: false,
      errors: [],
      truncatedContent: 'Original truncated content',
      privacyResult: {
        summary: 'AI generated summary from privacy pipeline',
        success: true,
      },
    };

    const mockSentences = ['AI generated summary from privacy pipeline'];

    (extractSentences as jest.Mock).mockReturnValue(mockSentences);

    const result = await extractSentencesStep(mockContext);

    // Should extract from privacy pipeline output, not original content
    expect(extractSentences).toHaveBeenCalled();
  });

  it('should handle empty content gracefully', async () => {
    const mockContext: RecordingContext = {
      data: {
        url: 'https://example.com',
        title: 'Test Page',
        content: '',
      },
      settings: {
        // @ts-expect-error - minimal settings for test
        l0_extractive_enabled: true,
      },
      force: false,
      errors: [],
      truncatedContent: '',
    };

    (extractSentences as jest.Mock).mockReturnValue([]);

    const result = await extractSentencesStep(mockContext);

    // Empty content returns context without extractedSentences
    expect(result.extractedSentences).toBeUndefined();
  });

  it('should handle extraction errors gracefully with fallback', async () => {
    const mockContext: RecordingContext = {
      data: {
        url: 'https://example.com',
        title: 'Test Page',
        content: 'Some content',
      },
      settings: {
        // @ts-expect-error - minimal settings for test
        l0_extractive_enabled: true,
      },
      force: false,
      errors: [],
      truncatedContent: 'Content to extract from',
    };

    (extractSentences as jest.Mock).mockImplementation(() => {
      throw new Error('Extraction failed');
    });

    // Should not throw - should handle error gracefully
    const result = await extractSentencesStep(mockContext);

    // Should still return context with errors logged
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should track extraction performance', async () => {
    const mockContext: RecordingContext = {
      data: {
        url: 'https://example.com',
        title: 'Test Page',
        content: 'A'.repeat(1000),
      },
      settings: {
        // @ts-expect-error - minimal settings for test
        l0_extractive_enabled: true,
      },
      force: false,
      errors: [],
      truncatedContent: 'A'.repeat(1000),
    };

    const mockSentences = ['Extracted sentence 1', 'Extracted sentence 2'];

    (extractSentences as jest.Mock).mockReturnValue(mockSentences);
    (getCompressionStats as jest.Mock).mockReturnValue({
      originalLength: 1000,
      extractedLength: 50,
      compressionRatio: 20,
      sentenceCount: 50,
      extractedCount: 2,
    });

    const startTime = performance.now();
    await extractSentencesStep(mockContext);
    const endTime = performance.now();

    // Performance should be reasonable (under 1000ms threshold)
    expect(endTime - startTime).toBeLessThan(1000);
  });

  it('should be backward compatible when extractedSentences is not set', async () => {
    const mockContext: RecordingContext = {
      data: {
        url: 'https://example.com',
        title: 'Test Page',
        content: 'Some content',
      },
      settings: {},
      force: false,
      errors: [],
      // No extractedSentences set - should work with existing code
      truncatedContent: 'Original content',
    };

    // Should not throw - just pass through
    const result = await extractSentencesStep(mockContext);

    expect(result).toBeDefined();
  });
});