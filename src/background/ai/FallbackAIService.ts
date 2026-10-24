import {
  type AIService,
  type AISummaryOptions,
  type AISummaryResult,
  type AISummaryMode,
  type AiTestProgress,
  type AiConnectionTestResult,
} from './AIService.js';
import { errorMessage } from '../../utils/errorUtils.js';

interface FallbackConfig {
  local: AIService;
  remote: AIService;
}

/**
 * Diagnostic options for the connection-test seam. Mirrors the mode routing
 * of `generateSummary` so callers diagnose the same route they summarize.
 */
export interface FallbackConnectionTestOptions {
  mode?: AISummaryMode;
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
   * Diagnose the same route `generateSummary` would take for the given mode.
   * Explicit modes route to one side; `auto` or an omitted mode diagnoses
   * both routes and merges their provider results.
   *
   * Each side keeps its own meaning: the local result reports on-device model
   * availability while the remote result reports provider reachability (ADR
   * 2026-07-27). This seam never reinterprets either side; it only combines
   * them. The options parameter is optional so existing two-argument callers
   * keep working and receive the combined diagnosis.
   */
  async testConnection(
    onProgress?: (progress: AiTestProgress) => void,
    runId?: string,
    options?: FallbackConnectionTestOptions,
  ): Promise<AiConnectionTestResult> {
    const mode = options?.mode;

    if (mode === 'local_only') {
      return this.config.local.testConnection(onProgress, runId);
    }

    if (mode === 'full_pipeline' || mode === 'masked_cloud') {
      return this.config.remote.testConnection(onProgress, runId);
    }

    const [localResult, remoteResult] = await Promise.all([
      this.runRouteTest(this.config.local, onProgress, runId),
      this.runRouteTest(this.config.remote, onProgress, runId),
    ]);
    return {
      success: localResult.success || remoteResult.success,
      message: [localResult.message, remoteResult.message]
        .filter((part) => part.length > 0)
        .join('; '),
      providers: [...localResult.providers, ...remoteResult.providers],
    };
  }

  private async runRouteTest(
    service: AIService,
    onProgress?: (progress: AiTestProgress) => void,
    runId?: string,
  ): Promise<AiConnectionTestResult> {
    try {
      return await service.testConnection(onProgress, runId);
    } catch (error) {
      const message = errorMessage(error);
      return { success: false, message, providers: [] };
    }
  }
}
