/**
 * extractSentencesStep.test.ts
 * Tests for extractSentencesStep pipeline step
 * RED Phase: Tests that should fail until implementation is added
 */

import { vi } from 'vitest';;
import type { Mock } from 'vitest';
import type { RecordingContext } from '../types.js';

// Mock the sentenceExtractor modules. The step reads compression stats from
// sentenceExtractor.js and extraction from sentenceExtractorHybrid.js (the
// WASM-first wrapper); both are mocked here.
vi.mock('../../../utils/sentenceExtractor.js', () => ({
  getCompressionStats: vi.fn(),
}));

vi.mock('../../../utils/sentenceExtractorHybrid.js', () => ({
  extractSentencesHybrid: vi.fn(),
}));

import { getCompressionStats } from '../../../utils/sentenceExtractor.js';
import { extractSentencesHybrid } from '../../../utils/sentenceExtractorHybrid.js';
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
    vi.clearAllMocks();
    (extractSentencesHybrid as Mock).mockReset();
    (getCompressionStats as Mock).mockReset();
  });

  it('should extract sentences from truncated content', async () => {
    const mockContext: RecordingContext = {
      data: {
        url: 'https://example.com',
        title: 'Test Page',
        content: 'Original content here',
      },
      settings: {
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

    (extractSentencesHybrid as Mock).mockResolvedValue(mockSentences);
    (getCompressionStats as Mock).mockReturnValue({
      originalLength: 500,
      extractedLength: 150,
      compressionRatio: 3.33,
      sentenceCount: 11,
      extractedCount: 3,
    });

    const result = await extractSentencesStep(mockContext);

    expect(extractSentencesHybrid).toHaveBeenCalled();
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
        l0_extractive_enabled: false,
      },
      force: false,
      errors: [],
      truncatedContent: 'Some content here',
    };

    const result = await extractSentencesStep(mockContext);

    expect(extractSentencesHybrid).not.toHaveBeenCalled();
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

    (extractSentencesHybrid as Mock).mockResolvedValue(mockSentences);

    const result = await extractSentencesStep(mockContext);

    // Should extract from privacy pipeline output, not original content
    expect(extractSentencesHybrid).toHaveBeenCalled();
  });

  it('should handle empty content gracefully', async () => {
    const mockContext: RecordingContext = {
      data: {
        url: 'https://example.com',
        title: 'Test Page',
        content: '',
      },
      settings: {
        l0_extractive_enabled: true,
      },
      force: false,
      errors: [],
      truncatedContent: '',
    };

    (extractSentencesHybrid as Mock).mockResolvedValue([]);

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
        l0_extractive_enabled: true,
      },
      force: false,
      errors: [],
      truncatedContent: 'Content to extract from',
    };

    (extractSentencesHybrid as Mock).mockImplementation(() => {
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
        l0_extractive_enabled: true,
      },
      force: false,
      errors: [],
      truncatedContent: 'A'.repeat(1000),
    };

    const mockSentences = ['Extracted sentence 1', 'Extracted sentence 2'];

    (extractSentencesHybrid as Mock).mockResolvedValue(mockSentences);
    (getCompressionStats as Mock).mockReturnValue({
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