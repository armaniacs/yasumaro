import { type AIService, type AISummaryOptions, type AISummaryResult, type AISummaryMode } from './AIService.js';

interface RemoteAIServiceConfig {
  aiClient: {
    generateSummary(content: string, tagSummaryMode?: boolean, url?: string): Promise<{ summary: string }>;
  };
}

export class RemoteAIService implements AIService {
  constructor(private config: RemoteAIServiceConfig) {}

  async generateSummary(content: string, options?: AISummaryOptions): Promise<AISummaryResult> {
    const result = await this.config.aiClient.generateSummary(
      content,
      options?.tagSummaryMode,
      options?.url,
    );
    return { summary: result.summary };
  }

  getSupportedModes(): AISummaryMode[] {
    return ['full_pipeline', 'masked_cloud'];
  }
}
