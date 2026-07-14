import { NavigationRegistry } from './panels/NavigationRegistry.js';
import { DashboardBootstrapper } from './panels/DashboardBootstrapper.js';
import { createDiagnosticsPanel } from './panels/diagnostic/diagnosticsPanel.js';
import { createExportLogsPanel } from './panels/diagnostic/exportLogsPanel.js';
import { createAuditLogPanel } from './panels/asyncData/auditLogPanel.js';
import { createDomainSearchPanel } from './panels/asyncData/domainSearchPanel.js';
import { createTagClusterPanel } from './panels/asyncData/tagClusterPanel.js';
import { createHistoryPanel } from './panels/asyncData/historyPanel.js';
import { createSqliteHistoryPanel } from './panels/asyncData/sqliteHistoryPanel.js';
import { createGeneralSettingsPanel } from './panels/staticForm/generalSettingsPanel.js';
import { createDomainFilterPanel } from './panels/staticForm/domainFilterPanel.js';
import { createPromptSettingsPanel } from './panels/staticForm/promptSettingsPanel.js';
import { createPrivacySettingsPanel } from './panels/staticForm/privacySettingsPanel.js';
import { createContentSettingsPanel } from './panels/staticForm/contentSettingsPanel.js';
import { createAiSummaryCleansingPanel } from './panels/staticForm/aiSummaryCleansingPanel.js';
import { createTrustSettingsPanel } from './panels/staticForm/trustSettingsPanel.js';
import { createCspSettingsPanel } from './panels/staticForm/cspSettingsPanel.js';
import { createTagsSettingsPanel } from './panels/staticForm/tagsSettingsPanel.js';
import { createRecordingConditionsPanel } from './panels/staticForm/recordingConditionsPanel.js';
import { createExportImportPanel } from './panels/staticForm/exportImportPanel.js';
import { setRegistry } from './panels/registryContext.js';

export const registry = new NavigationRegistry();
setRegistry(registry);
const bootstrapper = new DashboardBootstrapper(registry);

bootstrapper.registerPanels([
  createDiagnosticsPanel(),
  createExportLogsPanel(),
  createAuditLogPanel(),
  createDomainSearchPanel(),
  createTagClusterPanel(),
  createHistoryPanel(),
  createSqliteHistoryPanel(),
  // StaticFormPanels
  createGeneralSettingsPanel(),
  createDomainFilterPanel(),
  createPromptSettingsPanel(),
  createPrivacySettingsPanel(),
  createContentSettingsPanel(),
  createAiSummaryCleansingPanel(),
  createTrustSettingsPanel(),
  createCspSettingsPanel(),
  createTagsSettingsPanel(),
  createRecordingConditionsPanel(),
  createExportImportPanel(),
]);

const sidebar = document.getElementById('sidebar');
if (sidebar) {
  bootstrapper.wireSidebar(sidebar);
}

// Start with default panel
bootstrapper.start('panel-general');
