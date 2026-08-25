import {
  type AIService,
  type AISummaryOptions,
  type AISummaryResult,
  type AISummaryMode,
  type AiTestProgress,
  type AiConnectionTestResult,
  type AiProviderTestResult,
} from './AIService.js';
import { settingsRepository, type SettingsReader } from '../../utils/storage/SettingsRepository.js';
import { DEFAULT_SETTINGS } from '../../utils/storage/defaults.js';
import { StorageKeys, Settings, ProviderSlot } from '../../utils/storage/types.js';
import { resolveModelKey } from '../../utils/aiModelKey.js';
import { GeminiProvider, BuiltInAiProvider, AIProviderStrategy } from './providers/index.js';
import { GenericOpenAICompatibleProvider } from './providers/OpenAIProvider.js';
import { PROVIDER_REGISTRY } from './providerRegistry.js';
import { addLog, LogType } from '../../utils/logger.js';
import { errorMessage } from '../../utils/errorUtils.js';
import { recordAuditLog } from '../../utils/auditLog.js';
import { pickDefined } from '../../utils/objectUtils.js';

interface RemoteAIServiceConfig {
  builtInAiClient?: BuiltInAiProvider;
  repo?: SettingsReader;
}

export class RemoteAIService implements AIService {
  private providers: Map<string, (settings: Settings) => AIProviderStrategy>;
  private inFlightSummaryRequests: Map<string, Promise<AISummaryResult>>;
  private repo: SettingsReader;

  constructor(private config: RemoteAIServiceConfig = {}) {
    this.providers = new Map();
    this.inFlightSummaryRequests = new Map();
    this.repo = config.repo ?? settingsRepository;
    this.registerDefaultProviders();
  }

  /** Load the full settings snapshot via the injected repository seam. */
  private loadSettings(): Promise<Settings> {
    return this.repo.getAll();
  }

  private registerDefaultProviders(): void {
    for (const [id] of PROVIDER_REGISTRY) {
        if (id === 'gemini') {
            this.registerProvider(id, (settings: Settings) => new GeminiProvider(settings));
            continue;
        }
        if (id === 'built-in-ai') {
            this.registerProvider(id, (settings: Settings) => new BuiltInAiProvider(settings));
            continue;
        }
        // OpenAI-compatible family: generic provider derives baseUrl/apiKey/model from registry entry
        const providerId = id;
        this.registerProvider(id, (settings: Settings) => new GenericOpenAICompatibleProvider(settings, providerId));
    }
  }

  public registerProvider(name: string, factory: (settings: Settings) => AIProviderStrategy): void {
    this.providers.set(name, factory);
  }

  /** Maximum number of provider slots to process. */
  private static readonly MAX_PROVIDERS = 10;

  private resolveProviderSlots(settings: Settings): ProviderSlot[] {
    const slots = settings[StorageKeys.AI_PROVIDER_PRIORITY_LIST] ?? [];
    const fallbackProvider = settings[StorageKeys.AI_PROVIDER]
      ?? (DEFAULT_SETTINGS[StorageKeys.AI_PROVIDER] as string);
    const resolved = (slots.length > 0)
      ? slots
      : [{ provider: fallbackProvider }];
    return resolved.slice(0, RemoteAIService.MAX_PROVIDERS);
  }

  private applySlotModel(settings: Settings, slot: ProviderSlot): Settings {
    if (!slot.model) {
      return settings;
    }
    const key = resolveModelKey(slot.provider);
    return { ...settings, [key]: slot.model } as Settings;
  }

  private resolveEffectiveModel(settings: Settings, slot: ProviderSlot): string | undefined {
    if (slot.model) {
      return slot.model;
    }
    const key = resolveModelKey(slot.provider);
    const model = (settings as unknown as Record<string, unknown>)[key] as string | undefined;
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
    const settings = await this.loadSettings();
    const minLength = settings[StorageKeys.SUMMARY_MIN_LENGTH]
      ?? (DEFAULT_SETTINGS[StorageKeys.SUMMARY_MIN_LENGTH] as number);
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
    const settings = await this.loadSettings();
    const slots = this.resolveProviderSlots(settings);

    const providerResults: AiProviderTestResult[] = [];
    let anySuccess = false;

    for (const [index, slot] of slots.entries()) {
      const slotStart = performance.now();
      const effectiveModel = this.resolveEffectiveModel(settings, slot);
      onProgress?.({
        provider: slot.provider,
        index,
        total: slots.length,
        ...pickDefined({ model: effectiveModel }),
        ...(runId !== undefined ? { runId } : {}),
      });

      const factory = this.providers.get(slot.provider);
      if (!factory) {
        providerResults.push({
          provider: slot.provider,
          success: false,
          message: `Unknown provider: ${slot.provider}`,
          elapsedMs: performance.now() - slotStart,
          debug: { error: `Provider "${slot.provider}" is not registered` },
          ...pickDefined({ model: effectiveModel }),
        });
        continue;
      }

      const effectiveSettings = this.applySlotModel(settings, slot);

      try {
        const providerInstance = factory(effectiveSettings);
        const result = await providerInstance.testConnection();
        providerResults.push({
          provider: slot.provider,
          success: result.success,
          message: result.message,
          elapsedMs: performance.now() - slotStart,
          ...pickDefined({ model: effectiveModel, debug: result.debug }),
        });
        if (result.success) {
          anySuccess = true;
        }
      } catch (error: unknown) {
        const msg = errorMessage(error);
        addLog(LogType.ERROR, `Connection test failed for ${slot.provider}: ${msg}`);
        providerResults.push({
          provider: slot.provider,
          success: false,
          message: msg,
          elapsedMs: performance.now() - slotStart,
          debug: { error: msg },
          ...pickDefined({ model: effectiveModel }),
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
