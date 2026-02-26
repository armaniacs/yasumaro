// src/background/privacyPipeline.ts
import { addLog, LogType } from '../utils/logger.js';
import { Settings, StorageKeys } from '../utils/storage.js';
import { parseTagsFromSummary } from '../utils/tagUtils.js';

// Temporary interface until AIClient is converted
interface IAIClient {
  getLocalAvailability(): Promise<string>;
  summarizeLocally(content: string): Promise<{ success: boolean; summary: string }>;
  generateSummary(text: string, tagSummaryMode?: boolean): Promise<string>;
}

interface ISanitizers {
  sanitizeRegex(text: string): Promise<{ text: string; maskedItems: any[] }>;
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
  maskedItems?: any[];
  tags?: string[];  // タグリスト（タグ付き要約モード時）
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
    let maskedItems: any[] = [];

    // L1: Local Summarization
    if (sanitizedSettings.useLocalAi) {
      const localStatus = await this.aiClient.getLocalAvailability();
      if (localStatus === 'readily' || this.mode === 'local_only') {
        const localResult = await this.aiClient.summarizeLocally(content);
        if (localResult.success) {
          processingText = localResult.summary;
          if (this.mode === 'local_only') {
            return { summary: localResult.summary };
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

    if (previewOnly) {
      return {
        success: true,
        preview: true,
        processedContent: processingText,
        mode: this.mode,
        maskedCount,
        maskedItems
      };
    }

    // L3: Cloud Summarization
    if (sanitizedSettings.useCloudAi) {
      const summary = await this.aiClient.generateSummary(processingText, options.tagSummaryMode);

      // タグ付き要約モードの場合はタグを抽出
      let tags: string[] | undefined;
      if (options.tagSummaryMode && summary) {
        const parsed = parseTagsFromSummary(summary);
        tags = parsed.tags;
      }

      return { summary, maskedCount, tags };
    }

    return { summary: 'Summary not available.' };
  }

  private _logMasking(sanitizeResult: { maskedItems: any[] }): void {
    if (this.settings[StorageKeys.PII_SANITIZE_LOGS] !== false) {
      const count = sanitizeResult.maskedItems.length;
      if (count > 0) {
        addLog(LogType.SANITIZE, `Masked ${count} PII items`, {
          items: sanitizeResult.maskedItems.map(i => i.type)
        });
      }
    }
  }
}