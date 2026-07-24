// src/background/privacyPipeline.ts
import { addLog, LogType } from '../utils/logger.js';
import { Settings, StorageKeys } from '../utils/storage.js';
import { parseTagsFromSummary, normalizeTags } from '../utils/tagUtils.js';
import type { TagNormalizationEntry } from '../utils/types.js';
import { sanitizePromptContent, DangerLevel } from '../utils/promptSanitizer.js';
import { addPendingPage } from '../utils/pendingStorage.js';
import type { AIService, AISummaryResult } from './ai/AIService.js';
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

interface ISanitizers {
  sanitizeRegex(text: string): Promise<{ text: string; maskedItems: MaskedItem[] }>;
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
  originalTokens?: number;
  cleansedTokens?: number;
  sentTokens?: number;
  receivedTokens?: number;
  providerName?: string;
  modelName?: string;
  /** クラウドAI要約(L3)の実呼び出し時間 (ミリ秒) — クラウドAIが呼ばれた場合のみセットされる */
  aiCallDurationMs?: number;
}

export class PrivacyPipeline {
  constructor(
    private settings: Settings,
    private aiService: AIService,
    private sanitizers: ISanitizers,
  ) {}

  private get mode(): string {
    return (this.settings as Record<string, unknown>)[StorageKeys.PRIVACY_MODE] as string || 'full_pipeline';
  }

  async process(
    content: string,
    options: {
      previewOnly?: boolean;
      alreadyProcessed?: boolean;
      tagSummaryMode?: boolean;
      url?: string;
      title?: string;
    } = {}
  ): Promise<PrivacyPipelineResult> {
    const { previewOnly = false, alreadyProcessed = false, url = '', title = '' } = options;

    if (!content) {
      return { summary: 'Summary not available.' };
    }

    const sanitizedSettings = this._buildSanitizedSettings(alreadyProcessed);
    let processingText = content;
    let maskedCount = 0;
    let maskedItems: (string | MaskedItem)[] = [];

    const originalTokens = estimateTokens(content);

    // L2: PII Masking — run before any AI (local or cloud) so that
    // on-device local AI also receives masked content when masking is enabled.
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

    // L1: Local Summarization
    const localResult = await this._performLocalSummarization(
      processingText,
      processingText,
      sanitizedSettings.useLocalAi,
      originalTokens,
      url,
      title
    );

    if (localResult?.returnEarly) {
      return localResult.result as PrivacyPipelineResult;
    }
    processingText = localResult?.processedText || processingText;

    // L3: Cloud Summarization
    if (sanitizedSettings.useCloudAi) {
      const aiCallStart = performance.now();
      const aiResult = await this.aiService.generateSummary(processingText, {
        mode: 'full_pipeline',
        tagSummaryMode: options.tagSummaryMode,
        url,
      });
      const aiCallDurationMs = performance.now() - aiCallStart;
      return this._processCloudResult(aiResult, maskedCount, originalTokens, cleansedTokens, aiCallDurationMs);
    }

    return { summary: 'Summary not available.', originalTokens, cleansedTokens };
  }

  private _buildSanitizedSettings(alreadyProcessed: boolean) {
    return {
      useLocalAi: (this.mode === 'local_only' || this.mode === 'full_pipeline') && !alreadyProcessed,
      // PII masking runs before any AI (local or cloud) so it must be enabled
      // in local_only mode as well.
      useMasking: (this.mode === 'full_pipeline' || this.mode === 'masked_cloud' || this.mode === 'local_only') && !alreadyProcessed,
      useCloudAi: this.mode !== 'local_only',
    };
  }

  private async _performLocalSummarization(
    content: string,
    processingText: string,
    useLocalAi: boolean,
    originalTokens: number,
    pageUrl: string = '',
    pageTitle: string = '',
  ): Promise<{
    returnEarly?: boolean;
    result?: PrivacyPipelineResult;
    processedText?: string;
  }> {
    if (!useLocalAi) {
      return {};
    }

    const localSanitizeResult = sanitizePromptContent(content);
    if (localSanitizeResult.dangerLevel === DangerLevel.HIGH) {
      addLog(LogType.ERROR, 'Local AI blocked - high danger content detected', {
        warnings: localSanitizeResult.warnings,
      });
      return { returnEarly: true, result: { summary: 'Error: Content blocked due to potential security risk.', originalTokens } };
    }

    const localResult = await this.aiService.generateSummary(localSanitizeResult.sanitized, { mode: 'local_only' });
    if (!localResult.summary) {
      if (this.mode === 'local_only') {
        void addPendingPage({
          url: pageUrl,
          title: pageTitle || pageUrl,
          timestamp: Date.now(),
          reason: 'local-ai-unavailable',
          errorMessage: 'Local AI summarization failed',
          expiry: Date.now() + (24 * 60 * 60 * 1000)
        });
        throw new Error('Local AI unavailable');
      }
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
    aiCallDurationMs: number,
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
      originalTokens,
      cleansedTokens,
      sentTokens: aiResult.sentTokens,
      receivedTokens: aiResult.receivedTokens,
      providerName: aiResult.providerName,
      modelName: aiResult.modelName,
      aiCallDurationMs,
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