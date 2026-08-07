import { type AIService, type AISummaryOptions, type AISummaryResult, type AISummaryMode } from './AIService.js';

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
    }>;
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
    };
  }

  getSupportedModes(): AISummaryMode[] {
    return ['full_pipeline', 'masked_cloud'];
  }
}
