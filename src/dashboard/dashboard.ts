/**
 * dashboard.ts
 * ダッシュボードページのグローバル初期化
 *
 * The settings-panel behaviour that used to live here moved to
 * generalSettings/ and localMarkdownExport.ts (PBI 2026-08-09-24); what
 * remains is page-level initialization: language direction, deep links
 * (?tab= / ?section=), and the export buttons that sit outside any panel.
 */

import { toMarkdownTemplateEntryData } from './markdownExport.js';
// Re-exported for existing importers (notably the dashboard tests), which
// referenced this helper from dashboard.ts before it moved to markdownExport.ts.
export { toMarkdownTemplateEntryData };
import {
  handleExportLocalMarkdown,
  handleHistoryExportLocalMarkdown,
} from './localMarkdownExport.js';
import { tryGetRegistry } from './panels/registryContext.js';
import { initTrancoConsentPanel } from './trancoConsent.js';

/**
 * Switch to a panel.
 *
 * Prefers the NavigationRegistry, falling back to clicking the sidebar button
 * when the registry is not up yet: entrypoints/options/main.ts imports this
 * module before src/dashboard/main.ts, so at initDashboard() time the panels
 * may not be registered. The click path reaches the same handler that
 * DashboardBootstrapper wires onto the sidebar.
 */
function navigateToPanel(panelId: string): void {
  const registry = tryGetRegistry();
  if (registry) {
    registry.navigate(panelId);
    return;
  }
  document.querySelector<HTMLButtonElement>(`.sidebar-nav-btn[data-panel="${panelId}"]`)?.click();
}

function openSettingsPanel(section: string): void {
  const panelMap: Record<string, string> = {
    obsidian: 'panel-general',
    'ai-provider': 'panel-general',
    general: 'panel-general',
  };

  const panelId = panelMap[section];
  if (!panelId) return;

  navigateToPanel(panelId);

  if (section === 'obsidian') {
    const details = document.getElementById('obsidianSettingsDetails') as HTMLDetailsElement | null;
    if (details) {
      details.open = true;
      details.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  } else if (section === 'ai-provider') {
    const aiSection = document.getElementById('aiProviderSection');
    if (aiSection) {
      aiSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
}

// ============================================================================
// Initialization
// ============================================================================

export function setHtmlLangDir(): void {
  const locale = chrome.i18n.getUILanguage();
  const langCode = locale.split('-')[0];
  document.documentElement.lang = locale;
  const rtlLanguages = ['ar', 'he', 'fa', 'ur', 'ku', 'yi', 'dv'];
  document.documentElement.dir = rtlLanguages.includes(langCode) ? 'rtl' : 'ltr';
}

export async function initDashboard(): Promise<void> {
  console.log('[Dashboard] Starting initialization...');

  try { setHtmlLangDir(); } catch (e) { console.error('[Dashboard] setHtmlLangDir error:', e); }

  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('tab') === 'history') {
    navigateToPanel('panel-sqlite-history');
  }

  const section = urlParams.get('section');
  if (section) {
    openSettingsPanel(section);
  }

  document.getElementById('historyExportLocalMarkdownBtn')?.addEventListener('click', handleHistoryExportLocalMarkdown);
  document.getElementById('exportLocalMarkdownBtn')?.addEventListener('click', handleExportLocalMarkdown);
  try { await initTrancoConsentPanel(); } catch (e) { console.error('[Dashboard] initTrancoConsentPanel error:', e); }

  console.log('[Dashboard] Initialization complete');
}

void initDashboard();
