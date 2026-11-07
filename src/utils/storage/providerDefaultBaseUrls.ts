// @layer 1 — Infrastructure (pure provider default-URL table; no chrome, no storage)
// providerDefaultBaseUrls.ts — the single source of truth for the local
// providers' default base URLs. The same strings were hand-copied in four
// places (DEFAULT_SETTINGS, the background provider catalog, the dashboard
// preset buttons, the lifecycle fallback) and the LM Studio host had already
// drifted (localhost vs 127.0.0.1). Consumers derive from here instead.
//
// Canonical hosts: LM Studio is 127.0.0.1 (matches DEFAULT_SETTINGS, the
// provider catalog + its CSP origin, and the pinned providerRegistry test);
// Ollama is localhost (unanimous across all four sites). Both are loopback,
// so the allowlist treats them identically — this table only unifies text.
// Official OpenAI uses a fixed endpoint; it has no local preset button.
export const OPENAI_OFFICIAL_BASE_URL = 'https://api.openai.com/v1';

export const PROVIDER_DEFAULT_BASE_URLS = {
  'lm-studio': 'http://127.0.0.1:1234/v1',
  'ollama': 'http://localhost:11434/v1',
} as const;

/**
 * Shipped openai_2_base_url preset — a loopback Ollama-compatible endpoint
 * (127.0.0.1, deliberately not the 'ollama' localhost host; the value is
 * pinned by tests and must not be unified with the 'ollama' entry).
 *
 * Not a PROVIDER_DEFAULT_BASE_URLS key on purpose: that table's keys are the
 * dashboard preset-button ids (generalSettings/providerPresets derives
 * ProviderPresetId from them), and there is no openai2 preset button.
 */
export const OPENAI_2_DEFAULT_BASE_URL = 'http://127.0.0.1:11434/v1';
