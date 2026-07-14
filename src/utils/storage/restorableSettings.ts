/**
 * restorableSettings.ts
 * Allowlist + type/range validation for encrypted backup settings restoration.
 * Only non-sensitive settings keys are restorable from backups.
 */

import type { Settings } from './types.js';
import { addLog, LogType } from '../logger.js';

// ============================================================================
// Allowlist: non-sensitive settings keys that can be restored from backup
// ============================================================================

const RESTORABLE_KEYS = new Set<string>([
  // UI / Display
  'show_sqlite_content',
  'privacy_mode',
  'domain_filter_mode',

  // Feature toggles (non-sensitive)
  'review_summary_enabled',
  'content_storage_enabled',
  'local_markdown_export_enabled',
  'gist_enabled',
  'obsidian_enabled',
  'ublock_format_enabled',
  'simple_format_enabled',

  // Thresholds
  'min_visit_duration',
  'min_scroll_depth',
  'max_tokens_per_prompt',
  'ai_timeout_ms',
  'summary_min_length',
  'permission_notify_threshold',

  // Cleansing toggles (all ai_summary_cleansing_*)
  'ai_summary_cleansing_enabled',
  'ai_summary_cleansing_alt',
  'ai_summary_cleansing_metadata',
  'ai_summary_cleansing_ads',
  'ai_summary_cleansing_nav',
  'ai_summary_cleansing_social',
  'ai_summary_cleansing_deep',
  'ai_summary_cleansing_link_density',
  'ai_summary_cleansing_json_ld',
  'ai_summary_cleansing_lazy_load',
  'ai_summary_cleansing_skip_link',
  'ai_summary_cleansing_card',
  'ai_summary_cleansing_fixed',
  'ai_summary_cleansing_recommend',
  'ai_summary_cleansing_pagination',
  'ai_summary_cleansing_sns_promo',
  'ai_summary_cleansing_popup',
  'ai_summary_cleansing_platform',
  'ai_summary_cleansing_text_density',
  'ai_summary_cleansing_short_seq',
  'ai_summary_cleansing_symbol_line',
  'ai_summary_cleansing_link_para',
  'ai_summary_cleansing_enhanced_hidden',
  'ai_summary_cleansing_empty_elem',
  'ai_summary_cleansing_jp_layout',
  'ai_summary_cleansing_jp_navigation',
  'ai_summary_cleansing_author',
  'ai_summary_cleansing_affiliate',
  'ai_summary_cleansing_speech_bubble',
  'ai_summary_cleansing_body_protection_enabled',
  'ai_summary_cleansing_body_protection_threshold',
  'ai_summary_cleansing_link_ratio_threshold',
  'ai_summary_cleansing_short_text_threshold',
  'ai_summary_cleansing_short_seq_count',
  'ai_summary_cleansing_link_para_threshold',
  'ai_summary_cleansing_custom_patterns',

  // Content settings
  'content_strip_hard_enabled',
  'content_strip_keywords',
  'content_strip_keyword_enabled',
  'content_dedup_enabled',
  'content_dedup_threshold',
  'summary_normalize_enabled',

  // Tag settings
  'tag_categories',
  'tag_summary_mode',
  'tag_normalization_dict',

  // L0 extractive compression
  'l0_extractive_enabled',
  'l0_extractive_top_k',
  'l0_extractive_min_length',
  'l0_extractive_similarity_threshold',
  'l0_extractive_performance_threshold',

  // Retention policy
  'sqlite_retention_days',
  'sqlite_max_records',
  'content_retention_days',
  'content_max_records',
  'content_purge_include_starred',

  // Privacy (non-sensitive toggles)
  'pii_sanitize_logs',
  'auto_save_privacy_behavior',
  'pii_confirmation_ui',

  // Alert settings
  'alert_finance',
  'alert_sensitive',
  'alert_unverified',
  'save_aborted_pages',
  'safety_mode',
  'tranco_tier',

  // CSP / CORS
  'conditional_csp_enabled',
  'conditional_csp_providers',

  // Recording triggers
  'recording_triggers',
  'snapshot_interval_minutes',
  'auto_content_fetch_enabled',

  // Local export path (non-sensitive)
  'local_markdown_export_path',
  'local_markdown_export_auto_enabled',

  // uBlock sources (non-sensitive)
  'ublock_rules',
  'ublock_sources',

  // AI provider slot (non-sensitive configuration)
  'ai_provider',
  'ai_provider_priority_list',

  // Provider models (non-sensitive)
  'gemini_model',
  'obsidian_daily_path',
  'obsidian_protocol',
  'obsidian_port',
  'openai_base_url',
  'openai_model',
  'openai_2_base_url',
  'openai_2_model',
  'lm_studio_base_url',
  'lm_studio_model',
  'ollama_base_url',
  'ollama_model',
  'provider_type',
  'provider_base_url',
  'provider_model',

  // Domain filter configuration (non-sensitive)
  'domain_whitelist',
  'domain_blacklist',

  // Custom prompts
  'custom_prompts',
]);

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

/** Map of key -> expected JS type for basic validation. */
const KEY_TYPES: Record<string, string> = {
  'show_sqlite_content': 'boolean',
  'privacy_mode': 'string',
  'domain_filter_mode': 'string',
  'review_summary_enabled': 'boolean',
  'content_storage_enabled': 'boolean',
  'local_markdown_export_enabled': 'boolean',
  'gist_enabled': 'boolean',
  'obsidian_enabled': 'boolean',
  'ublock_format_enabled': 'boolean',
  'simple_format_enabled': 'boolean',
  'min_visit_duration': 'number',
  'min_scroll_depth': 'number',
  'max_tokens_per_prompt': 'number',
  'ai_timeout_ms': 'number',
  'summary_min_length': 'number',
  'permission_notify_threshold': 'number',
  'content_strip_hard_enabled': 'boolean',
  'content_strip_keywords': 'string[]',
  'content_strip_keyword_enabled': 'boolean',
  'content_dedup_enabled': 'boolean',
  'content_dedup_threshold': 'number',
  'summary_normalize_enabled': 'boolean',
  'tag_summary_mode': 'boolean',
  'tag_categories': 'array',
  'tag_normalization_dict': 'array',
  'l0_extractive_enabled': 'boolean',
  'l0_extractive_top_k': 'number',
  'l0_extractive_min_length': 'number',
  'l0_extractive_similarity_threshold': 'number',
  'l0_extractive_performance_threshold': 'number',
  'sqlite_retention_days': 'number',
  'sqlite_max_records': 'number',
  'content_retention_days': 'number',
  'content_max_records': 'number',
  'content_purge_include_starred': 'boolean',
  'pii_sanitize_logs': 'boolean',
  'auto_save_privacy_behavior': 'string',
  'pii_confirmation_ui': 'boolean',
  'alert_finance': 'boolean',
  'alert_sensitive': 'boolean',
  'alert_unverified': 'boolean',
  'save_aborted_pages': 'boolean',
  'safety_mode': 'string',
  'tranco_tier': 'string',
  'conditional_csp_enabled': 'boolean',
  'conditional_csp_providers': 'string[]',
  'recording_triggers': 'string',
  'snapshot_interval_minutes': 'number',
  'auto_content_fetch_enabled': 'boolean',
  'local_markdown_export_path': 'string',
  'local_markdown_export_auto_enabled': 'boolean',
  'ublock_rules': 'object',
  'ublock_sources': 'array',
  'ai_provider': 'string',
  'ai_provider_priority_list': 'array',
  'gemini_model': 'string',
  'obsidian_daily_path': 'string',
  'obsidian_protocol': 'string',
  'obsidian_port': 'string',
  'openai_base_url': 'string',
  'openai_model': 'string',
  'openai_2_base_url': 'string',
  'openai_2_model': 'string',
  'lm_studio_base_url': 'string',
  'lm_studio_model': 'string',
  'ollama_base_url': 'string',
  'ollama_model': 'string',
  'provider_type': 'string',
  'provider_base_url': 'string',
  'provider_model': 'string',
  'domain_whitelist': 'string[]',
  'domain_blacklist': 'string[]',
  'custom_prompts': 'array',
};

// Boolean cleansing flags — all must be boolean
const CLEANSING_BOOLEAN_KEYS = [
  'ai_summary_cleansing_enabled', 'ai_summary_cleansing_alt',
  'ai_summary_cleansing_metadata', 'ai_summary_cleansing_ads',
  'ai_summary_cleansing_nav', 'ai_summary_cleansing_social',
  'ai_summary_cleansing_deep', 'ai_summary_cleansing_link_density',
  'ai_summary_cleansing_json_ld', 'ai_summary_cleansing_lazy_load',
  'ai_summary_cleansing_skip_link', 'ai_summary_cleansing_card',
  'ai_summary_cleansing_fixed', 'ai_summary_cleansing_recommend',
  'ai_summary_cleansing_pagination', 'ai_summary_cleansing_sns_promo',
  'ai_summary_cleansing_popup', 'ai_summary_cleansing_platform',
  'ai_summary_cleansing_text_density', 'ai_summary_cleansing_short_seq',
  'ai_summary_cleansing_symbol_line', 'ai_summary_cleansing_link_para',
  'ai_summary_cleansing_enhanced_hidden', 'ai_summary_cleansing_empty_elem',
  'ai_summary_cleansing_jp_layout', 'ai_summary_cleansing_jp_navigation',
  'ai_summary_cleansing_author', 'ai_summary_cleansing_affiliate',
  'ai_summary_cleansing_speech_bubble', 'ai_summary_cleansing_body_protection_enabled',
];

// Numeric cleansing keys with range validation
const CLEANSING_NUMERIC_KEYS: Record<string, { min: number; max: number }> = {
  'ai_summary_cleansing_body_protection_threshold': { min: 0, max: 10000 },
  'ai_summary_cleansing_link_ratio_threshold': { min: 0, max: 100 },
  'ai_summary_cleansing_short_text_threshold': { min: 0, max: 10000 },
  'ai_summary_cleansing_short_seq_count': { min: 0, max: 100 },
  'ai_summary_cleansing_link_para_threshold': { min: 0, max: 100 },
  'ai_summary_cleansing_custom_patterns': { min: 0, max: 10000 },
};

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
    // Skip if not in allowlist
    if (!RESTORABLE_KEYS.has(key)) {
      addLog(LogType.DEBUG, `Backup: skipping non-restorable key "${key}"`);
      skippedKeys.push(key);
      continue;
    }

    // Type check
    const expectedType = KEY_TYPES[key];
    if (expectedType && !isValidType(value, expectedType)) {
      addLog(LogType.WARN, `Backup: invalid type for "${key}" (expected ${expectedType})`);
      skippedKeys.push(key);
      continue;
    }

    // Boolean cleansing flag check
    if (CLEANSING_BOOLEAN_KEYS.includes(key) && typeof value !== 'boolean') {
      addLog(LogType.WARN, `Backup: cleansing flag "${key}" must be boolean`);
      skippedKeys.push(key);
      continue;
    }

    // Numeric range check
    const range = CLEANSING_NUMERIC_KEYS[key];
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
