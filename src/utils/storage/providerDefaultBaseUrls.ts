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
export const PROVIDER_DEFAULT_BASE_URLS = {
  'lm-studio': 'http://127.0.0.1:1234/v1',
  'ollama': 'http://localhost:11434/v1',
} as const;
