/**
 * models-dev-dialog-data.ts
 * Data seam for the models.dev dialog: catalog loading and filtering.
 * No DOM here — the dialog class owns all rendering (PBI 24 SRP split).
 */

import type { ModelsDevProvider } from '../utils/modelsDevApi.js';
import { loadModelsDevData } from '../utils/modelsDevApi.js';

/** Provider category tabs shown in the dialog. */
export type ProviderTab = 'all' | 'aggregators' | 'others';

/**
 * ModelsDevCatalog — owns the loaded provider list and the tab / search /
 * free-tier filter state behind load() and applyFilters().
 *
 * Deletion test: deleting this class scatters the catalog fetch and the
 * three filter predicates back into the dialog's render path.
 */
export class ModelsDevCatalog {
    private providers: ModelsDevProvider[] = [];
    private filteredProviders: ModelsDevProvider[] = [];
    private currentTab: ProviderTab = 'all';
    private searchQuery: string = '';
    private filterFreeTier: boolean = false;

    /**
     * Load the catalog and apply the initial (all-tab) filter.
     * Throws when the data source fails so the caller renders the error.
     */
    async load(): Promise<void> {
        const data = await loadModelsDevData();
        if (!data) {
            throw new Error('Failed to load provider data');
        }

        this.providers = data.providers;
        this.applyFilters();
    }

    /** Re-run the tab / search / free-tier filters over the loaded providers. */
    applyFilters(): void {
        this.filteredProviders = this.providers.filter(provider => {
            // Tab filter
            if (this.currentTab === 'aggregators' && !provider.isAggregator) {
                return false;
            }
            if (this.currentTab === 'others' && provider.isAggregator) {
                return false;
            }

            // Search filter
            if (this.searchQuery) {
                const query = this.searchQuery;
                if (!provider.name.toLowerCase().includes(query) &&
                    !provider.id.toLowerCase().includes(query)) {
                    return false;
                }
            }

            // Free tier filter
            if (this.filterFreeTier) {
                const hasFreeModel = provider.models.some(m => m.isFreeTier);
                if (!hasFreeModel) {
                    return false;
                }
            }

            return true;
        });
    }

    getProviders(): ModelsDevProvider[] {
        return this.providers;
    }

    getFilteredProviders(): ModelsDevProvider[] {
        return this.filteredProviders;
    }

    setTab(tab: ProviderTab): void {
        this.currentTab = tab;
    }

    setSearchQuery(query: string): void {
        this.searchQuery = query;
    }

    setFreeTierOnly(enabled: boolean): void {
        this.filterFreeTier = enabled;
    }
}
