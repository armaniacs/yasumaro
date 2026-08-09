import { createStaticFormPanel } from './staticPanelAdapter.js';
import { type StaticFormPanel } from '../types.js';

import { initTagsPanel } from '../../tagsPanel.js';
import { initRecordingConditionsSettings } from '../../recordingConditionsSettings.js';
import { initCustomPromptManager } from '../../settings/customPromptManager.js';
import { initMarkdownTemplateManager } from '../../markdownTemplateManager.js';
import { CSPSettings } from '../../cspSettings.js';
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
 * aiSummaryCleansingPanel) are registered separately in main.ts.
 */
export const STATIC_FORM_PANELS: readonly StaticFormPanel[] = [
    createStaticFormPanel({
        id: 'panel-tags',
        mount: () => initTagsPanel(),
    }),
    createStaticFormPanel({
        id: 'panel-recording-conditions',
        mount: () => initRecordingConditionsSettings(),
    }),
    createStaticFormPanel({
        id: 'panel-prompt',
        needsSettings: true,
        mount: (settings) => initCustomPromptManager(settings),
    }),
    createStaticFormPanel({
        id: 'panel-markdown-template',
        needsSettings: true,
        mount: (settings) => initMarkdownTemplateManager(settings),
    }),
    createStaticFormPanel({
        id: 'panel-csp',
        mount: () => CSPSettings.loadCSPSettings(),
        refresh: () => CSPSettings.loadCSPSettings(),
    }),
    createStaticFormPanel({
        id: 'panel-content',
        mount: () => initContentSettings(),
        // Deliberately a different function from mount's: init wires the
        // form up, load re-reads persisted values into it.
        refresh: () => loadContentSettings(),
    }),
    createStaticFormPanel({
        id: 'panel-export-import',
        mount: async () => {
            initExportImport();
            initEncryptedBackupPanel();
            await initGistSettings();
        },
    }),
    createStaticFormPanel({
        id: 'panel-trust',
        mount: async () => {
            initTrustSettings();
            await loadTrustSettings();
        },
        refresh: () => loadTrustSettings(),
    }),
    createStaticFormPanel({
        id: 'panel-domain',
        mount: async () => {
            initDomainFilter();
            await initDomainFilterTagUI();
        },
        refresh: () => loadDomainSettings(),
    }),
] as const;
