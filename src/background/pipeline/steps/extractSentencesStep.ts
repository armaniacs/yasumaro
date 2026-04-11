/**
 * extractSentencesStep.ts
 * L0 Extractive Compression Pipeline Step
 * 
 * Executes sentence extraction after privacyPipeline to:
 * - Extract important sentences using TextRank algorithm
 * - Reduce AI token costs by 2-3x
 * - Run on PII-cleaned content for privacy
 */

import { addLog, LogType } from '../../../utils/logger.js';
import { StorageKeys } from '../../../utils/storage.js';
import { extractSentences, getCompressionStats } from '../../../utils/sentenceExtractor.js';
import type { RecordingContext, PipelineStepFunction } from '../types.js';
import { ErrorStrategy } from '../types.js';

/**
 * Extract important sentences from content using TextRank
 * Position: After privacyPipeline (uses PII-cleaned content)
 * Error Strategy: RETRY + fallback to original content
 */
export const extractSentencesStep: PipelineStepFunction = async (
  context: RecordingContext
): Promise<RecordingContext> => {
  const { data, settings, truncatedContent, sanitizedSummary, privacyResult } = context;
  const { url } = data;

  // Check if L0 extraction is enabled
  const l0Enabled = settings[StorageKeys.L0_EXTRACTIVE_ENABLED] ?? true;

  if (!l0Enabled) {
    addLog(LogType.INFO, 'L0 extractive compression disabled by settings', { url });
    return context;
  }

  // Determine content to extract from
  // Priority: sanitizedSummary (PII-cleaned) > privacyResult.summary > truncatedContent
  const contentToExtract = sanitizedSummary || privacyResult?.summary || truncatedContent || '';

  if (!contentToExtract || !contentToExtract.trim()) {
    addLog(LogType.WARN, 'No content available for L0 extraction', { url });
    return context;
  }

  // Get extraction options from settings
  const options = {
    topK: settings[StorageKeys.L0_EXTRACTIVE_TOP_K] as number | undefined ?? 10,
    minLength: settings[StorageKeys.L0_EXTRACTIVE_MIN_LENGTH] as number | undefined ?? 20,
    similarityThreshold: settings[StorageKeys.L0_EXTRACTIVE_SIMILARITY_THRESHOLD] as number | undefined ?? 0.3,
  };

  // Measure extraction performance
  const startTime = performance.now();

  try {
    // Extract sentences using TextRank
    const extracted = extractSentences(contentToExtract, options);

    // DEBUG: log content details
    addLog(LogType.DEBUG, 'L0 extraction debug', {
      url,
      contentLength: contentToExtract.length,
      extractedCount: extracted.length,
      extractedPreview: extracted.slice(0, 2).join(' | ').substring(0, 200)
    });

    const endTime = performance.now();
    const duration = endTime - startTime;

    // Check performance threshold
    const performanceThreshold = settings[StorageKeys.L0_EXTRACTIVE_PERFORMANCE_THRESHOLD] as number ?? 1000;
    
    if (duration > performanceThreshold) {
      addLog(LogType.WARN, 'L0 extraction exceeded performance threshold, using fallback', {
        url,
        duration,
        threshold: performanceThreshold
      });
      // Still return extracted sentences but log warning
    }

    // Calculate compression stats
    const stats = getCompressionStats(contentToExtract, extracted);

    addLog(LogType.INFO, 'L0 extraction completed', {
      url,
      originalLength: stats.originalLength,
      extractedLength: stats.extractedLength,
      compressionRatio: stats.compressionRatio.toFixed(2),
      sentenceCount: stats.sentenceCount,
      extractedSentencesCount: stats.extractedCount,
      duration: duration.toFixed(2)
    });

    // If extracted sentences is empty or very small, log warning
    if (extracted.length === 0 || stats.extractedLength < 10) {
      addLog(LogType.WARN, 'L0 extraction produced minimal output', {
        url,
        extractedSentencesCount: extracted.length,
        extractedLength: stats.extractedLength,
        contentLength: contentToExtract.length
      });
    }

    const encoder = new TextEncoder();
    const originalBytes = encoder.encode(contentToExtract).length;

    return {
      ...context,
      extractedSentences: extracted,
      extractedSentencesBytes: stats.extractedLength,
      extractedSentencesOriginalBytes: originalBytes,
      extractionDuration: duration
    };

  } catch (error) {
    // RETRY + fallback: Log error but continue with original content
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    addLog(LogType.ERROR, 'L0 extraction failed, using fallback', {
      url,
      error: errorMessage
    });

    // Add to errors but don't fail the pipeline (RETRY strategy fallback)
    return {
      ...context,
      errors: [
        ...context.errors,
        {
          step: 'extractSentences',
          error: error instanceof Error ? error : new Error(errorMessage),
          strategy: ErrorStrategy.BEST_EFFORT,
          timestamp: Date.now(),
          context: { url }
        }
      ]
    };
  }
};