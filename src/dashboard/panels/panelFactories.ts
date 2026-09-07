/**
 * panelFactories.ts — カタログ id からパネル実体を生成する (PBI 2026-09-07-25)。
 *
 * main.ts が factory 呼び出しを直書きしていた二重管理を解消する:
 * 存在と順序は PANEL_CATALOG が所有し、ここは id → 生成関数の対応だけを持つ。
 * DIRECT_FACTORIES のキーは `Exclude<PanelCatalogId, StaticFormPanelId>` なので、
 * カタログに行を足して factory も static spec も足さないと type-check が落ちる。
 */
import { type PanelCatalogId, PANEL_CATALOG } from './panelCatalog.js';
import { type PanelLifecycle } from './types.js';
import { createDiagnosticsPanel } from './diagnostic/diagnosticsPanel.js';
import { createExportLogsPanel } from './diagnostic/exportLogsPanel.js';
import { createArchivePanel } from './diagnostic/archivePanel.js';
import { createDomainSearchPanel } from './asyncData/domainSearchPanel.js';
import { createTagClusterPanel } from './asyncData/tagClusterPanel.js';
import { createHistoryPanel } from './asyncData/historyPanel.js';
import { createSqliteHistoryPanel } from './asyncData/sqliteHistoryPanel.js';
import { createGeneralSettingsPanel } from './staticForm/generalSettingsPanel.js';
import { createPrivacySettingsPanel } from './staticForm/privacySettingsPanel.js';
import { createAiSummaryCleansingPanel } from './staticForm/aiSummaryCleansingPanel.js';
import { createStaticPanelById, isStaticFormId, type StaticFormPanelId } from './staticForm/staticPanels.js';

const DIRECT_FACTORIES: Record<Exclude<PanelCatalogId, StaticFormPanelId>, () => PanelLifecycle> = {
  'panel-diagnostics': createDiagnosticsPanel,
  'panel-export-logs': createExportLogsPanel,
  'panel-archive': createArchivePanel,
  'panel-domain-search': createDomainSearchPanel,
  'panel-tag-cluster': createTagClusterPanel,
  'panel-history': createHistoryPanel,
  'panel-sqlite-history': createSqliteHistoryPanel,
  'panel-general': createGeneralSettingsPanel,
  'panel-privacy': createPrivacySettingsPanel,
  'panel-ai-summary-cleansing': createAiSummaryCleansingPanel,
};

export function createPanelById(id: PanelCatalogId): PanelLifecycle {
  const direct = (DIRECT_FACTORIES as Record<string, (() => PanelLifecycle) | undefined>)[id];
  if (direct) return direct();
  if (isStaticFormId(id)) return createStaticPanelById(id);
  throw new Error(`No factory for panel "${id}"`);
}

/** Catalog order — the single registration sequence used by main.ts. */
export function createAllPanelsInCatalogOrder(): PanelLifecycle[] {
  return PANEL_CATALOG.map((entry) => createPanelById(entry.id));
}
