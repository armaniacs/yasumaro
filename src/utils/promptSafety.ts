// @layer 2 — Prompt safety policy seam
/**
 * promptSafety.ts — single seam for prompt-injection policy.
 *
 * Five call sites used to hand-roll the same shape (evaluate once, branch on
 * level, log, block-or-continue) with subtly different stakes: block input
 * vs warn on output, ERROR vs WARN, traceId present or not. MEDIUM was
 * silently ignored everywhere. This module evaluates once per call and
 * dispatches through one explicit per-context table, so adding a sixth site
 * cannot re-invent the ordering and MEDIUM's pass-through is a decision, not
 * an accident.
 *
 * Verdict strings and detail shapes are byte-identical to the code this
 * replaces — only the owner changed, never the policy.
 *
 * Level comparison uses string literals (not the DangerLevel value import)
 * so existing sanitizePromptContent-only module mocks keep working without
 * changes — the same convention the provider template already used.
 */

import { sanitizePromptContent, type DangerLevelValues } from './promptSanitizer.js';
// Direct logger/* imports (Wave 4): new code must not use the barrel.
import { addLog } from './logger/core.js';
import { LogType } from './logger/types.js';

export type PromptSafetyContext =
  | 'local-input'
  | 'local-summary'
  | 'cloud-summary'
  | 'provider-input'
  | 'builtin-input';

export interface SafetyExtra {
  traceId?: string | undefined;
  providerName?: string | undefined;
}

export interface PromptSafetyVerdict {
  blocked: boolean;
  sanitized: string;
  warnings: string[];
  level: DangerLevelValues;
}

type SafetyHandler = (
  warnings: string[],
  level: DangerLevelValues,
  extra: SafetyExtra,
) => boolean;

const SAFETY_POLICY: Record<PromptSafetyContext, SafetyHandler> = {
  'local-input': (warnings, level, extra) => {
    if (level === 'high') {
      addLog(LogType.ERROR, 'Local AI blocked - high danger content detected', {
        warnings,
        traceId: extra.traceId,
      });
      return true;
    }
    if (level === 'low') {
      addLog(LogType.WARN, 'Local AI low-risk prompt injection detected', {
        warnings,
        traceId: extra.traceId,
        dangerLevel: level,
        category: 'generic_term',
      });
    }
    // MEDIUM: explicit pass-through (no site has ever acted on it).
    return false;
  },
  'local-summary': (warnings, level) => {
    if (level === 'high') {
      addLog(LogType.WARN, 'Local AI summary sanitized - high danger content detected', {
        warnings,
      });
    }
    // LOW/MEDIUM: explicit pass-through.
    return false;
  },
  'cloud-summary': (warnings, level) => {
    if (level === 'high') {
      addLog(LogType.WARN, 'AI summary sanitized - high danger content detected', {
        warnings,
      });
    } else if (level === 'low') {
      addLog(LogType.WARN, 'AI summary low-risk prompt injection detected', {
        warnings,
        dangerLevel: level,
        category: 'generic_term',
      });
    }
    // MEDIUM: explicit pass-through.
    return false;
  },
  'provider-input': (warnings, level, extra) => {
    const providerName = extra.providerName ?? 'unknown';
    if (warnings.length > 0) {
      addLog(LogType.WARN, `[${providerName}] Prompt injection detected: ${warnings.join('; ')}`, {
        traceId: extra.traceId,
        dangerLevel: level,
        category: level === 'low' ? 'generic_term' : 'refined_injection',
      });
    }
    if (level === 'high') {
      const cause = warnings.length > 0 ? warnings.join('; ') : 'High risk content detected';
      addLog(LogType.ERROR, `[${providerName}] High risk prompt injection blocked: ${cause}`, {
        traceId: extra.traceId,
      });
      return true;
    }
    // MEDIUM: explicit pass-through.
    return false;
  },
  'builtin-input': (warnings, level) => {
    if (level === 'high') {
      addLog(LogType.WARN, 'Content blocked due to high danger level', {
        warnings,
        source: 'BuiltInAI',
      });
      return true;
    }
    if (level === 'low') {
      addLog(LogType.WARN, 'Low-risk prompt injection detected in built-in AI input', {
        warnings,
        source: 'BuiltInAI',
        dangerLevel: level,
        category: 'generic_term',
      });
    }
    // MEDIUM: explicit pass-through.
    return false;
  },
};

/**
 * Evaluate prompt safety once and apply the context policy (log + block).
 */
export function checkPromptSafety(
  text: string,
  context: PromptSafetyContext,
  extra: SafetyExtra = {},
): PromptSafetyVerdict {
  const { sanitized, warnings, dangerLevel } = sanitizePromptContent(text);
  const blocked = SAFETY_POLICY[context](warnings, dangerLevel, extra);
  return { blocked, sanitized, warnings, level: dangerLevel };
}
