import { type AIService, type AISummaryOptions, type AISummaryResult, type AISummaryMode } from './AIService.js';

interface LocalAIServiceConfig {
  localAiClient: {
    summarize(content: string): Promise<{ summary?: string }>;
  };
  ensureOffscreenDocument?(): Promise<void>;
}

export class LocalAIService implements AIService {
  constructor(private config: LocalAIServiceConfig) {}

  async generateSummary(content: string, options?: AISummaryOptions): Promise<AISummaryResult> {
    if (this.config.ensureOffscreenDocument) {
      await this.config.ensureOffscreenDocument();
    }
    const result = await this.config.localAiClient.summarize(content);
    return { summary: result.summary ?? '', usedLocal: true };
  }

  getSupportedModes(): AISummaryMode[] {
    return ['local_only'];
  }
}
