import {
  type AIService,
  type AISummaryOptions,
  type AISummaryResult,
  type AISummaryMode,
  type AiTestProgress,
  type AiConnectionTestResult,
} from './AIService.js';

interface RemoteAIServiceConfig {
  aiClient: {
    generateSummary(
      content: string,
      tagSummaryMode?: boolean,
      url?: string,
      traceId?: string
    ): Promise<{
      summary: string;
      sentTokens?: number;
      receivedTokens?: number;
      providerName?: string;
      modelName?: string;
      /** Whether the underlying provider reported success. */
      success?: boolean;
      /** Error message from the underlying provider when success is false. */
      error?: string;
    }>;
    testConnection(
      onProgress?: (progress: AiTestProgress) => void,
      runId?: string
    ): Promise<AiConnectionTestResult>;
  };
}

export class RemoteAIService implements AIService {
  constructor(private config: RemoteAIServiceConfig) {}

  async generateSummary(content: string, options?: AISummaryOptions): Promise<AISummaryResult> {
    const result = await this.config.aiClient.generateSummary(
      content,
      options?.tagSummaryMode,
      options?.url,
      options?.traceId,
    );
    return {
      summary: result.summary,
      sentTokens: result.sentTokens,
      receivedTokens: result.receivedTokens,
      providerName: result.providerName,
      modelName: result.modelName,
      // success/error must be forwarded: FallbackAIService's 'auto' branch keys
      // on `success === false`, so dropping them made every remote failure read
      // as `undefined` and silently pass as a success.
      success: result.success,
      error: result.error,
    };
  }

  getSupportedModes(): AISummaryMode[] {
    return ['full_pipeline', 'masked_cloud'];
  }

  async testConnection(
    onProgress?: (progress: AiTestProgress) => void,
    runId?: string,
  ): Promise<AiConnectionTestResult> {
    return this.config.aiClient.testConnection(onProgress, runId);
  }
}
