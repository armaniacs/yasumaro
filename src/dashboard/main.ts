import { NavigationRegistry } from './panels/NavigationRegistry.js';
import { DashboardBootstrapper } from './panels/DashboardBootstrapper.js';
import { createPanelById } from './panels/panelFactories.js';
import { wirePanelCategoryFilter } from './panels/panelCategoryFilter.js';
import { setRegistry } from './panels/registryContext.js';
import { initDashboard, resolveInitialPanelId, applySectionDeepLink } from './dashboard.js';
// PBI 2026-10-21-12: the dashboard is a real fan-out destination for the
// auto-lock notification (receiver seam + real lock reads below).
import { subscribeSessionLockRequest } from '../utils/storage/sessionLockReceiver.js';
import { isLocked as isSessionLocked } from '../utils/storage/authGuard.js';
import { clearEncryptionKeyCache } from '../utils/storage/encryptionSession.js';
import { loadMasterPasswordSettings } from './masterPassword.js';

const registry = new NavigationRegistry();
setRegistry(registry);
const bootstrapper = new DashboardBootstrapper(registry);

// Single source: existence and order come from PANEL_CATALOG via
// registerCatalog (PBI 2026-09-07-25). No hand-written panel list here.
bootstrapper.registerCatalog(createPanelById);

// Sidebar wiring resolves the DOM at call time, never at module scope, so
// this entry module holds no cached element binding (dashboard DOM convention).
function wireSidebar(): void {
  const sidebarEl = document.getElementById('sidebar');
  if (sidebarEl) {
    bootstrapper.wireSidebar(sidebarEl);
  }
  // PBI 2026-10-31-08: パネル分類フィルタ (Settings IA)。select なし
  // (単体テスト fixture) は no-op。DOM 解決は呼び出し時 (dashboard DOM 規約)。
  wirePanelCategoryFilter(
    document.querySelector<HTMLSelectElement>('#panelCategoryFilter'),
    sidebarEl,
  );
}
wireSidebar();

// Page-level wiring (export buttons, "Report a Bug" entry points) targets
// only static HTML, so it must not wait on navigation: a hung panel mount
// would otherwise leave every page-level button unwired for the page's
// lifetime. The deep link still decides the starting panel, and start() is
// awaited so the panel's dynamically-built DOM (e.g. #geminiSettings) exists
// before deep-link section scrolling runs.
void initDashboard();

await bootstrapper.start(resolveInitialPanelId());
applySectionDeepLink();

// PBI 2026-10-21-12: the dashboard is a real fan-out destination for the
// auto-lock notification. SESSION_LOCK_REQUEST carries no payload, so the
// receiver re-reads authGuard's lock state: a locked re-read drops the
// dashboard's cached key and reloads the master-password panel so the UI
// reflects the locked state instead of the stale (unlocked) cache. The
// response body confirms delivery to the sender's retry contract.
const disposeSessionLockReceiver = subscribeSessionLockRequest({
  isLocked: isSessionLocked,
  clearKeyCache: clearEncryptionKeyCache,
  onLocked: () => {
    void loadMasterPasswordSettings();
  },
});

// Cleanup mounted panels exactly once on page unload. Navigation never
// calls destroy, so display transitions are unaffected. The fan-out
// receiver's runtime listener is released on the same single destroy.
window.addEventListener('pagehide', () => {
  disposeSessionLockReceiver();
  registry.destroyAll();
}, { once: true });
