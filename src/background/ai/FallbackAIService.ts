import { type AIService, type AISummaryOptions, type AISummaryResult, type AISummaryMode } from './AIService.js';

interface FallbackConfig {
  local: AIService;
  remote: AIService;
}

export class FallbackAIService implements AIService {
  constructor(private config: FallbackConfig) {}

  async generateSummary(content: string, options?: AISummaryOptions): Promise<AISummaryResult> {
    const mode = options?.mode ?? 'full_pipeline';

    if (mode === 'local_only') {
      return this.config.local.generateSummary(content, options);
    }

    if (mode === 'full_pipeline' || mode === 'masked_cloud') {
      return this.config.remote.generateSummary(content, options);
    }

    // mode === 'auto': try local, fall back to remote
    try {
      return await this.config.local.generateSummary(content, options);
    } catch {
      return this.config.remote.generateSummary(content, options);
    }
  }

  getSupportedModes(): AISummaryMode[] {
    const localModes = this.config.local.getSupportedModes();
    const remoteModes = this.config.remote.getSupportedModes();
    return [...new Set([...localModes, ...remoteModes])];
  }
}
