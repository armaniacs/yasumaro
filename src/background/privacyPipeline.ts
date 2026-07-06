// src/background/privacyPipeline.ts
import { addLog, LogType } from '../utils/logger.js';
import { Settings, StorageKeys } from '../utils/storage.js';
import { parseTagsFromSummary, normalizeTags } from '../utils/tagUtils.js';
import type { TagNormalizationEntry } from '../utils/types.js';
import { sanitizePromptContent, DangerLevel } from '../utils/promptSanitizer.js';
import type { AISummaryResult } from './ai/providers/ProviderStrategy.js';
import type { MaskedItem } from '../messaging/types.js';

/**
 * Calculate token count approximation from text length.
 * Japanese and English have different token calculation methods,
 * so we use simple approximations.
 * @param text - Text to estimate tokens for
 * @returns Approximate token count
 */
function estimateTokens(text: string): number {
  if (!text) return 0;

  // Check for Japanese characters (Hiragana, Katakana, Kanji)
  const japaneseRegex = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/;
  const hasJapanese = japaneseRegex.test(text);

  if (hasJapanese) {
    // Japanese: ~2 characters per token
    return Math.ceil(text.length / 2);
  }

  // English: ~4 characters per token
  return Math.ceil(text.length / 4);
}

// Temporary interface until AIClient is converted
export interface IAIClient {
  getLocalAvailability(): Promise<string>;
  summarizeLocally(content: string): Promise<{ success: boolean; summary: string; sentTokens?: number; receivedTokens?: number }>;
  generateSummary(text: string, tagSummaryMode?: boolean, url?: string): Promise<AISummaryResult>;
}

interface ISanitizers {
  sanitizeRegex(text: string): Promise<{ text: string; maskedItems: MaskedItem[] }>;
}

export interface PrivacyPipelineOptions {
  previewOnly?: boolean;
  alreadyProcessed?: boolean;
  tagSummaryMode?: boolean;
  url?: string;
}

export interface PrivacyPipelineResult {
  summary?: string;
  success?: boolean;
  preview?: boolean;
  processedContent?: string;
  mode?: string;
  maskedCount?: number;
  maskedItems?: (string | MaskedItem)[];
  tags?: string[];
  sentTokens?: number;
  receivedTokens?: number;
  originalTokens?: number;
  cleansedTokens?: number;
  aiProvider?: string;
  aiModel?: string;
}

export class PrivacyPipeline {
  private settings: Settings;
  private aiClient: IAIClient;
  private sanitizers: ISanitizers;
  private mode: string;

  constructor(settings: Settings, aiClient: IAIClient, sanitizers: ISanitizers) {
    this.settings = settings;
    this.aiClient = aiClient;
    this.sanitizers = sanitizers;
    this.mode = settings[StorageKeys.PRIVACY_MODE] || 'full_pipeline';
  }

  async process(content: string, options: PrivacyPipelineOptions = {}): Promise<PrivacyPipelineResult> {
    const { previewOnly = false, alreadyProcessed = false, url = '' } = options;

    if (!content) {
      return { summary: 'Summary not available.' };
    }

    const sanitizedSettings = this._buildSanitizedSettings(alreadyProcessed);
    let processingText = content;
    let maskedCount = 0;
    let maskedItems: (string | MaskedItem)[] = [];

    const originalTokens = estimateTokens(content);

    // L1: Local Summarization
    const localResult = await this._performLocalSummarization(
      content,
      processingText,
      sanitizedSettings.useLocalAi,
      originalTokens
    );

    if (localResult?.returnEarly) {
      return localResult.result as PrivacyPipelineResult;
    }
    processingText = localResult?.processedText || processingText;

    // L2: PII Masking
    if (sanitizedSettings.useMasking) {
      const sanitizeResult = await this.sanitizers.sanitizeRegex(processingText);
      processingText = sanitizeResult.text;
      maskedItems = sanitizeResult.maskedItems;
      maskedCount = maskedItems.length;
      this._logMasking(sanitizeResult);
    }

    const cleansedTokens = estimateTokens(processingText);

    if (previewOnly) {
      return {
        success: true,
        preview: true,
        processedContent: processingText,
        mode: this.mode,
        maskedCount,
        maskedItems,
        originalTokens,
        cleansedTokens,
      };
    }

    // L3: Cloud Summarization
    if (sanitizedSettings.useCloudAi) {
      const aiResult = await this.aiClient.generateSummary(processingText, options.tagSummaryMode, url);
      return this._processCloudResult(aiResult, maskedCount, originalTokens, cleansedTokens);
    }

    return { summary: 'Summary not available.', originalTokens, cleansedTokens };
  }

  private _buildSanitizedSettings(alreadyProcessed: boolean) {
    return {
      useLocalAi: (this.mode === 'local_only' || this.mode === 'full_pipeline') && !alreadyProcessed,
      useMasking: (this.mode === 'full_pipeline' || this.mode === 'masked_cloud') && !alreadyProcessed,
      useCloudAi: this.mode !== 'local_only',
    };
  }

  private async _performLocalSummarization(
    content: string,
    processingText: string,
    useLocalAi: boolean,
    originalTokens: number,
  ): Promise<{
    returnEarly?: boolean;
    result?: PrivacyPipelineResult;
    processedText?: string;
  }> {
    if (!useLocalAi) {
      return {};
    }

    const localStatus = await this.aiClient.getLocalAvailability();
    if (localStatus !== 'readily' && this.mode !== 'local_only') {
      return {};
    }

    const localSanitizeResult = sanitizePromptContent(content);
    if (localSanitizeResult.dangerLevel === DangerLevel.HIGH) {
      addLog(LogType.ERROR, 'Local AI blocked - high danger content detected', {
        warnings: localSanitizeResult.warnings,
      });
      return { returnEarly: true, result: { summary: 'Error: Content blocked due to potential security risk.', originalTokens } };
    }

    const localResult = await this.aiClient.summarizeLocally(localSanitizeResult.sanitized);
    if (!localResult.success || !localResult.summary) {
      return {};
    }

    const summarySanitizeResult = sanitizePromptContent(localResult.summary);
    if (summarySanitizeResult.dangerLevel === DangerLevel.HIGH) {
      addLog(LogType.WARN, 'Local AI summary sanitized - high danger content detected', {
        warnings: summarySanitizeResult.warnings,
      });
    }

    const processedText = summarySanitizeResult.sanitized;

    if (this.mode === 'local_only') {
      return { returnEarly: true, result: { summary: processedText, originalTokens } };
    }

    return { processedText };
  }

  private _processCloudResult(
    aiResult: AISummaryResult,
    maskedCount: number,
    originalTokens: number,
    cleansedTokens: number,
  ): PrivacyPipelineResult {
    let sanitizedSummary = aiResult.summary || '';
    let tags: string[] | undefined;

    if (aiResult.summary) {
      const sanitizeResult = sanitizePromptContent(aiResult.summary);
      sanitizedSummary = sanitizeResult.sanitized;

      if (sanitizeResult.dangerLevel === DangerLevel.HIGH) {
        addLog(LogType.WARN, 'AI summary sanitized - high danger content detected', {
          warnings: sanitizeResult.warnings,
        });
      }

      const parsed = parseTagsFromSummary(sanitizedSummary);
      // Apply tag normalization dictionary (normalizeTags is a no-op for empty dict)
      const dict = (this.settings[StorageKeys.TAG_NORMALIZATION_DICT] ?? []) as TagNormalizationEntry[];
      const normalizedTags = normalizeTags(parsed.tags, dict);
      tags = normalizedTags.length > 0 ? normalizedTags : undefined;
      sanitizedSummary = parsed.summary;
      sanitizedSummary = sanitizedSummary.replace(/\n+/g, ' ').replace(/  +/g, ' ').trim();
    }

    return {
      summary: sanitizedSummary,
      maskedCount,
      tags,
      sentTokens: aiResult.sentTokens,
      receivedTokens: aiResult.receivedTokens,
      originalTokens,
      cleansedTokens,
      aiProvider: aiResult.providerName,
      aiModel: aiResult.model,
    };
  }

  private _logMasking(sanitizeResult: { maskedItems: (string | MaskedItem)[] }): void {
    if (this.settings[StorageKeys.PII_SANITIZE_LOGS] === false) {
      return;
    }

    const count = sanitizeResult.maskedItems.length;
    if (count === 0) {
      return;
    }

    addLog(LogType.SANITIZE, `Masked ${count} PII items`, {
      items: sanitizeResult.maskedItems.map(item => typeof item === 'string' ? item : item.type),
    });
  }
}