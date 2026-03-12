/**
 * models-dev-dialog.ts
 * Dialog for selecting models.dev OpenAI-compatible providers
 */

import type { ModelsDevData, ModelsDevProvider, ModelsDevModel } from '../utils/modelsDevApi.js';
import {
    loadModelsDevData,
    formatContextLimit,
    getApiKeyEnvName
} from '../utils/modelsDevApi.js';
import { StorageKeys, saveSettings, getSettings, Settings } from '../utils/storage.js';

interface DialogOptions {
    onSave?: (providerId: string, baseUrl: string, apiKey: string, model: string) => void;
    onCancel?: () => void;
    close?: () => void;
}

export class ModelsDevDialog {
    private dialog: HTMLElement | null = null;
    private providers: ModelsDevProvider[] = [];
    private filteredProviders: ModelsDevProvider[] = [];
    private selectedProvider: ModelsDevProvider | null = null;
    private selectedModel: ModelsDevModel | null = null;
    private currentTab: 'all' | 'aggregators' | 'others' = 'all';
    private searchQuery: string = '';
    private filterFreeTier: boolean = false;
    private options: DialogOptions;

    // Cached DOM element references
    private listEl: HTMLElement | null = null;
    private countEl: HTMLElement | null = null;
    private loadingEl: HTMLElement | null = null;
    private selectedInfoEl: HTMLElement | null = null;
    private selectedNameEl: HTMLElement | null = null;
    private selectedModelEl: HTMLElement | null = null;
    private errorEl: HTMLElement | null = null;

    constructor(options: DialogOptions = {}) {
        this.options = options;
    }

    /**
     * Show the dialog
     */
    async show(): Promise<void> {
        // Create dialog elements if not exists
        if (!this.dialog) {
            this.createDialog();
        }

        // Show dialog
        this.dialog?.classList.remove('hidden');
        document.getElementById('dialog-close')?.focus();

        // Load providers
        await this.loadProviders();
    }

    /**
     * Hide the dialog
     */
    hide(): void {
        this.dialog?.classList.add('hidden');
        this.options.onCancel?.();
    }

    /**
     * Create dialog elements
     */
    private createDialog(): void {
        const overlay = document.createElement('div');
        overlay.id = 'models-dev-dialog';
        overlay.className = 'modal-overlay hidden';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'dialog-title');

        // HTML content
        overlay.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h2 id="dialog-title" data-i18n="modelsDevDialogTitle">OpenAI-Compatible Provider</h2>
                    <button type="button" id="dialog-close" class="close-btn" aria-label="Close">&times;</button>
                </div>

                <!-- Tabs -->
                <div class="tabs">
                    <button type="button" class="tab-btn active" data-tab="all">All</button>
                    <button type="button" class="tab-btn" data-tab="aggregators">Aggregators</button>
                    <button type="button" class="tab-btn" data-tab="others">Others</button>
                </div>

                <!-- Search and Filter -->
                <div class="search-bar">
                    <input type="text" id="provider-search" placeholder="Search providers...">
                    <label class="checkbox-label">
                        <input type="checkbox" id="filter-free-tier">
                        <span>Free Tier Only</span>
                    </label>
                </div>

                <!-- Loading state -->
                <div id="dialog-loading" class="loading-state">
                    <div class="spinner"></div>
                    <span>Loading providers...</span>
                </div>

                <!-- Provider List -->
                <div id="provider-count" class="provider-count"></div>
                <div id="provider-list" class="provider-list"></div>

                <!-- Selected Info -->
                <div id="selected-provider-info" class="selected-info hidden">
                    <div class="selected-label">Selected Provider:</div>
                    <div id="selected-provider-name" class="selected-name"></div>
                    <div id="selected-model-name" class="selected-model"></div>
                </div>

                <!-- Model Selection -->
                <div id="model-selection" class="model-selection hidden">
                    <label for="model-input">Model (optional):</label>
                    <input type="text" id="model-input" placeholder="e.g., gpt-3.5-turbo">
                </div>

                <!-- API Key Input -->
                <div class="api-key-section">
                    <label for="api-key-input">API Key:</label>
                    <input type="password" id="api-key-input" placeholder="Enter your API key...">
                </div>

                <!-- Error message -->
                <div id="dialog-error" class="error-message hidden"></div>

                <!-- Footer -->
                <div class="modal-footer">
                    <button type="button" id="dialog-cancel" class="btn btn-secondary">Cancel</button>
                    <button type="button" id="dialog-save" class="btn btn-primary">Save</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        this.dialog = overlay;

        // Cache DOM element references
        this.cacheDomReferences();

        // Attach event listeners
        this.attachEventListeners();
    }

    /**
     * Cache DOM element references for performance
     */
    private cacheDomReferences(): void {
        this.listEl = document.getElementById('provider-list');
        this.countEl = document.getElementById('provider-count');
        this.loadingEl = document.getElementById('dialog-loading');
        this.selectedInfoEl = document.getElementById('selected-provider-info');
        this.selectedNameEl = document.getElementById('selected-provider-name');
        this.selectedModelEl = document.getElementById('selected-model-name');
        this.errorEl = document.getElementById('dialog-error');
    }

    /**
     * Attach event listeners
     */
    private attachEventListeners(): void {
        // Close button
        document.getElementById('dialog-close')?.addEventListener('click', () => {
            this.hide();
        });

        // Cancel button
        document.getElementById('dialog-cancel')?.addEventListener('click', () => {
            this.hide();
        });

        // Save button
        document.getElementById('dialog-save')?.addEventListener('click', () => {
            this.save();
        });

        // Tab buttons
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = e.currentTarget as HTMLElement;
                const tab = target.dataset.tab as 'all' | 'aggregators' | 'others';
                this.switchTab(tab);
            });
        });

        // Search input
        const searchInput = document.getElementById('provider-search') as HTMLInputElement;
        searchInput?.addEventListener('input', (e) => {
            this.searchQuery = (e.target as HTMLInputElement).value.toLowerCase();
            this.filterProviders();
        });

        // Free tier filter
        const filterCheckbox = document.getElementById('filter-free-tier') as HTMLInputElement;
        filterCheckbox?.addEventListener('change', (e) => {
            this.filterFreeTier = (e.target as HTMLInputElement).checked;
            this.filterProviders();
        });

        // Click outside to close
        this.dialog?.addEventListener('click', (e) => {
            if (e.target === this.dialog) {
                this.hide();
            }
        });

        // ESC key to close
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !this.dialog?.classList.contains('hidden')) {
                this.hide();
            }
        });
    }

    /**
     * Load providers from data
     */
    private async loadProviders(): Promise<void> {
        if (!this.listEl || !this.countEl || !this.loadingEl) {
            return;
        }

        this.loadingEl.classList.remove('hidden');
        this.listEl.innerHTML = '';
        this.countEl.textContent = '';

        try {
            const data = await loadModelsDevData();
            if (!data) {
                throw new Error('Failed to load provider data');
            }

            this.providers = data.providers;
            this.filteredProviders = [...this.providers];
            this.filterProviders();

            this.loadingEl.classList.add('hidden');
        } catch (error) {
            console.error('Failed to load providers:', error);
            this.loadingEl.classList.add('hidden');
            this.showError('Failed to load providers. Please try again.');
        }
    }

    /**
     * Switch tabs
     */
    private switchTab(tab: 'all' | 'aggregators' | 'others'): void {
        this.currentTab = tab;

        // Update tab buttons
        document.querySelectorAll('.tab-btn').forEach(btn => {
            const btnEl = btn as HTMLElement;
            btnEl.classList.toggle('active', (btnEl.dataset.tab === tab));
        });

        this.filterProviders();
    }

    /**
     * Filter providers based on current tab, search, and filters
     */
    private filterProviders(): void {
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

        this.renderProviders();
    }

    /**
     * Render provider list
     */
    private renderProviders(): void {
        if (!this.listEl || !this.countEl) return;

        this.listEl.innerHTML = '';
        this.countEl.textContent = `${this.filteredProviders.length} providers`;

        this.filteredProviders.forEach(provider => {
            const item = document.createElement('div');
            item.className = 'provider-item';
            if (this.selectedProvider?.id === provider.id) {
                item.classList.add('selected');
            }

            // Find first non-null price model for cost display
            const firstPricedModel = provider.models.find(m => m.inputPrice !== null);
            const priceDisplay = firstPricedModel
                ? `$${firstPricedModel.inputPrice}/M input` // Simplified pricing
                : 'Free tier available';

            item.innerHTML = `
                <div class="provider-item-name">${provider.name}</div>
                <div class="provider-item-meta">
                    <span>${provider.models.length} models</span>
                    <span>${priceDisplay}</span>
                    ${provider.isAggregator ? '<span class="provider-badge badge-aggregator">Aggregator</span>' : ''}
                </div>
            `;

            item.addEventListener('click', () => {
                this.selectProvider(provider);
            });

            this.listEl?.appendChild(item);
        });
    }

    /**
     * Select a provider
     */
    private selectProvider(provider: ModelsDevProvider): void {
        this.selectedProvider = provider;
        this.selectedModel = null;

        // Update UI - optimize by finding index first, then updating in one pass
        const providerItems = this.listEl?.querySelectorAll('.provider-item') || [];
        const index = this.filteredProviders.findIndex(p => p.id === provider.id);

        providerItems.forEach((item, i) => {
            item.classList.toggle('selected', i === index);
        });

        // Show selected info (using cached references)
        if (this.selectedInfoEl && this.selectedNameEl && this.selectedModelEl) {
            this.selectedInfoEl.classList.remove('hidden');
            this.selectedNameEl.textContent = provider.name;
            this.selectedModelEl.textContent = `Env: ${getApiKeyEnvName(provider.id)}`;
        }

        // Update API key placeholder
        const apiKeyInput = document.getElementById('api-key-input') as HTMLInputElement;
        if (apiKeyInput) {
            apiKeyInput.placeholder = `Enter ${getApiKeyEnvName(provider.id)}...`;
        }
    }

    /**
     * Save settings
     */
    private async save(): Promise<void> {
        if (!this.selectedProvider) {
            this.showError('Please select a provider');
            return;
        }

        const apiKeyInput = document.getElementById('api-key-input') as HTMLInputElement;
        const modelInput = document.getElementById('model-input') as HTMLInputElement;

        const apiKey = apiKeyInput.value.trim();
        const model = modelInput.value.trim();

        // Validation
        if (!apiKey) {
            this.showError('Please enter your API key');
            return;
        }

        // Save settings
        try {
            const settings = await getSettings();

            settings[StorageKeys.AI_PROVIDER] = 'openai-compatible';
            settings[StorageKeys.PROVIDER_TYPE] = this.selectedProvider.id;
            settings[StorageKeys.PROVIDER_BASE_URL] = this.selectedProvider.api;
            settings[StorageKeys.PROVIDER_API_KEY] = apiKey;
            settings[StorageKeys.PROVIDER_MODEL] = model;

            await saveSettings(settings);

            // OnSave callback
            this.options.onSave?.(
                this.selectedProvider.id,
                this.selectedProvider.api,
                apiKey,
                model
            );

            this.hide();
        } catch (error) {
            console.error('Failed to save settings:', error);
            this.showError('Failed to save settings');
        }
    }

    /**
     * Show error message
     */
    private showError(message: string): void {
        if (this.errorEl) {
            this.errorEl.textContent = message;
            this.errorEl.classList.remove('hidden');

            // Hide after 5 seconds
            setTimeout(() => {
                this.errorEl?.classList.add('hidden');
            }, 5000);
        }
    }
}