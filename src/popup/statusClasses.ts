import { statusChannel } from '../utils/ui/statusChannel.js';

/**
 * Shared CSS class names for the popup status display (#mainStatus and the
 * errorUtils status element). Deliberately a leaf module: production writers
 * and the suites pinning the rendered className must resolve the same value,
 * so a rename is a one-place change instead of a production/test split.
 *
 * The values carry the full showStatus contract (`status-message <type>`)
 * because every #mainStatus write goes through statusChannel.report, which
 * renders the same contract with the popup-only TTL below.
 */
export const STATUS_CLASS = {
  success: 'status-message success',
  error: 'status-message error',
} as const;

export type StatusClassValues = typeof STATUS_CLASS[keyof typeof STATUS_CLASS];

// 2000ms is the popup-only contract: the panel is too small to keep the
// dashboard's 3s/5s defaults. TTL lives in the channel adapter, not at the
// call sites. Registered here so every #mainStatus writer inherits it via
// the module import, instead of relying on statusPanel's import order.
statusChannel.register('mainStatus', { defaultTtlMs: 2000 });
