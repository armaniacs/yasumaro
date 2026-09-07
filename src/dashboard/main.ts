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

const sidebar = document.getElementById('sidebar');
if (sidebar) {
  bootstrapper.wireSidebar(sidebar);
}

// The deep link decides the starting panel, so start() runs once rather than
// navigating to the default and then being corrected.
bootstrapper.start(resolveInitialPanelId());
applySectionDeepLink();

void initDashboard();
