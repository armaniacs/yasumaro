// @layer 1 — Provider security policy (SSRF guard seam, re-export shim)
/**
 * The predicate moved to the low tier (src/utils/storage/providerAllowlist.ts)
 * so utils modules can use it without importing background code (PBI
 * 2026-09-05-01). This file remains as a stable import path for the existing
 * background callers — same pattern as the retired storage.ts barrel.
 */
export { isAllowedProviderBaseUrl } from '../../utils/storage/providerAllowlist.js';
