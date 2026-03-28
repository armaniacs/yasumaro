// src/background/privacyPipeline.ts
import { addLog, LogType } from '../utils/logger.js';
import { Settings, StorageKeys } from '../utils/storage.js';
import { parseTagsFromSummary } from '../utils/tagUtils.js';
import { sanitizePromptContent, DangerLevel } from '../utils/promptSanitizer.js';
import type { AISummaryResult } from './ai/providers/ProviderStrategy.js';
import type { MaskedItem } from '../messaging/types.js';

/**
 * 文字数からトークン数を近似計算する
 * 日本語と英語でトークン数の計算方法が異なるため、簡単な近似値を使用
 * @param text テキスト
 * @returns トークン数（近似値）
 */
function estimateTokens(text: string): number {
  if (!text) return 0;
  
  // 日本語文字（ひらがな、カタカナ、漢字）を検出
  const japaneseRegex = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/;
  const hasJapanese = japaneseRegex.test(text);
  
  if (hasJapanese) {
    // 日本語: 1トークン≈2文字
    return Math.ceil(text.length / 2);
  } else {
    // 英語: 1トークン≈4文字
    return Math.ceil(text.length / 4);
  }
}

// Temporary interface until AIClient is converted
interface IAIClient {
  getLocalAvailability(): Promise<string>;
  summarizeLocally(content: string): Promise<{ success: boolean; summary: string; sentTokens?: number; receivedTokens?: number }>;
  generateSummary(text: string, tagSummaryMode?: boolean): Promise<AISummaryResult>;
}

interface ISanitizers {
  sanitizeRegex(text: string): Promise<{ text: string; maskedItems: MaskedItem[] }>;
}

export interface PrivacyPipelineOptions {
  previewOnly?: boolean;
  alreadyProcessed?: boolean;
  tagSummaryMode?: boolean;  // タグ付き要約モード
}

export interface PrivacyPipelineResult {
  summary?: string;
  success?: boolean;
  preview?: boolean;
  processedContent?: string;
  mode?: string;
  maskedCount?: number;
  maskedItems?: (string | MaskedItem)[];
  tags?: string[];  // タグリスト（タグ付き要約モード時）
  sentTokens?: number;  // 送信トークン数
  receivedTokens?: number;  // 受信トークン数
  originalTokens?: number;  // 元のトークン数
  cleansedTokens?: number;  // クレンジング後のトークン数
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
    const { previewOnly = false, alreadyProcessed = false } = options;

    if (!content) {
      return { summary: 'Summary not available.' };
    }

    const sanitizedSettings = {
      useLocalAi: (this.mode === 'local_only' || this.mode === 'full_pipeline') && !alreadyProcessed,
      useMasking: (this.mode === 'full_pipeline' || this.mode === 'masked_cloud') && !alreadyProcessed,
      useCloudAi: this.mode !== 'local_only'
    };

    let processingText = content;
    let maskedCount = 0;
    let maskedItems: (string | MaskedItem)[] = [];

    // 元のトークン数を計算
    const originalTokens = estimateTokens(content);

    // L1: Local Summarization
    if (sanitizedSettings.useLocalAi) {
      const localStatus = await this.aiClient.getLocalAvailability();
      if (localStatus === 'readily' || this.mode === 'local_only') {
        const localResult = await this.aiClient.summarizeLocally(content);
        if (localResult.success) {
          processingText = localResult.summary;
          if (this.mode === 'local_only') {
            return { summary: localResult.summary, originalTokens };
          }
        }
      }
    }

    // L2: PII Masking
    if (sanitizedSettings.useMasking) {
      const sanitizeResult = await this.sanitizers.sanitizeRegex(processingText);
      processingText = sanitizeResult.text;
      maskedItems = sanitizeResult.maskedItems;
      maskedCount = maskedItems.length;

      this._logMasking(sanitizeResult);
    }

    // クレンジング後のトークン数を計算
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
        cleansedTokens
      };
    }

    // L3: Cloud Summarization
    if (sanitizedSettings.useCloudAi) {
      const aiResult = await this.aiClient.generateSummary(processingText, options.tagSummaryMode);

      // AI要約結果をサニタイズ（プロンプトインジェクション対策）
      let sanitizedSummary = aiResult.summary;
      let tags: string[] | undefined;
      if (aiResult.summary) {
        const sanitizeResult = sanitizePromptContent(aiResult.summary);
        sanitizedSummary = sanitizeResult.sanitized;

        // 危険度が高い場合はログに記録
        if (sanitizeResult.dangerLevel === DangerLevel.HIGH) {
          addLog(LogType.WARN, 'AI summary sanitized - high danger content detected', {
            warnings: sanitizeResult.warnings
          });
        }

        // タグを抽出（タグ付き要約モード、またはカスタムプロンプトが #タグ | 要約 形式を返した場合）
        const parsed = parseTagsFromSummary(sanitizedSummary);
        tags = parsed.tags.length > 0 ? parsed.tags : undefined;
      }

      return {
        summary: sanitizedSummary,
        maskedCount,
        tags,
        sentTokens: aiResult.sentTokens,
        receivedTokens: aiResult.receivedTokens,
        originalTokens,
        cleansedTokens
      };
    }

    return { summary: 'Summary not available.', originalTokens, cleansedTokens };
  }

  private _logMasking(sanitizeResult: { maskedItems: (string | MaskedItem)[] }): void {
    if (this.settings[StorageKeys.PII_SANITIZE_LOGS] !== false) {
      const count = sanitizeResult.maskedItems.length;
      if (count > 0) {
        addLog(LogType.SANITIZE, `Masked ${count} PII items`, {
          items: sanitizeResult.maskedItems.map(i => typeof i === 'string' ? i : i.type)
        });
      }
    }
  }
}