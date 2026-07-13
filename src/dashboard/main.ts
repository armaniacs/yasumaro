import { NavigationRegistry } from './panels/NavigationRegistry.js';
import { DashboardBootstrapper } from './panels/DashboardBootstrapper.js';
import { createDiagnosticsPanel } from './panels/diagnostic/diagnosticsPanel.js';
import { createExportLogsPanel } from './panels/diagnostic/exportLogsPanel.js';

const registry = new NavigationRegistry();
const bootstrapper = new DashboardBootstrapper(registry);

bootstrapper.registerPanels([
  createDiagnosticsPanel(),
  createExportLogsPanel(),
]);

const sidebar = document.getElementById('sidebar');
if (sidebar) {
  bootstrapper.wireSidebar(sidebar);
}
