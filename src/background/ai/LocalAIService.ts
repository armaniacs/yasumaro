import { type AIService, type AISummaryOptions, type AISummaryResult, type AISummaryMode } from './AIService.js';

interface LocalAIServiceConfig {
  localAiClient: {
    summarizeLocally(content: string): Promise<{ summary?: string }>;
    getLocalAvailability(): Promise<boolean>;
  };
  ensureOffscreenDocument?(): Promise<void>;
}

export class LocalAIService implements AIService {
  constructor(private config: LocalAIServiceConfig) {}

  async generateSummary(content: string, options?: AISummaryOptions): Promise<AISummaryResult> {
    if (this.config.ensureOffscreenDocument) {
      await this.config.ensureOffscreenDocument();
    }
    const result = await this.config.localAiClient.summarizeLocally(content);
    return { summary: result.summary ?? '', usedLocal: true };
  }

  getSupportedModes(): AISummaryMode[] {
    return ['local_only'];
  }
}
