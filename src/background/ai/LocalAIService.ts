import { type AIService, type AISummaryOptions, type AISummaryResult, type AISummaryMode } from './AIService.js';

/** Provider identifier reported for history entries produced via this service. */
const LOCAL_AI_PROVIDER_NAME = 'built-in-ai';

interface LocalAiSummarizeResult {
  summary?: string;
  sentTokens?: number;
  receivedTokens?: number;
  /** Whether the underlying provider reported success. */
  success?: boolean;
  /** Error message from the underlying provider. */
  error?: string;
}

interface LocalAIServiceConfig {
  localAiClient: {
    summarize(content: string): Promise<LocalAiSummarizeResult>;
  };
}

export class LocalAIService implements AIService {
  constructor(private config: LocalAIServiceConfig) {}

  async generateSummary(content: string, options?: AISummaryOptions): Promise<AISummaryResult> {
    const result = await this.config.localAiClient.summarize(content);
    return {
      summary: result.summary ?? '',
      usedLocal: true,
      sentTokens: result.sentTokens,
      receivedTokens: result.receivedTokens,
      providerName: LOCAL_AI_PROVIDER_NAME,
      success: result.success,
      error: result.error,
    };
  }

  getSupportedModes(): AISummaryMode[] {
    return ['local_only'];
  }
}
