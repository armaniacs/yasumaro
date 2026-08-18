import {
  type AIService,
  type AISummaryOptions,
  type AISummaryResult,
  type AISummaryMode,
  type AiTestProgress,
  type AiConnectionTestResult,
} from './AIService.js';
import { pickDefined } from '../../utils/objectUtils.js';

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
    /** Availability of the on-device model, e.g. 'available' / 'unavailable'. */
    getAvailability?(): Promise<string>;
  };
}

export class LocalAIService implements AIService {
  constructor(private config: LocalAIServiceConfig) {}

  async generateSummary(content: string, _options?: AISummaryOptions): Promise<AISummaryResult> {
    const result = await this.config.localAiClient.summarize(content);
    return {
      summary: result.summary ?? '',
      usedLocal: true,
      providerName: LOCAL_AI_PROVIDER_NAME,
      success: result.success ?? true,
      ...pickDefined({
        sentTokens: result.sentTokens,
        receivedTokens: result.receivedTokens,
        error: result.error,
      }),
    };
  }

  getSupportedModes(): AISummaryMode[] {
    return ['local_only'];
  }

  /**
   * Report whether the on-device model is usable. There is no endpoint to
   * reach, so "connection" here means model availability.
   */
  async testConnection(
    _onProgress?: (progress: AiTestProgress) => void,
    _runId?: string,
  ): Promise<AiConnectionTestResult> {
    const startedAt = Date.now();
    if (!this.config.localAiClient.getAvailability) {
      return {
        success: false,
        message: 'Local AI client does not report availability.',
        providers: [],
      };
    }

    try {
      const availability = await this.config.localAiClient.getAvailability();
      const success = availability === 'available';
      return {
        success,
        message: success
          ? 'On-device model is available.'
          : `On-device model is not available (${availability}).`,
        providers: [{
          provider: LOCAL_AI_PROVIDER_NAME,
          success,
          message: `availability=${availability}`,
          elapsedMs: Date.now() - startedAt,
          debug: { availability },
        }],
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
        providers: [],
      };
    }
  }
}
