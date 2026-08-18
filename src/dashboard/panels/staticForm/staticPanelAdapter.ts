import { type StaticFormPanel } from '../types.js';
import { getSettings, type Settings } from '../../../utils/storage.js';

/**
 * Declarative description of a panel whose only job is to call existing
 * init functions.
 *
 * Panels with logic of their own (generalSettingsPanel, privacySettingsPanel,
 * aiSummaryCleansingPanel) keep their own files: inlining those would scatter
 * their bodies into the registration list rather than concentrate them.
 */
export interface StaticPanelSpec {
    /**
     * Panel id. Must match the element id and `data-panel` attribute in
     * entrypoints/options/index.html — a typo makes that tab silently fail
     * to open, because wireSidebar swallows the registry's throw.
     */
    id: string;
    /** Called on first mount. Receives settings only when needsSettings is set. */
    mount: (settings: Settings) => void | Promise<void>;
    /** Set when mount needs persisted settings, so the other panels skip the read. */
    needsSettings?: boolean;
    /** Omitted entirely when the panel has nothing to re-read (PBI 2026-08-08-03). */
    refresh?: () => void | Promise<void>;
}

export function createStaticFormPanel(spec: StaticPanelSpec): StaticFormPanel {
    const panel: StaticFormPanel = {
        id: spec.id,
        category: 'static-form',
        async mount(_container) {
            // `await` accepts non-promises, so sync and async inits share one path.
            // WHY: When needsSettings is false, mount doesn't use settings; cast satisfies the type signature
            const settings = spec.needsSettings
                ? await getSettings()
                : (undefined as unknown as Settings);
            await spec.mount(settings);
        },
    };

    // Assigned conditionally: declaring an empty refresh would contradict the
    // optional contract settled in PBI 2026-08-08-03.
    if (spec.refresh) {
        const refresh = spec.refresh;
        (panel as { refresh?: () => Promise<void> }).refresh = async () => { await refresh(); };
    }

    return panel;
}
