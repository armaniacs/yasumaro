/**
 * panelCatalog.ts — パネル存在の単一の真実の源 (PBI 2026-09-07-25)。
 *
 * 以前は「どのパネルが存在するか」が4箇所に分散していた:
 * entrypoints/options/index.html の sidebar ボタン、src/dashboard/main.ts の
 * 直登録、staticPanels.ts の STATIC_FORM_PANELS、dashboard.ts の
 * sectionPanelMap。各箇所は id 文字列の一致だけを暗黙の契約とし、
 * タイプミスは無言で失敗するタブになった (wireSidebar が registry の
 * throw を catch するため)。
 *
 * このテーブルが所有するのは存在・順序・sidebar表示・deep-link対応のみで、
 * パネル本体の生成は panelFactories.ts が所有する。循環参照を避けるため
 * このモジュールは import を持たない (純粋メタデータ)。
 *
 * sidebar は静的 HTML を維持する (CSP・初期描画・a11y 確実性優先。
 * 未解決事項1の結論。詳細は whywhy/pbi25-catalog.md)。HTML との同期は
 * __tests__/panelCatalog.test.ts で検証する。実行時生成への移行は将来判断。
 */

export type SidebarSection = 'settings' | 'data' | 'tools';

export interface PanelCatalogEntry {
  /** `section id`・`data-panel`・registry id と同一。 */
  readonly id: string;
  /**
   * sidebar の所属セクション。`null` は sidebar ボタンを持たない
   * (legacy `panel-history`。PBI 16 保留中のため登録維持)。
   */
  readonly sidebarSection: SidebarSection | null;
  /** sidebar ボタン内 `<span data-i18n>` のキー。sidebar なしは null。 */
  readonly sidebarI18nKey: string | null;
  /** `?section=` の値。panel-general が obsidian/ai-provider/general を受ける。 */
  readonly deepLinkSections: readonly string[];
  /** `?tab=` の値 (`?tab=history` → panel-sqlite-history)。通常は未設定。 */
  readonly tabParam?: string;
}

/**
 * カタログ順 = sidebar 表示順。末尾の `panel-history` のみ sidebar なし。
 */
export const PANEL_CATALOG: readonly PanelCatalogEntry[] = [
  { id: 'panel-general', sidebarSection: 'settings', sidebarI18nKey: 'mainTabDashboard', deepLinkSections: ['obsidian', 'ai-provider', 'general'] },
  { id: 'panel-domain', sidebarSection: 'settings', sidebarI18nKey: 'domainTab', deepLinkSections: [] },
  { id: 'panel-prompt', sidebarSection: 'settings', sidebarI18nKey: 'promptTab', deepLinkSections: [] },
  { id: 'panel-markdown-template', sidebarSection: 'settings', sidebarI18nKey: 'markdownTemplateTab', deepLinkSections: [] },
  { id: 'panel-privacy', sidebarSection: 'settings', sidebarI18nKey: 'privacyTab', deepLinkSections: [] },
  { id: 'panel-content', sidebarSection: 'settings', sidebarI18nKey: 'contentTab', deepLinkSections: [] },
  { id: 'panel-ai-summary-cleansing', sidebarSection: 'settings', sidebarI18nKey: 'aiSummaryCleansingTab', deepLinkSections: [] },
  { id: 'panel-trust', sidebarSection: 'settings', sidebarI18nKey: 'trustTab', deepLinkSections: [] },
  { id: 'panel-csp', sidebarSection: 'settings', sidebarI18nKey: 'cspTab', deepLinkSections: [] },
  { id: 'panel-tags', sidebarSection: 'settings', sidebarI18nKey: 'tagsTab', deepLinkSections: [] },
  { id: 'panel-recording-conditions', sidebarSection: 'settings', sidebarI18nKey: 'recordingConditionsTab', deepLinkSections: [] },
  { id: 'panel-diagnostics', sidebarSection: 'settings', sidebarI18nKey: 'diagnosticsTab', deepLinkSections: [] },
  { id: 'panel-tag-cluster', sidebarSection: 'data', sidebarI18nKey: 'tagClusterTab', deepLinkSections: [] },
  { id: 'panel-sqlite-history', sidebarSection: 'data', sidebarI18nKey: 'sqliteHistoryTab', deepLinkSections: [], tabParam: 'history' },
  { id: 'panel-archive', sidebarSection: 'data', sidebarI18nKey: 'archiveTab', deepLinkSections: [] },
  { id: 'panel-domain-search', sidebarSection: 'data', sidebarI18nKey: 'domainSearchTab', deepLinkSections: [] },
  { id: 'panel-export-logs', sidebarSection: 'tools', sidebarI18nKey: 'exportLogsTab', deepLinkSections: [] },
  { id: 'panel-export-import', sidebarSection: 'tools', sidebarI18nKey: 'exportImportTab', deepLinkSections: [] },
  // Legacy (PBI 16 保留中): 登録は維持するが sidebar には出さない。
  // PBI 16 着手時はこの1行と factory の1行を削除するだけになる。
  { id: 'panel-history', sidebarSection: null, sidebarI18nKey: null, deepLinkSections: [] },
] as const;

export type PanelCatalogId = (typeof PANEL_CATALOG)[number]['id'];

export const DEFAULT_PANEL_ID: PanelCatalogId = 'panel-general';

/** sidebar に並ぶパネル (カタログ順)。 */
export const SIDEBAR_PANELS: readonly PanelCatalogEntry[] = PANEL_CATALOG.filter(
  (entry): entry is PanelCatalogEntry & { sidebarSection: SidebarSection; sidebarI18nKey: string } =>
    entry.sidebarSection !== null && entry.sidebarI18nKey !== null,
);

/** `?tab=` → panel id。該当なしは null (呼び出し側がデフォルトに倒す)。 */
export function resolvePanelIdForTab(tab: string | null): PanelCatalogId | null {
  if (!tab) return null;
  return PANEL_CATALOG.find((entry) => entry.tabParam === tab)?.id as PanelCatalogId ?? null;
}

/** `?section=` → panel id。該当なしは null (呼び出し側がデフォルトに倒す)。 */
export function resolvePanelIdForSection(section: string | null): PanelCatalogId | null {
  if (!section) return null;
  return PANEL_CATALOG.find((entry) => entry.deepLinkSections.includes(section))?.id as PanelCatalogId ?? null;
}
