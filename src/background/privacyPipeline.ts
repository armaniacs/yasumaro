// src/background/privacyPipeline.ts
import { LogType } from '../utils/logger/types.js';
import { addLog } from '../utils/logger/core.js';
import { Settings, StorageKeys } from '../utils/storage/types.js';
import type { PrivacyMode } from '../utils/storage/types.js';
import { normalizePrivacyMode } from '../utils/storage/defaults.js';
import { parseTagsFromSummary, normalizeTags } from '../utils/tagUtils.js';
import type { TagNormalizationEntry } from '../utils/types.js';
import { checkPromptSafety } from '../utils/promptSafety.js';
import { isDegenerateOutput } from '../utils/llmOutputGuard.js';
import { addPendingPage } from '../utils/pendingStorage.js';
import type { AIService, AISummaryResult } from './ai/AIService.js';
import type { MaskedItem } from '../messaging/types.js';
import { pickDefined } from '../utils/objectUtils.js';
import { SUMMARY_EMPTY_FALLBACK } from '../utils/summaryFallback.js';
import { resolveAiDomainPolicy } from '../utils/storage/aiDomainPolicy.js';
import type { AiDomainPolicy } from '../utils/storage/types.js';
import type { FailureMetadata } from '../utils/failureTaxonomy.js';

/**
 * Calculate token count approximation from text length.
 * Japanese and English have different token calculation methods,
 * so we use simple approximations.
 * @param text - Text to estimate tokens for
 * @returns Approximate token count
 */
function estimateTokens(text: string): number {
  if (!text) return 0;

  // Check for Japanese characters (Hiragana, Katakana, Kanji)
  const japaneseRegex = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/;
  const hasJapanese = japaneseRegex.test(text);

  if (hasJapanese) {
    // Japanese: ~2 characters per token
    return Math.ceil(text.length / 2);
  }

  // English: ~4 characters per token
  return Math.ceil(text.length / 4);
}

/** Substituted for a summary the guard flags as degenerate (repetition loop, keyword spam). */
export const DEGENERATE_SUMMARY_FALLBACK = '要約に失敗しました（AI出力が不自然なため）';

/**
 * Branching decision for one process() call (PBI 2026-11-20-03, pure part).
 * `useMasking` is the effective decision: a mask-required domain forces
 * masking even in cloud_only mode, where the base flags leave it off.
 */
export interface PipelinePlan {
  mode: PrivacyMode;
  domainPolicy: AiDomainPolicy;
  useLocalAi: boolean;
  useMasking: boolean;
  useCloudAi: boolean;
}

/**
 * Pure branching decision. No chrome/storage access: reads only the passed
 * settings object and url, so it is testable with arguments and return
 * values alone.
 */
export function buildPlan(settings: Settings, url: string, alreadyProcessed = false): PipelinePlan {
  const mode = normalizePrivacyMode(settings[StorageKeys.PRIVACY_MODE]);
  const domainPolicy = resolveAiDomainPolicy(settings, url);
  return {
    mode,
    domainPolicy,
    useLocalAi: (mode === 'local_only' || mode === 'full_pipeline') && !alreadyProcessed,
    // PII masking runs before any AI (local or cloud) so it must be enabled
    // in local_only mode as well.
    useMasking:
      ((mode === 'full_pipeline' || mode === 'masked_cloud' || mode === 'local_only') &&
        !alreadyProcessed) ||
      domainPolicy === 'mask-required',
    useCloudAi: mode !== 'local_only',
  };
}

/** Pure combination of a sanitizer result (PBI 2026-11-20-03). */
export interface MaskApplication {
  processingText: string;
  maskedCount: number;
  maskedItems: (string | MaskedItem)[];
}

/**
 * Pure mask application. No storage or logging access. A null result means
 * masking was skipped: the content passes through untouched with zero counts.
 * Null is a caller-asserted skip only — a sanitizer contract violation must
 * never flow here. Callers with masking enabled fail closed on an absent
 * result instead (see process()).
 */
export function applyMaskResult(
  content: string,
  sanitizeResult: { text: string; maskedItems: (string | MaskedItem)[] } | null,
): MaskApplication {
  if (!sanitizeResult) {
    return { processingText: content, maskedCount: 0, maskedItems: [] };
  }
  return {
    processingText: sanitizeResult.text,
    maskedItems: sanitizeResult.maskedItems,
    maskedCount: sanitizeResult.maskedItems.length,
  };
}

/** Input to the pure cloud-result formatter (PBI 2026-11-20-03). */
export interface CloudFormatInput {
  /** Cloud summary body after checkPromptSafety (executor-owned side effect). */
  sanitizedSummary: string;
  aiResult: AISummaryResult;
  maskedCount: number;
  originalTokens: number;
  cleansedTokens: number;
  aiCallDurationMs: number;
  tagDict: TagNormalizationEntry[];
}

/** What the executor must log when the guard flags the body. */
export interface DegenerateLogPayload {
  reason?: string | undefined;
  repetitionRate?: number | undefined;
  providerName?: string | undefined;
}

/** Output of the pure cloud-result formatter (PBI 2026-11-20-03). */
export interface CloudFormatOutput {
  result: PrivacyPipelineResult;
  /**
   * Present when the guard flagged the body. The executor owns the addLog
   * call; this pure function only reports what to log.
   */
  degenerate: DegenerateLogPayload | null;
}

/**
 * Pure cloud-result formatting: tag split, normalization, newline collapse,
 * degenerate-output guard. No chrome/storage/log access.
 * Never writes a note body and never throws: a total provider failure stays
 * a normal result with aiSucceeded=false, so the caller — never the note —
 * decides what the failure text means.
 */
export function formatCloudResult(input: CloudFormatInput): CloudFormatOutput {
  const {
    sanitizedSummary,
    aiResult,
    maskedCount,
    originalTokens,
    cleansedTokens,
    aiCallDurationMs,
    tagDict,
  } = input;
  let summary = sanitizedSummary;
  let tags: string[] | undefined;
  let degenerate: DegenerateLogPayload | null = null;

  if (summary) {
    const parsed = parseTagsFromSummary(summary);
    const normalizedTags = normalizeTags(parsed.tags, tagDict);
    tags = normalizedTags.length > 0 ? normalizedTags : undefined;
    summary = parsed.summary;
    summary = summary.replace(/\n+/g, ' ').replace(/  +/g, ' ').trim();

    // Single guard choke point for all cloud/Ollama/LM Studio provider paths.
    // Runs on the summary body only, after parseTagsFromSummary has split off
    // tags, so a legitimate `tag1 | tag2 | tag3` output is not misread as
    // degenerate keyword spam.
    const guard = isDegenerateOutput(summary);
    if (guard.isDegenerate) {
      degenerate = {
        reason: guard.reason,
        repetitionRate: guard.metrics?.repetitionRate,
        providerName: aiResult.providerName,
      };
      summary = DEGENERATE_SUMMARY_FALLBACK;
    }
  }

  return {
    result: {
      summary,
      // The chain caller (RemoteAIService loop) may return a failure whose
      // error text sits in `summary` — only a real success counts (PBI 04).
      aiSucceeded: aiResult.success === true,
      maskedCount,
      originalTokens,
      cleansedTokens,
      aiCallDurationMs,
      ...pickDefined({
        tags,
        sentTokens: aiResult.sentTokens,
        receivedTokens: aiResult.receivedTokens,
        providerName: aiResult.providerName,
        modelName: aiResult.modelName,
        attemptedProviders: aiResult.attemptedProviders,
        slotFailures: aiResult.slotFailures,
        failure: aiResult.failure,
        // PBI 2026-10-23-03: the degraded opening slice rides through only
        // when the provider reported the fallback, so a real remote summary
        // never carries it.
        degradedSummary: aiResult.degraded === true ? aiResult.degradedSummary : undefined,
      }),
    },
    degenerate,
  };
}

interface ISanitizers {
  sanitizeRegex(text: string): Promise<{ text: string; maskedItems: MaskedItem[] }>;
}


export interface PrivacyPipelineResult {
  summary?: string;
  success?: boolean;
  /** True only when a real AI model produced the summary (PBI 2026-09-22-04
   *  follow-up: regenerate gates its UPDATE on this instead of trusting a
   *  non-empty summary, because failed providers return their error text
   *  inside `summary`). Absent on paths that never ran AI (legacy default). */
  aiSucceeded?: boolean;
  preview?: boolean;
  processedContent?: string;
  mode?: string;
  maskedCount?: number;
  maskedItems?: (string | MaskedItem)[];
  tags?: string[];
  originalTokens?: number;
  cleansedTokens?: number;
  sentTokens?: number;
  receivedTokens?: number;
  providerName?: string;
  modelName?: string;
  /** 試行したプロバイダーID（全滅時のみ設定。PBI 2026-09-22-04 follow-up） */
  attemptedProviders?: string[];
  /** スロット別の失敗詳細（成功スロット以降の失敗も保持。同 follow-up） */
  slotFailures?: { provider: string; model?: string; error: string; failure?: FailureMetadata }[];
  /**
   * PBI 2026-10-23-03 (cost-aware cascade): title + opening slice for a
   * degraded send. Present only when the provider reported `degraded`; the
   * reason text stays in `summary`, so the record keeps both without posing
   * as a real remote summary.
   */
  degradedSummary?: string;
  /**
   * Structured failure of the AI call (PBI 2026-09-25-11). A total provider
   * failure is still reported as a normal result, so this field is what lets the
   * executor ask "which kind?" without reading the summary text. Never holds a
   * summary body, a response body, or key material.
   */
  failure?: FailureMetadata;
  /** クラウドAI要約(L3)の実呼び出し時間 (ミリ秒) — クラウドAIが呼ばれた場合のみセットされる */
  aiCallDurationMs?: number;
  /** 適用されたドメイン別送信政策 (PBI 2026-10-23-01)。URLにドメインがなく地図に行がない場合は 'allowed'。 */
  domainPolicy?: AiDomainPolicy;
}

export class PrivacyPipeline {
  constructor(
    private settings: Settings,
    private aiService: AIService,
    private sanitizers: ISanitizers,
  ) {}

  private get mode(): PrivacyMode {
    // Fail closed: an unknown persisted value must not fall through to a mode
    // where `useMasking` is false while `useCloudAi` is true.
    return normalizePrivacyMode(this.settings[StorageKeys.PRIVACY_MODE]);
  }

  /**
   * Thin executor (PBI 2026-11-20-03): owns every side effect (sanitizer and
   * AI calls, pending-page save, logging). Branching, mask combination, and
   * cloud formatting are delegated to the pure buildPlan / applyMaskResult /
   * formatCloudResult functions above.
   *
   * Caller contract: when the mode is local_only and local AI yields no
   * summary, the pending page is saved and an `Error('Local AI unavailable')`
   * is thrown. try/catch belongs to the caller (executor side) — the pure
   * functions never throw.
   */
  async process(
    content: string,
    options: {
      previewOnly?: boolean;
      /**
       * Skips masking for content the caller already masked. Reachable only from
       * tests: no `source` policy sets it any more (SAVE_RECORD used to), and the
       * flag is the pipeline's only masking kill-switch — a new source that sets
       * it would reintroduce the fail-open this PBI closed.
       */
      alreadyProcessed?: boolean;
      tagSummaryMode?: boolean;
      url?: string;
      title?: string;
      traceId?: string;
    } = {}
  ): Promise<PrivacyPipelineResult> {
    const { previewOnly = false, alreadyProcessed = false, url = '', title = '' } = options;
    const traceId = options.traceId || '';

    if (!content) {
      return { summary: SUMMARY_EMPTY_FALLBACK, aiSucceeded: false };
    }

    const plan = buildPlan(this.settings, url, alreadyProcessed);
    // Per-domain egress policy (PBI 2026-10-23-01): a mask-required domain
    // forces masking even in cloud_only mode (folded into the plan above);
    // a no-summary domain records the visit without any AI at all.
    const domainPolicy = plan.domainPolicy;
    let processingText = content;
    let maskedCount = 0;
    let maskedItems: (string | MaskedItem)[] = [];

    const originalTokens = estimateTokens(content);

    // L2: PII Masking — run before any AI (local or cloud) so that
    // on-device local AI also receives masked content when masking is enabled.
    if (plan.useMasking) {
      const sanitizeResult = await this.sanitizers.sanitizeRegex(content);
      if (sanitizeResult == null) {
        // Fail closed: masking is enabled, so an absent result must never
        // flow unsanitized into an AI call. sanitizeRegex is typed
        // non-nullable; this guards the runtime contract independently of
        // the logging flag below (_logMasking would also throw, but only
        // when logging is on).
        throw new Error('PII sanitizer returned no result; refusing to proceed unmasked');
      }
      const applied = applyMaskResult(content, sanitizeResult);
      processingText = applied.processingText;
      maskedItems = applied.maskedItems;
      maskedCount = applied.maskedCount;
      this._logMasking(sanitizeResult);
    }

    const cleansedTokens = estimateTokens(processingText);

    // A no-summary domain records the visit without any AI summary — nothing
    // leaves the device, so neither local nor cloud summarization runs.
    if (domainPolicy === 'no-summary') {
      return { summary: SUMMARY_EMPTY_FALLBACK, originalTokens, cleansedTokens, mode: this.mode, aiSucceeded: false, domainPolicy };
    }

    if (previewOnly) {
      return {
        success: true,
        preview: true,
        processedContent: processingText,
        mode: this.mode,
        maskedCount,
        maskedItems,
        originalTokens,
        cleansedTokens,
      };
    }

    // L1: Local Summarization (executor side effect: AI call, safety logs)
    const localResult = await this._performLocalSummarization(
      processingText,
      processingText,
      plan.useLocalAi,
      originalTokens,
      url,
      title,
      traceId
    );

    if (localResult?.returnEarly) {
      return { ...(localResult.result as PrivacyPipelineResult), mode: this.mode };
    }
    processingText = localResult?.processedText || processingText;

    // L3: Cloud Summarization (executor side effects: AI call, safety and
    // guard logs). Formatting itself is the pure formatCloudResult.
    if (plan.useCloudAi) {
      const aiCallStart = performance.now();
      const aiResult = await this.aiService.generateSummary(processingText, {
        mode: 'full_pipeline',
        url,
        traceId,
        // The applied policy rides the send so the egress ledger records the
        // verdict for this domain (PBI 2026-10-23-01).
        policy: domainPolicy,
        ...pickDefined({ tagSummaryMode: options.tagSummaryMode }),
      });
      const aiCallDurationMs = performance.now() - aiCallStart;
      const sanitizedSummary = aiResult.summary
        ? checkPromptSafety(aiResult.summary, 'cloud-summary').sanitized
        : '';
      const formatted = formatCloudResult({
        sanitizedSummary,
        aiResult,
        maskedCount,
        originalTokens,
        cleansedTokens,
        aiCallDurationMs,
        tagDict: (this.settings[StorageKeys.TAG_NORMALIZATION_DICT] ?? []) as TagNormalizationEntry[],
      });
      if (formatted.degenerate) {
        addLog(LogType.WARN, 'Degenerate LLM output detected', {
          reason: formatted.degenerate.reason,
          repetitionRate: formatted.degenerate.repetitionRate,
          providerName: formatted.degenerate.providerName,
        });
      }
      return {
        ...formatted.result,
        mode: this.mode,
        domainPolicy,
      };
    }

    return { summary: SUMMARY_EMPTY_FALLBACK, originalTokens, cleansedTokens, mode: this.mode, aiSucceeded: false, domainPolicy };
  }

  /**
   * Executor-owned local summarization (PBI 2026-11-20-03): AI call, safety
   * logs, and the local-ai-unavailable throw+save contract live here, never
   * in the pure functions.
   *
   * Caller contract: in local_only mode with no local summary, the pending
   * page is saved first and `Error('Local AI unavailable')` is thrown. The
   * failure text is never written into a note body. try/catch belongs to the
   * caller (executor side).
   */

  private async _performLocalSummarization(
    content: string,
    processingText: string,
    useLocalAi: boolean,
    originalTokens: number,
    pageUrl: string = '',
    pageTitle: string = '',
    traceId: string = '',
  ): Promise<{
    returnEarly?: boolean;
    result?: PrivacyPipelineResult;
    processedText?: string;
  }> {
    if (!useLocalAi) {
      return {};
    }

    const localSafety = checkPromptSafety(content, 'local-input', { traceId });
    if (localSafety.blocked) {
      return { returnEarly: true, result: { summary: 'Error: Content blocked due to potential security risk.', originalTokens, aiSucceeded: false } };
    }

    const localCallStart = performance.now();
    const localResult = await this.aiService.generateSummary(localSafety.sanitized, { mode: 'local_only', traceId });
    const localCallDurationMs = performance.now() - localCallStart;
    if (!localResult.summary) {
      if (this.mode === 'local_only') {
        void addPendingPage({
          url: pageUrl,
          title: pageTitle || pageUrl,
          timestamp: Date.now(),
          reason: 'local-ai-unavailable',
          errorMessage: 'Local AI summarization failed',
          expiry: Date.now() + (24 * 60 * 60 * 1000)
        });
        throw new Error('Local AI unavailable');
      }
      return {};
    }

    const summarySafety = checkPromptSafety(localResult.summary, 'local-summary');
    const processedText = summarySafety.sanitized;

    if (this.mode === 'local_only') {
      return {
        returnEarly: true,
        result: {
          summary: processedText,
          originalTokens,
          aiCallDurationMs: localCallDurationMs,
          // The local model genuinely produced this summary.
          aiSucceeded: localResult.success === true,
          ...pickDefined({
            sentTokens: localResult.sentTokens,
            receivedTokens: localResult.receivedTokens,
            providerName: localResult.providerName,
            modelName: localResult.modelName,
          }),
        },
      };
    }

    return { processedText };
  }

  private _logMasking(sanitizeResult: { maskedItems: (string | MaskedItem)[] }): void {
    if (this.settings[StorageKeys.PII_SANITIZE_LOGS] === false) {
      return;
    }

    const count = sanitizeResult.maskedItems.length;
    if (count === 0) {
      return;
    }

    addLog(LogType.SANITIZE, `Masked ${count} PII items`, {
      items: sanitizeResult.maskedItems.map(item => typeof item === 'string' ? item : item.type),
    });
  }
}