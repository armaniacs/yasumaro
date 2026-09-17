/**
 * Accessible dialog seam — implementation moved to utils/ui (PBI 2026-09-17-19)
 * so popup and dashboard share one module. Kept as a re-export for the
 * existing dashboard importers.
 */
export { showConfirmDialog, showAlertDialog } from '../../utils/ui/confirmDialog.js';
export type { ConfirmDialogOptions, AlertDialogOptions } from '../../utils/ui/confirmDialog.js';
