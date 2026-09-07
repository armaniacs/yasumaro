import { createStaticFormPanel, type StaticPanelSpec } from './staticPanelAdapter.js';
import { PANEL_CATALOG } from '../panelCatalog.js';
import { type PanelLifecycle } from '../types.js';

import { initTagsPanel } from '../../tagsPanel.js';
import { initRecordingConditionsSettings } from '../../recordingConditionsSettings.js';
import { initCustomPromptManager } from '../../settings/customPromptManager.js';
import { initMarkdownTemplateManager } from '../../markdownTemplateManager.js';
import { cspSettings } from '../../cspSettings.js';
import { init as initContentSettings, loadContentSettings } from '../../settings/contentSettings.js';
import { initExportImport } from '../../exportImport.js';
import { initEncryptedBackupPanel } from '../../encryptedBackupPanel.js';
import { initGistSettings } from '../../gistSettings.js';
import { init as initTrustSettings, loadTrustSettings } from '../../settings/trustSettings.js';
import { init as initDomainFilter, loadDomainSettings } from '../../settings/domainFilter.js';
import { initDomainFilterTagUI } from '../../domainFilterTagUI.js';

/**
 * Panels that only forward to an existing init function.
 *
 * Each was previously its own 12–18 line file whose whole body was one
 * factory returning `{ id, category, mount }` — an interface larger than the
 * implementation it wrapped. Seven of the nine ignored the `container` the
 * Panel contract hands them, because the init functions reach for
 * `document.getElementById` themselves.
 *
 * Panels that carry real logic (generalSettingsPanel, privacySettingsPanel,
 * aiSummaryCleansingPanel) are created in panelFactories.ts.
 *
 * The ids are keys of this map, but existence and order are owned by
 * PANEL_CATALOG (see STATIC_FORM_PANELS below): adding a panel means one
 * catalog row + one spec here. `satisfies` keeps the keys literal so
 * panelFactories can exclude them from its own map at the type level.
 */
export const STATIC_FORM_SPECS = {
    'panel-tags': {
        id: 'panel-tags',
        mount: () => initTagsPanel(),
    },
    'panel-recording-conditions': {
        id: 'panel-recording-conditions',
        mount: () => initRecordingConditionsSettings(),
    },
    'panel-prompt': {
        id: 'panel-prompt',
        needsSettings: true,
        mount: (settings) => initCustomPromptManager(settings),
    },
    'panel-markdown-template': {
        id: 'panel-markdown-template',
        needsSettings: true,
        mount: (settings) => initMarkdownTemplateManager(settings),
    },
    'panel-csp': {
        id: 'panel-csp',
        mount: () => cspSettings.loadCSPSettings(),
        refresh: () => cspSettings.loadCSPSettings(),
    },
    'panel-content': {
        id: 'panel-content',
        mount: () => initContentSettings(),
        // Deliberately a different function from mount's: init wires the
        // form up, load re-reads persisted values into it.
        refresh: () => loadContentSettings(),
    },
    'panel-export-import': {
        id: 'panel-export-import',
        mount: async () => {
            initExportImport();
            initEncryptedBackupPanel();
            await initGistSettings();
        },
    },
    'panel-trust': {
        id: 'panel-trust',
        mount: async () => {
            initTrustSettings();
            await loadTrustSettings();
        },
        refresh: () => loadTrustSettings(),
    },
    'panel-domain': {
        id: 'panel-domain',
        mount: async () => {
            initDomainFilter();
            await initDomainFilterTagUI();
        },
        refresh: () => loadDomainSettings(),
    },
} satisfies Record<string, StaticPanelSpec>;

export type StaticFormPanelId = keyof typeof STATIC_FORM_SPECS;

export function isStaticFormId(id: string): id is StaticFormPanelId {
    return id in STATIC_FORM_SPECS;
}

/** Build one static-form panel from its spec (shared by the list below and panelFactories). */
export function createStaticPanelById(id: StaticFormPanelId): PanelLifecycle & { refresh?: () => Promise<void> } {
    return createStaticFormPanel(STATIC_FORM_SPECS[id]);
}

/**
 * Catalog order, filtered to the static-form specs. Kept for existing
 * importers and tests; the registration path (main.ts via panelFactories)
 * builds from the catalog directly.
 */
export const STATIC_FORM_PANELS: readonly (PanelLifecycle & { refresh?: () => Promise<void> })[] =
    PANEL_CATALOG.flatMap((entry) =>
        isStaticFormId(entry.id) ? [createStaticPanelById(entry.id)] : [],
    );
