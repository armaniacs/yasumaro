/**
 * fieldDescriptor.ts
 * General-settings field descriptor table — single source of truth for the
 * read→validate→save→error-display wiring of dashboard settings fields.
 *
 * Each row maps a StorageKey to its DOM element/error IDs plus pure
 * value-level parse/validate/save functions. DOM glue (fieldValidation.ts)
 * and the save pipeline (settingsPipeline.ts) both derive from this table,
 * so adding a field is one row here with no edits elsewhere.
 *
 * `validate` delegates to existing SSOTs only (aiLimits /
 * obsidianConfigValidator / urlWhitelist) and holds no independent range
 * literals except where no utils SSOT exists yet (min visit duration, min
 * scroll depth, gemini API version) — for those, this table IS the single
 * owner and fieldValidation.ts must not repeat the literals.
 */

import { StorageKeys } from '../../utils/storage/types.js';
import type { StorageKeys as StorageKeysType } from '../../utils/storage/types.js';
import { validateMaxTokens as clampMaxTokens } from '../../utils/aiLimits.js';
import {
  validateObsidianProtocol,
  validateObsidianPort,
  validateObsidianHost,
} from '../../utils/obsidianConfigValidator.js';

type StorageKey = (typeof StorageKeysType)[keyof typeof StorageKeysType];

/** Optional context for validators whose decision depends on other state. */
export interface ValidationContext {
  /** Active AI provider id (e.g. 'gemini'). Selects the provider-specific cap. */
  providerId?: string;
}

/**
 * One settings field. `validate` returns an i18n error key on failure, null
 * when the value is valid. `save` maps the parsed value to the storage
 * payload (identity unless the field needs a transform).
 */
export interface FieldDescriptor<T = unknown> {
  readonly storageKey: StorageKey;
  readonly elementId: string;
  readonly errorId: string;
  readonly parse: (raw: string) => T;
  readonly validate: (value: T, ctx?: ValidationContext) => string | null;
  readonly save: (value: T) => unknown;
}

const identitySave = <T>(value: T): unknown => value;

// ---------------------------------------------------------------------------
// Value-level validators (pure, no DOM). DOM validators in fieldValidation.ts
// delegate here; the range/regex literals below must not be repeated there.
// ---------------------------------------------------------------------------

/**
 * Protocol decision delegates to validateObsidianProtocol. An empty field is
 * rejected here (the options form requires an explicit http/https choice)
 * even though the SW-side validator falls back to 'https' for empty input.
 */
export function validateProtocolValue(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (v === '') return 'errorProtocol';
  try {
    validateObsidianProtocol(v);
  } catch {
    return 'errorProtocol';
  }
  return null;
}

/** Port decision delegates to validateObsidianPort (single ownership). */
export function validatePortValue(raw: string): string | null {
  try {
    validateObsidianPort(raw.trim());
  } catch {
    return 'errorPort';
  }
  return null;
}

/** Host decision delegates to validateObsidianHost (single ownership). */
export function validateObsidianHostValue(raw: string): string | null {
  try {
    validateObsidianHost(raw);
  } catch {
    return 'obsidianHostError';
  }
  return null;
}

/**
 * Single owner of the min-visit-duration floor. No utils SSOT exists yet
 * (recordingConditionsSettings.ts mirrors `minVisitVal < 1` inline and is out
 * of this PBI's file scope), so this table holds the literal once.
 */
export function validateMinVisitDurationValue(v: number): string | null {
  if (isNaN(v) || v < 0) return 'errorDuration';
  return null;
}

/**
 * Single owner of the 0-100 scroll-depth range. Same situation as
 * validateMinVisitDurationValue: no utils SSOT yet, table holds it once.
 */
export function validateMinScrollDepthValue(v: number): string | null {
  if (isNaN(v) || v < 0 || v > 100) return 'errorScrollDepth';
  return null;
}

/**
 * Token-range decision delegates to aiLimits.validateMaxTokens as the single
 * decision: a value is valid iff clamping leaves it unchanged. NaN never
 * survives clamping (it becomes the 1000 default), so it is invalid.
 * Provider-specific caps (e.g. gemini 8192) fall out of the clamp — an empty
 * providerId falls back to GLOBAL_MAX_TOKENS, matching the legacy 10..16000.
 */
export function validateMaxTokensValue(v: number, providerId = ''): string | null {
  if (isNaN(v) || !Number.isFinite(v)) return 'error_max_tokens_range';
  if (clampMaxTokens(v, providerId) !== v) return 'error_max_tokens_range';
  return null;
}

/**
 * Single owner of the gemini-api-version shape. Empty means "use the provider
 * default" (GeminiProvider._getApiVersion falls back the same way), so it is
 * valid. The provider keeps its own copy of the pattern (out of scope), but
 * all dashboard-side checks go through this function.
 */
const GEMINI_API_VERSION_PATTERN = /^(v\d+([a-z]+)?)?$/;
export function validateGeminiApiVersionValue(raw: string): string | null {
  if (!GEMINI_API_VERSION_PATTERN.test(raw.trim())) return 'geminiApiVersionError';
  return null;
}

// ---------------------------------------------------------------------------
// Descriptor table. Order matches the legacy GENERAL_SETTINGS_VALIDATION_FIELDS
// (settingsPipeline.ts indexes pairs positionally), and elementId/errorId must
// stay identical to the DOM ids in entrypoints/options/index.html.
// ---------------------------------------------------------------------------

export const GENERAL_SETTINGS_FIELDS: ReadonlyArray<FieldDescriptor<unknown>> = [
  {
    storageKey: StorageKeys.OBSIDIAN_PROTOCOL,
    elementId: 'protocol',
    errorId: 'protocolError',
    parse: (raw) => raw.trim().toLowerCase(),
    validate: (value) => validateProtocolValue(value as string),
    save: identitySave,
  },
  {
    storageKey: StorageKeys.OBSIDIAN_PORT,
    elementId: 'port',
    errorId: 'portError',
    parse: (raw) => raw.trim(),
    validate: (value) => validatePortValue(value as string),
    save: identitySave,
  },
  {
    storageKey: StorageKeys.OBSIDIAN_HOST,
    elementId: 'obsidianHost',
    errorId: 'obsidianHostError',
    parse: (raw) => raw,
    validate: (value) => validateObsidianHostValue(value as string),
    save: identitySave,
  },
  {
    storageKey: StorageKeys.GEMINI_API_VERSION,
    elementId: 'geminiApiVersion',
    errorId: 'geminiApiVersionError',
    parse: (raw) => raw,
    validate: (value) => validateGeminiApiVersionValue(value as string),
    save: identitySave,
  },
  {
    storageKey: StorageKeys.MIN_VISIT_DURATION,
    elementId: 'minVisitDuration',
    errorId: 'minVisitDurationError',
    parse: (raw) => parseInt(raw, 10),
    validate: (value) => validateMinVisitDurationValue(value as number),
    save: identitySave,
  },
  {
    storageKey: StorageKeys.MIN_SCROLL_DEPTH,
    elementId: 'minScrollDepth',
    errorId: 'minScrollDepthError',
    parse: (raw) => parseInt(raw, 10),
    validate: (value) => validateMinScrollDepthValue(value as number),
    save: identitySave,
  },
  {
    storageKey: StorageKeys.MAX_TOKENS_PER_PROMPT,
    elementId: 'maxTokensPerPrompt',
    errorId: 'maxTokensError',
    parse: (raw) => parseInt(raw, 10),
    validate: (value, ctx) => validateMaxTokensValue(value as number, ctx?.providerId ?? ''),
    save: identitySave,
  },
];

/** Look up a descriptor by DOM element id. */
export function getDescriptorByElementId(elementId: string): FieldDescriptor<unknown> | undefined {
  return GENERAL_SETTINGS_FIELDS.find((d) => d.elementId === elementId);
}
