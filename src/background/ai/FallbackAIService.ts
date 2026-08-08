import {
  type AIService,
  type AISummaryOptions,
  type AISummaryResult,
  type AISummaryMode,
  type AiTestProgress,
  type AiConnectionTestResult,
} from './AIService.js';

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

    // mode === 'auto': try local, fall back to remote on failure
    try {
      const localResult = await this.config.local.generateSummary(content, options);
      if (localResult.success === false) {
        return this.config.remote.generateSummary(content, options);
      }
      return localResult;
    } catch {
      return this.config.remote.generateSummary(content, options);
    }
  }

  getSupportedModes(): AISummaryMode[] {
    const localModes = this.config.local.getSupportedModes();
    const remoteModes = this.config.remote.getSupportedModes();
    return [...new Set([...localModes, ...remoteModes])];
  }

  /**
   * Delegate to the remote service: the connection-test UI exists to validate
   * remote provider credentials and model names, which is what users configure.
   * On-device availability is surfaced separately by the diagnostics panel.
   */
  async testConnection(
    onProgress?: (progress: AiTestProgress) => void,
    runId?: string,
  ): Promise<AiConnectionTestResult> {
    return this.config.remote.testConnection(onProgress, runId);
  }
}
