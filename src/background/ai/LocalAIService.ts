import {
  type AIService,
  type AISummaryOptions,
  type AISummaryResult,
  type AISummaryMode,
  type AiTestProgress,
  type AiConnectionTestResult,
} from './AIService.js';
import { BuiltInAiProvider, type BuiltInAiSummarizer } from './providers/BuiltInAiProvider.js';
import { settingsRepository, type SettingsReader } from '../../utils/storage/SettingsRepository.js';
import { type Settings } from '../../utils/storage/types.js';
import { pickDefined } from '../../utils/objectUtils.js';
import { errorMessage } from '../../utils/errorUtils.js';

/** Provider identifier reported for history entries produced via this service. */
const LOCAL_AI_PROVIDER_NAME = 'built-in-ai';

/**
 * Factory for the per-call strategy adapter. BuiltInAiProvider owns the whole
 * built-in-ai behaviour (custom prompts, tag summary mode, usage recording) so
 * the local path and the remote slot path cannot drift apart.
 */
export type BuiltInProviderFactory = (settings: Settings) => Pick<BuiltInAiProvider, 'generateSummary'>;

interface LocalAIServiceConfig {
  /** On-device model client; also serves availability checks and, by default, the strategy adapter. */
  localAiClient: BuiltInAiSummarizer;
  /** Settings seam (defaults to settingsRepository), mirroring RemoteAIService. */
  repo?: SettingsReader;
  /** Override the strategy adapter (for testing). */
  providerFactory?: BuiltInProviderFactory;
}

export class LocalAIService implements AIService {
  private repo: SettingsReader;

  constructor(private config: LocalAIServiceConfig) {
    this.repo = config.repo ?? settingsRepository;
  }

  async generateSummary(content: string, options?: AISummaryOptions): Promise<AISummaryResult> {
    // Same instantiation idiom as RemoteAIService: read the settings snapshot,
    // build the strategy adapter, delegate. Going through BuiltInAiProvider
    // keeps ONE adapter owning built-in-ai behaviour — custom prompts and
    // usage recording apply to the local path exactly as to the remote slot
    // path (ADR-015; dropping them here silently disabled configured prompts
    // in local_only mode).
    const settings = await this.repo.getAll();
    const provider = (this.config.providerFactory ?? ((s: Settings) => new BuiltInAiProvider(s, this.config.localAiClient)))(settings);
    const result = await provider.generateSummary(content, options?.tagSummaryMode ?? false, options?.traceId ?? '');

    if (result.success === false) {
      // Preserve the historical local-path failure shape: empty summary so the
      // privacy pipeline's not-available handling (addPendingPage / remote
      // fallback) fires on the summary field, with the reason carried in error.
      return {
        success: false,
        summary: '',
        usedLocal: true,
        ...pickDefined({
          providerName: result.providerName ?? LOCAL_AI_PROVIDER_NAME,
          error: result.summary || undefined,
        }),
      };
    }

    return {
      ...result,
      usedLocal: true,
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
        message: errorMessage(error),
        providers: [],
      };
    }
  }
}
