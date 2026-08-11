import {
  type AIService,
  type AISummaryOptions,
  type AISummaryResult,
  type AISummaryMode,
  type AiTestProgress,
  type AiConnectionTestResult,
  type AiProviderTestResult,
} from './AIService.js';
import { getSettings, StorageKeys, type Settings, type ProviderSlot } from '../../utils/storage.js';
import { resolveModelKey } from '../../utils/aiModelKey.js';
import { GeminiProvider, OpenAIProvider, BuiltInAiProvider, AIProviderStrategy, AISummaryResult as ProviderAISummaryResult } from './providers/index.js';
import { addLog, LogType } from '../../utils/logger.js';
import { errorMessage } from '../../utils/errorUtils.js';
import { recordAuditLog } from '../../utils/auditLog.js';

interface RemoteAIServiceConfig {
  builtInAiClient?: BuiltInAiProvider;
  getSettings?: () => Promise<Settings>;
}

export class RemoteAIService implements AIService {
  private providers: Map<string, (settings: Settings) => AIProviderStrategy>;
  private inFlightSummaryRequests: Map<string, Promise<AISummaryResult>>;
  private getSettingsImpl: () => Promise<Settings>;

  constructor(private config: RemoteAIServiceConfig = {}) {
    this.providers = new Map();
    this.inFlightSummaryRequests = new Map();
    this.getSettingsImpl = config.getSettings || getSettings;
    this.registerDefaultProviders();
  }

  private registerDefaultProviders(): void {
    this.registerProvider('gemini', (settings: Settings) => new GeminiProvider(settings));
    this.registerProvider('openai', (settings: Settings) => new OpenAIProvider(settings, 'openai'));
    this.registerProvider('openai2', (settings: Settings) => new OpenAIProvider(settings, 'openai2'));
    this.registerProvider('lm-studio', (settings: Settings) => new OpenAIProvider(settings, 'lm-studio'));
    this.registerProvider('ollama', (settings: Settings) => new OpenAIProvider(settings, 'ollama'));
    this.registerProvider('openai-compatible', (settings: Settings) => new OpenAIProvider(settings, 'openai-compatible'));
    this.registerProvider('built-in-ai', (settings: Settings) => new BuiltInAiProvider(settings));
  }

  public registerProvider(name: string, factory: (settings: Settings) => AIProviderStrategy): void {
    this.providers.set(name, factory);
  }

  /** Maximum number of provider slots to process. */
  private static readonly MAX_PROVIDERS = 10;

  private resolveProviderSlots(settings: Settings): ProviderSlot[] {
    const slots = settings[StorageKeys.AI_PROVIDER_PRIORITY_LIST] as ProviderSlot[] | undefined;
    const resolved = (slots && slots.length > 0)
      ? slots
      : [{ provider: (settings[StorageKeys.AI_PROVIDER] as string) || 'gemini' }];
    return resolved.slice(0, RemoteAIService.MAX_PROVIDERS);
  }

  private applySlotModel(settings: Settings, slot: ProviderSlot): Settings {
    if (!slot.model) {
      return settings;
    }
    return { ...settings, [resolveModelKey(slot.provider)]: slot.model };
  }

  private resolveEffectiveModel(settings: Settings, slot: ProviderSlot): string | undefined {
    if (slot.model) {
      return slot.model;
    }
    const model = settings[resolveModelKey(slot.provider)] as string | undefined;
    return model ? model : undefined;
  }

  private async processSummarySlot(
    slot: ProviderSlot,
    settings: Settings,
    content: string,
    tagSummaryMode: boolean,
    traceId: string,
    url: string,
  ): Promise<AISummaryResult> {
    const factory = this.providers.get(slot.provider);
    if (!factory) {
      addLog(LogType.ERROR, `Unknown AI Provider: ${slot.provider}`, { traceId });
      return { success: false, summary: "Error: AI provider configuration is missing. Please check your settings." };
    }

    const effectiveSettings = this.applySlotModel(settings, slot);
    void recordAuditLog({ provider: slot.provider, url });

    try {
      const providerInstance = factory(effectiveSettings);
      const result = await providerInstance.generateSummary(content, tagSummaryMode, traceId);
      return result;
    } catch (error: unknown) {
      addLog(LogType.ERROR, `Generate summary failed: ${errorMessage(error)}`, { traceId });
      return { success: false, summary: "Error: Failed to generate summary. Please try again." };
    }
  }

  async generateSummary(content: string, options?: AISummaryOptions): Promise<AISummaryResult> {
    const settings = await this.getSettingsImpl();
    const minLength = (settings[StorageKeys.SUMMARY_MIN_LENGTH] as number) || 0;
    const slots = this.resolveProviderSlots(settings);

    // In-flight deduplication: concurrent calls for the same URL+mode share
    // one provider slot loop (FinOptimization: prevent duplicate API costs).
    const url = options?.url ?? '';
    const tagSummaryMode = options?.tagSummaryMode ?? false;
    const dedupeKey = url ? `${url}::${tagSummaryMode}` : null;

    if (dedupeKey) {
      const existing = this.inFlightSummaryRequests.get(dedupeKey);
      if (existing) {
        return existing;
      }
    }

    const requestPromise = (async (): Promise<AISummaryResult> => {
      let lastResult: AISummaryResult = {
        success: false,
        summary: "Error: AI provider configuration is missing. Please check your settings."
      };

      for (const slot of slots) {
        const result = await this.processSummarySlot(
          slot,
          settings,
          content,
          tagSummaryMode,
          options?.traceId ?? '',
          url,
        );
        if (result.success && result.summary.length >= minLength) {
          return result;
        }
        lastResult = result;
      }

      return lastResult;
    })();

    if (dedupeKey) {
      this.inFlightSummaryRequests.set(dedupeKey, requestPromise);
      requestPromise.finally(() => {
        this.inFlightSummaryRequests.delete(dedupeKey);
      });
    }

    return requestPromise;
  }

  getSupportedModes(): AISummaryMode[] {
    return ['full_pipeline', 'masked_cloud'];
  }

  async testConnection(
    onProgress?: (progress: AiTestProgress) => void,
    runId?: string,
  ): Promise<AiConnectionTestResult> {
    const settings = await this.getSettingsImpl();
    const slots = this.resolveProviderSlots(settings);

    const providerResults: AiProviderTestResult[] = [];
    let anySuccess = false;

    for (const [index, slot] of slots.entries()) {
      const slotStart = performance.now();
      const effectiveModel = this.resolveEffectiveModel(settings, slot);
      onProgress?.({
        provider: slot.provider,
        model: effectiveModel,
        index,
        total: slots.length,
        ...(runId !== undefined ? { runId } : {}),
      });

      const factory = this.providers.get(slot.provider);
      if (!factory) {
        providerResults.push({
          provider: slot.provider,
          model: effectiveModel,
          success: false,
          message: `Unknown provider: ${slot.provider}`,
          elapsedMs: performance.now() - slotStart,
          debug: { error: `Provider "${slot.provider}" is not registered` },
        });
        continue;
      }

      const effectiveSettings = this.applySlotModel(settings, slot);

      try {
        const providerInstance = factory(effectiveSettings);
        const result = await providerInstance.testConnection();
        providerResults.push({
          provider: slot.provider,
          model: effectiveModel,
          success: result.success,
          message: result.message,
          elapsedMs: performance.now() - slotStart,
          debug: result.debug,
        });
        if (result.success) {
          anySuccess = true;
        }
      } catch (error: unknown) {
        const msg = errorMessage(error);
        addLog(LogType.ERROR, `Connection test failed for ${slot.provider}: ${msg}`);
        providerResults.push({
          provider: slot.provider,
          model: effectiveModel,
          success: false,
          message: msg,
          elapsedMs: performance.now() - slotStart,
          debug: { error: msg },
        });
      }
    }

    const overallMessage = anySuccess
      ? providerResults.filter(r => r.success).map(r => `${r.provider}: OK`).join(', ')
      : providerResults.map(r => `${r.provider}: ${r.message}`).join('; ');

    return {
      success: anySuccess,
      message: overallMessage,
      providers: providerResults,
    };
  }
}
