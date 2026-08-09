/**
 * statusView.ts
 * 設定画面のステータス表示（上下2箇所）の同期
 */

/**
 * Mirrors the bottom status element into the sticky top bar.
 *
 * Lives here rather than in dashboard.ts because both dashboard.ts and
 * generalSettingsPanel need it; leaving it there is what forced the panel
 * layer to import from the module it was meant to replace
 * (PBI 2026-08-09-24).
 *
 * The copy is one-shot: statusTop mirrors whatever status holds at the time
 * of the call, so callers re-invoke it after each status update rather than
 * relying on the two staying bound.
 */
export function syncStatusToTop(): void {
  const statusDiv = document.getElementById('status') as HTMLElement | null;
  const statusTopDiv = document.getElementById('statusTop') as HTMLElement | null;
  if (statusTopDiv && statusDiv) {
    statusTopDiv.innerHTML = statusDiv.innerHTML;
    statusTopDiv.className = statusDiv.className;
  }
}
