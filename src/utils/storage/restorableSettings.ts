/**
 * restorableSettings.ts
 * Allowlist + type/range validation for encrypted backup settings restoration.
 * Only non-sensitive settings keys are restorable from backups.
 */

import type { Settings } from './types.js';
import { LogType } from '../logger/types.js';
import { addLog } from '../logger/core.js';
import { CLEANSING_RULES } from '../aiSummaryCleaner/rules.js';

// ============================================================================
// Spec table: single source for the restorable key set, its expected type,
// and (for numeric cleansing thresholds) the accepted range.
//
// PBI 2026-09-18-13: this used to be four hand-maintained parallel tables
// (RESTORABLE_KEYS, KEY_TYPES, CLEANSING_BOOLEAN_KEYS, CLEANSING_NUMERIC_KEYS).
// A key added to one but not the others could silently bypass type checking.
// The allowlist below is now DERIVED from the spec table, so that drift is
// structurally impossible. `type` may be omitted: numeric cleansing keys
// historically accepted any value type and range-checked numbers only —
// keep that behavior (a type here would tighten it).
// ============================================================================

export interface RestorableKeySpec {
  /** Expected JS type tag, validated by isValidType. Absent = no type check. */
  type?: 'string' | 'number' | 'boolean' | 'string[]' | 'array' | 'object';
  /** Inclusive numeric range, applied only when the value is a number. */
  range?: { min: number; max: number };
}

// Cleansing rule flags, derived from the SSOT table so a new rule is
// restorable without touching this file. Previously hand-enumerated here,
// which is how news_media / ec_site / qa_site / video_site were dropped
// from backup restore. Non-rule cleansing keys (enabled, body protection)
// stay hand-written below because they are parameters, not rules.
const CLEANSING_RULE_BOOLEAN_SPECS: Record<string, RestorableKeySpec> = Object.fromEntries(
  CLEANSING_RULES.map((rule) => [rule.storageKey, { type: 'boolean' as const }]),
);

const RESTORABLE_KEY_SPECS: Record<string, RestorableKeySpec> = {
  // UI / Display
  'show_sqlite_content': { type: 'boolean' },
  'privacy_mode': { type: 'string' },
  'domain_filter_mode': { type: 'string' },

  // Feature toggles (non-sensitive)
  'review_summary_enabled': { type: 'boolean' },
  'content_storage_enabled': { type: 'boolean' },
  'local_markdown_export_enabled': { type: 'boolean' },
  'gist_enabled': { type: 'boolean' },
  'obsidian_enabled': { type: 'boolean' },
  'ublock_format_enabled': { type: 'boolean' },
  'simple_format_enabled': { type: 'boolean' },

  // Thresholds
  'min_visit_duration': { type: 'number' },
  'min_scroll_depth': { type: 'number' },
  'max_tokens_per_prompt': { type: 'number' },
  'ai_timeout_ms': { type: 'number' },
  'summary_min_length': { type: 'number' },
  'permission_notify_threshold': { type: 'number' },

  // Cleansing toggles (all ai_summary_cleansing_*) — booleans
  'ai_summary_cleansing_enabled': { type: 'boolean' },
  ...CLEANSING_RULE_BOOLEAN_SPECS,
  'ai_summary_cleansing_body_protection_enabled': { type: 'boolean' },

  // Cleansing thresholds — no type check (range applies to numbers only)
  'ai_summary_cleansing_body_protection_threshold': { range: { min: 0, max: 10000 } },
  'ai_summary_cleansing_link_ratio_threshold': { range: { min: 0, max: 100 } },
  'ai_summary_cleansing_short_text_threshold': { range: { min: 0, max: 10000 } },
  'ai_summary_cleansing_short_seq_count': { range: { min: 0, max: 100 } },
  'ai_summary_cleansing_link_para_threshold': { range: { min: 0, max: 100 } },
  'ai_summary_cleansing_custom_patterns': { range: { min: 0, max: 10000 } },

  // Content settings
  'content_strip_hard_enabled': { type: 'boolean' },
  'content_strip_keywords': { type: 'string[]' },
  'content_strip_keyword_enabled': { type: 'boolean' },
  'content_dedup_enabled': { type: 'boolean' },
  'content_dedup_threshold': { type: 'number' },
  'summary_normalize_enabled': { type: 'boolean' },

  // Tag settings
  'tag_categories': { type: 'array' },
  'tag_summary_mode': { type: 'boolean' },
  'tag_normalization_dict': { type: 'array' },

  // L0 extractive compression
  'l0_extractive_enabled': { type: 'boolean' },
  'l0_extractive_top_k': { type: 'number' },
  'l0_extractive_min_length': { type: 'number' },
  'l0_extractive_similarity_threshold': { type: 'number' },
  'l0_extractive_performance_threshold': { type: 'number' },

  // Retention policy
  'sqlite_retention_days': { type: 'number' },
  'sqlite_max_records': { type: 'number' },
  'content_retention_days': { type: 'number' },
  'content_max_records': { type: 'number' },
  'content_purge_include_starred': { type: 'boolean' },

  // Privacy (non-sensitive toggles)
  'pii_sanitize_logs': { type: 'boolean' },
  'auto_save_privacy_behavior': { type: 'string' },
  'pii_confirmation_ui': { type: 'boolean' },

  // Alert settings
  'alert_finance': { type: 'boolean' },
  'alert_sensitive': { type: 'boolean' },
  'alert_unverified': { type: 'boolean' },
  'save_aborted_pages': { type: 'boolean' },
  'safety_mode': { type: 'string' },
  'tranco_tier': { type: 'string' },

  // CSP / CORS
  'conditional_csp_enabled': { type: 'boolean' },
  'conditional_csp_providers': { type: 'string[]' },

  // Recording triggers
  'recording_triggers': { type: 'string' },
  'snapshot_interval_minutes': { type: 'number' },
  'auto_content_fetch_enabled': { type: 'boolean' },

  // Local export path (non-sensitive)
  'local_markdown_export_path': { type: 'string' },
  'local_markdown_export_auto_enabled': { type: 'boolean' },

  // uBlock sources (non-sensitive)
  'ublock_rules': { type: 'object' },
  'ublock_sources': { type: 'array' },

  // AI provider slot (non-sensitive configuration)
  'ai_provider': { type: 'string' },
  'ai_provider_priority_list': { type: 'array' },

  // Provider models (non-sensitive)
  'gemini_model': { type: 'string' },
  'obsidian_daily_path': { type: 'string' },
  'obsidian_protocol': { type: 'string' },
  'obsidian_port': { type: 'string' },
  'openai_base_url': { type: 'string' },
  'openai_model': { type: 'string' },
  'openai_2_base_url': { type: 'string' },
  'openai_2_model': { type: 'string' },
  'lm_studio_base_url': { type: 'string' },
  'lm_studio_model': { type: 'string' },
  'ollama_base_url': { type: 'string' },
  'ollama_model': { type: 'string' },
  'provider_type': { type: 'string' },
  'provider_base_url': { type: 'string' },
  'provider_model': { type: 'string' },

  // Domain filter configuration (non-sensitive)
  'domain_whitelist': { type: 'string[]' },
  'domain_blacklist': { type: 'string[]' },

  // Custom prompts
  'custom_prompts': { type: 'array' },
};

/** Derived allowlist — do not add keys here; add a spec table row instead. */
const RESTORABLE_KEYS = new Set<string>(Object.keys(RESTORABLE_KEY_SPECS));

// ============================================================================
// Simple validators
// ============================================================================

function isValidType(value: unknown, expected: string): boolean {
  if (expected === 'string' && typeof value === 'string') return true;
  if (expected === 'number' && typeof value === 'number') return true;
  if (expected === 'boolean' && typeof value === 'boolean') return true;
  if (expected === 'string[]' && Array.isArray(value) && value.every(v => typeof v === 'string')) return true;
  if (expected === 'object' && typeof value === 'object' && value !== null && !Array.isArray(value)) return true;
  if (expected === 'array' && Array.isArray(value)) return true;
  return false;
}

// ============================================================================
// Main validation function
// ============================================================================

export interface ValidateRestorableSettingsResult {
  sanitized: Settings;
  skippedKeys: string[];
}

/**
 * Validate and filter a settings payload for backup restoration.
 * Returns sanitized settings containing only restorable keys with valid
 * types/ranges, plus the list of keys that were skipped (not in the
 * allowlist, wrong type, or out of range) so callers can surface this to
 * the user.
 */
export function validateRestorableSettings(
  payload: Record<string, unknown>
): ValidateRestorableSettingsResult {
  const sanitized: Record<string, unknown> = {};
  const skippedKeys: string[] = [];

  for (const [key, value] of Object.entries(payload)) {
    const spec = RESTORABLE_KEY_SPECS[key];

    // Skip if not in allowlist
    if (!spec) {
      addLog(LogType.DEBUG, `Backup: skipping non-restorable key "${key}"`);
      skippedKeys.push(key);
      continue;
    }

    // Type check. Cleansing flags keep their historical log wording.
    if (spec.type && !isValidType(value, spec.type)) {
      if (spec.type === 'boolean' && key.startsWith('ai_summary_cleansing_')) {
        addLog(LogType.WARN, `Backup: cleansing flag "${key}" must be boolean`);
      } else {
        addLog(LogType.WARN, `Backup: invalid type for "${key}" (expected ${spec.type})`);
      }
      skippedKeys.push(key);
      continue;
    }

    // Numeric range check (numbers only — non-numbers pass through, as before)
    const range = spec.range;
    if (range && typeof value === 'number') {
      if (value < range.min || value > range.max) {
        addLog(LogType.WARN, `Backup: "${key}" value ${value} out of range [${range.min}, ${range.max}]`);
        skippedKeys.push(key);
        continue;
      }
    }

    sanitized[key] = value;
  }

  return { sanitized: sanitized as Settings, skippedKeys };
}

/** Exported for the structural-invariant tests only. */
export { RESTORABLE_KEY_SPECS, RESTORABLE_KEYS };
