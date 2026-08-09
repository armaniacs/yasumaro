import { NavigationRegistry } from './panels/NavigationRegistry.js';
import { DashboardBootstrapper } from './panels/DashboardBootstrapper.js';
import { createDiagnosticsPanel } from './panels/diagnostic/diagnosticsPanel.js';
import { createExportLogsPanel } from './panels/diagnostic/exportLogsPanel.js';
import { createDomainSearchPanel } from './panels/asyncData/domainSearchPanel.js';
import { createTagClusterPanel } from './panels/asyncData/tagClusterPanel.js';
import { createHistoryPanel } from './panels/asyncData/historyPanel.js';
import { createSqliteHistoryPanel } from './panels/asyncData/sqliteHistoryPanel.js';
import { createGeneralSettingsPanel } from './panels/staticForm/generalSettingsPanel.js';
import { createPrivacySettingsPanel } from './panels/staticForm/privacySettingsPanel.js';
import { createAiSummaryCleansingPanel } from './panels/staticForm/aiSummaryCleansingPanel.js';
import { STATIC_FORM_PANELS } from './panels/staticForm/staticPanels.js';
import { setRegistry } from './panels/registryContext.js';
import { initDashboard, resolveInitialPanelId, applySectionDeepLink } from './dashboard.js';

const registry = new NavigationRegistry();
setRegistry(registry);
const bootstrapper = new DashboardBootstrapper(registry);

bootstrapper.registerPanels([
  createDiagnosticsPanel(),
  createExportLogsPanel(),
  createDomainSearchPanel(),
  createTagClusterPanel(),
  createHistoryPanel(),
  createSqliteHistoryPanel(),
  // StaticFormPanels that carry logic of their own
  createGeneralSettingsPanel(),
  createPrivacySettingsPanel(),
  createAiSummaryCleansingPanel(),
  // StaticFormPanels that only forward to an init function
  ...STATIC_FORM_PANELS,
]);

const sidebar = document.getElementById('sidebar');
if (sidebar) {
  bootstrapper.wireSidebar(sidebar);
}

// The deep link decides the starting panel, so start() runs once rather than
// navigating to the default and then being corrected.
bootstrapper.start(resolveInitialPanelId());
applySectionDeepLink();

void initDashboard();
