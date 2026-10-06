import { NavigationRegistry } from './panels/NavigationRegistry.js';
import { DashboardBootstrapper } from './panels/DashboardBootstrapper.js';
import { createPanelById } from './panels/panelFactories.js';
import { setRegistry } from './panels/registryContext.js';
import { initDashboard, resolveInitialPanelId, applySectionDeepLink } from './dashboard.js';

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

// Cleanup mounted panels exactly once on page unload. Navigation never
// calls destroy, so display transitions are unaffected.
window.addEventListener('pagehide', () => registry.destroyAll(), { once: true });
