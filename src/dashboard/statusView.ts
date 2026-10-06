/**
 * statusView.ts
 * 設定画面のステータス表示（上下2箇所）の同期
 */

/**
 * Compatibility re-export: the implementation lives in
 * utils/ui/settingsUiHelper.js (Layer 0) because showStatus owns the
 * mirror and utils must not import from dashboard. Dashboard importers
 * keep importing from here.
 *
 * Lives here rather than in dashboard.ts because both dashboard.ts and
 * generalSettingsPanel need it; leaving it there is what forced the panel
 * layer to import from the module it was meant to replace
 * (PBI 2026-08-09-24).
 *
 * Owner is showStatus (PBI 2026-10-05-17): writing to #status via
 * settingsUiHelper mirrors automatically, so callers never hand-call this
 * after showStatus. Direct DOM writes carrying rich HTML (innerHTML-built
 * connection rows) still call it explicitly — showStatus(text) cannot
 * transport nodes. The copy is one-shot and idempotent.
 */
export { syncStatusToTop } from '../utils/ui/settingsUiHelper.js';

// No 'status' channel binding is registered yet: dashboard reporters use
// `showStatus('status', …)` (auto-mirrored). The binding returns when those
// call sites migrate to `statusChannel.report`.
