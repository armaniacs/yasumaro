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
import { resolveModelKey } from './aiModelKey.js';
import { type AIProviderStrategy, type BuiltInAiProvider } from './providers/index.js';
import { PROVIDER_CATALOG, createProviderStrategy } from './providerCatalog.js';
import { LogType } from '../../utils/logger/types.js';
import { addLog } from '../../utils/logger/core.js';
import { errorMessage } from '../../utils/errorUtils.js';
import { FailureKind, createFailure, resolveFailure, type FailureMetadata } from '../../utils/failureTaxonomy.js';
import { recordAuditLog } from '../../utils/auditLog.js';
import { pickDefined } from '../../utils/objectUtils.js';
import { disabledBreaker, type ProviderBreakerLike, type ProviderCooldown } from './providerBreaker.js';

interface RemoteAIServiceConfig {
  builtInAiClient?: BuiltInAiProvider;
  repo?: SettingsReader;
  /** PBI 27-03: injected breaker; defaults to disabled (try all, remember nothing). */
  breaker?: ProviderBreakerLike;
}

/**
 * PBI 27-07: whether the breaker may consult or touch its state at all.
 * The flag is a kill switch, not a policy dial, so it defaults to enabled —
 * an absent key must not silently withdraw the PBI 27-03 behaviour. Only an
 * explicit `false` disables it.
 */
export function resolveBreakerGate(settings: Settings): boolean {
  return settings[StorageKeys.AI_PROVIDER_BREAKER_ENABLED] !== false;
}

export class RemoteAIService implements AIService {
  private providers: Map<string, (settings: Settings) => AIProviderStrategy>;
  private inFlightSummaryRequests: Map<string, Promise<AISummaryResult>>;
  private repo: SettingsReader;
  private breaker: ProviderBreakerLike;
  /**
   * PBI 27-07: the disabled-gate notice is a one-shot, not a per-request log —
   * the gate is a persistent setting, so saying so on every summary would
   * bury the rest of the log. Reset with the service worker, which is the
   * lifetime of this instance.
   */
  private loggedBreakerGateDisabled: boolean;

  constructor(private config: RemoteAIServiceConfig = {}) {
    this.providers = new Map();
    this.inFlightSummaryRequests = new Map();
    this.repo = config.repo ?? settingsRepository;
    this.breaker = config.breaker ?? disabledBreaker;
    this.loggedBreakerGateDisabled = false;
    this.registerDefaultProviders();
  }

  /** Load the full settings snapshot via the injected repository seam. */
  private loadSettings(): Promise<Settings> {
    return this.repo.getAll();
  }

  private registerDefaultProviders(): void {
    for (const [id] of PROVIDER_CATALOG) {
      this.registerProvider(id, (settings: Settings) => createProviderStrategy(id, settings));
    }
  }

  public registerProvider(name: string, factory: (settings: Settings) => AIProviderStrategy): void {
    this.providers.set(name, factory);
  }

  /** Maximum number of provider slots to process. */
  private static readonly MAX_PROVIDERS = 10;

  /**
   * Per-slot failure text (PBI 2026-09-22-04 follow-up). Providers stuff
   * their error into `summary`; a success-but-short summary gets an explicit
   * marker so "why was this slot skipped" is never ambiguous. Truncated —
   * this string is rendered in the history entry's error row.
   */
  private static describeSlotFailure(result: AISummaryResult, minLength: number): string {
    if (result.success === false) {
      const text = (result.error ?? result.summary ?? 'unknown error').trim();
      return text.substring(0, 300);
    }
    return `summary too short (${result.summary.length} < minLength ${minLength})`;
  }

  /**
   * Text for a call where every slot was held back by the breaker. Naming the
   * provider and the remaining wait is the point: the configuration is fine and
   * the user must not be sent to settings, nor have this text stored as their
   * page summary.
   */
  private static describeSuppressed(suppressed: { provider: string; cooldown?: ProviderCooldown }[]): string {
    const names = suppressed.map((s) => s.provider).join(', ');
    const soonest = Math.min(...suppressed.map((s) => s.cooldown?.openUntil ?? Date.now()));
    const minutes = Math.max(1, Math.ceil((soonest - Date.now()) / 60_000));
    return `Error: AI summary skipped — ${names} is temporarily paused after repeated failures. Retrying in about ${minutes} minute${minutes === 1 ? '' : 's'}.`;
  }

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
      return {
        success: false,
        summary: "Error: AI provider configuration is missing. Please check your settings.",
        failure: createFailure(FailureKind.CONFIGURATION),
      };
    }

    const effectiveSettings = this.applySlotModel(settings, slot);
    void recordAuditLog({ provider: slot.provider, url });

    try {
      const providerInstance = factory(effectiveSettings);
      const result = await providerInstance.generateSummary(content, tagSummaryMode, traceId);
      return result;
    } catch (error: unknown) {
      addLog(LogType.ERROR, `Generate summary failed: ${errorMessage(error)}`, { traceId });
      const result: AISummaryResult = {
        success: false,
        summary: "Error: Failed to generate summary. Please try again.",
      };
      // A provider that threw instead of returning a result must not lose its
      // classification on the way out.
      const failure = resolveFailure(error);
      return failure ? { ...result, failure } : result;
    }
  }

  async generateSummary(content: string, options?: AISummaryOptions): Promise<AISummaryResult> {
    const settings = await this.loadSettings();
    const minLength = settings[StorageKeys.SUMMARY_MIN_LENGTH]
      ?? (DEFAULT_SETTINGS[StorageKeys.SUMMARY_MIN_LENGTH] as number);
    const slots = this.resolveProviderSlots(settings);

    // PBI 27-07: read the gate off the snapshot we already hold. A second
    // settings read here would make the kill switch cost I/O on every summary,
    // and could disagree with the slots resolved from the same read.
    const breakerGateOpen = resolveBreakerGate(settings);
    if (!breakerGateOpen && !this.loggedBreakerGateDisabled) {
      this.loggedBreakerGateDisabled = true;
      addLog(LogType.INFO, 'AI provider circuit breaker disabled by user setting');
    }

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
        summary: "Error: AI provider configuration is missing. Please check your settings.",
        failure: createFailure(FailureKind.CONFIGURATION),
      };
      const attemptedProviders: string[] = [];
      const slotFailures: { provider: string; model?: string; error: string; failure?: FailureMetadata }[] = [];
      // Slots the breaker held back, with the cooldown that suppressed them.
      const suppressed: { provider: string; cooldown?: ProviderCooldown }[] = [];
      // Aggregate carrier: the FIRST slot that classified its failure. A total
      // failure stays a result (never a throw) so privacyPipeline's branch and
      // the result contract are unchanged; the kind simply rides along.
      let aggregateFailure: FailureMetadata | undefined;

      for (let index = 0; index < slots.length; index++) {
        const slot = slots[index]!;
        const slotModel = this.resolveEffectiveModel(settings, slot);
        // PBI 27-03: a slot in breaker cooldown is not attempted at all.
        // Skipped slots stay out of attemptedProviders (they were never
        // tried) and out of slotFailures (a skip is not a failure). When every
        // slot is cooling down the result must say so — falling through to
        // `lastResult` would tell the user their provider configuration is
        // missing, which is false for a provider that is only suppressed.
        // PBI 27-07: with the gate off the breaker is not consulted at all, so
        // `suppressed` stays empty and this branch is unreachable.
        if (breakerGateOpen && !(await this.breaker.shouldAttempt(slot.provider, slotModel))) {
          const cooldown = await this.breaker.cooldown(slot.provider, slotModel);
          suppressed.push({ provider: slot.provider, ...(cooldown ? { cooldown } : {}) });
          addLog(LogType.INFO, 'AI provider slot skipped (breaker cooldown)', {
            provider: slot.provider,
            ...pickDefined({ model: slotModel }),
            traceId: options?.traceId ?? '',
          });
          continue;
        }
        attemptedProviders.push(slot.provider);
        const result = await this.processSummarySlot(
          slot,
          settings,
          content,
          tagSummaryMode,
          options?.traceId ?? '',
          url,
        );
        if (breakerGateOpen) {
          if (result.success) {
            // Any success resets the breaker — even a too-short one: the
            // provider answered, so it is healthy (policy §3).
            await this.breaker.recordSuccess(slot.provider, slotModel);
          } else if (result.failure !== undefined) {
            // Only taxonomy-carrying failures feed the breaker. Success-but-
            // short results and unclassified failures are not breaker inputs.
            await this.breaker.recordFailure(slot.provider, slotModel, result.failure);
          }
        }
        if (result.success && result.summary.length >= minLength) {
          // A later slot recovered — keep the earlier failures for diagnostics.
          return slotFailures.length > 0 ? { ...result, slotFailures } : result;
        }
        // PBI 2026-09-22-04 follow-up: the fallback chain is only debuggable
        // if EACH failed slot says who failed and why — the previous loop kept
        // only the last error, so every multi-provider failure looked like one
        // provider's message. Capture + log per-slot detail, then continue.
        const error = RemoteAIService.describeSlotFailure(result, minLength);
        slotFailures.push({
          provider: slot.provider,
          ...(slot.model ? { model: slot.model } : {}),
          error,
          ...(result.failure ? { failure: result.failure } : {}),
        });
        if (aggregateFailure === undefined && result.failure !== undefined) {
          aggregateFailure = result.failure;
        }
        addLog(LogType.WARN, 'AI provider slot failed, trying next provider', {
          provider: slot.provider,
          ...(slot.model ? { model: slot.model } : {}),
          index,
          total: slots.length,
          error,
          traceId: options?.traceId ?? '',
        });
        lastResult = result;
      }

      if (attemptedProviders.length === 0 && suppressed.length > 0) {
        return {
          success: false,
          summary: RemoteAIService.describeSuppressed(suppressed),
          ...(suppressed[0]?.cooldown ? { failure: createFailure(suppressed[0].cooldown.kind) } : {}),
          attemptedProviders,
          slotFailures,
        };
      }

      return {
        ...lastResult,
        attemptedProviders,
        slotFailures,
        ...(aggregateFailure !== undefined ? { failure: aggregateFailure } : {}),
      };
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
    const breakerGateOpen = resolveBreakerGate(settings);

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

    // PBI 27-08: a passing diagnostic is the user telling us the credentials
    // are fixed, which is the one thing a cooldown cannot work out for itself —
    // an auth failure parks a provider for 15 minutes with no other way out.
    // Only success clears: a failing probe proves nothing the breaker does not
    // already know, and policy §7 keeps test results out of breaker state.
    // Gated like every other breaker touch, so the kill switch still wins.
    if (breakerGateOpen && anySuccess) {
      await this.breaker.clearAll();
      addLog(LogType.INFO, 'AI provider circuit breaker cooldown cleared after a successful connection test');
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
