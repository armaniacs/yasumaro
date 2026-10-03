/**
 * Shared CSS class names for the popup status display (#mainStatus and the
 * errorUtils status element). Deliberately a leaf module: production writers
 * and the suites pinning the rendered className must resolve the same value,
 * so a rename is a one-place change instead of a production/test split.
 */
export const STATUS_CLASS = {
  success: 'success',
  error: 'error',
} as const;

export type StatusClassValues = typeof STATUS_CLASS[keyof typeof STATUS_CLASS];
