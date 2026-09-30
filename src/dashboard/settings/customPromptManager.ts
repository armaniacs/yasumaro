/**
 * customPromptManager.ts
 * Custom Prompt UI Manager
 * Handles the prompt editor and list in the popup UI
 *
 * WHY a factory: the element references and the settings snapshot were
 * module-level `let`s that survived every test in the file, so a test reusing
 * the same document read the previous mount's nodes. The state now lives in
 * the instance returned by createCustomPromptManager() and `destroy()` releases
 * it. The module-level functions below stay for existing callers and delegate
 * to one default instance.
 */

import { settingsRepository } from '../../utils/storage/SettingsRepository.js';
import { Settings, StorageKeys } from '../../utils/storage/types.js';
import {
    CustomPrompt,
    createPrompt,
    updatePrompt,
    deletePrompt,
    setActivePrompt,
    validatePrompt,
    DEFAULT_USER_PROMPT,
    DEFAULT_SYSTEM_PROMPT,
    PRESET_PROMPTS,
    getPresetPrompt,
    getPromptDisplayName
} from '../../utils/customPromptUtils.js';
import { pickDefined } from '../../utils/objectUtils.js';
import { getMessageOr } from '../../utils/i18n.js';
import { renderProviderOptions } from '../aiProviderCatalogView.js';
import { tryResolveProviderDisplayMetadata } from '../../utils/storage/providerAllowlist.js';
import { applyI18n } from '../../utils/i18n-dom.js';
import { escapeHtml } from '../../utils/htmlEscape.js';
import { setElementHtml } from '../../utils/htmlFragment.js';
import { showStatus } from '../../utils/ui/settingsUiHelper.js';
import { showConfirmDialog } from '../../utils/ui/confirmDialog.js';

// Prompt ID prefix constants
const PROMPT_ID = {
    DEFAULT: '__default__',
    PRESET_PREFIX: '__preset__'
} as const;

interface CustomPromptDom {
    promptList: HTMLElement | null;
    noPromptsMessage: HTMLElement | null;
    promptNameInput: HTMLInputElement | null;
    promptProviderSelect: HTMLSelectElement | null;
    promptSystemInput: HTMLInputElement | null;
    promptTextInput: HTMLTextAreaElement | null;
    editingPromptIdInput: HTMLInputElement | null;
    savePromptBtn: HTMLButtonElement | null;
    cancelPromptBtn: HTMLButtonElement | null;
    promptStatusDiv: HTMLElement | null;
}

export interface CustomPromptManager {
    /**
     * (Re-)mount the prompt editor and list.
     * @param settings Current settings
     */
    init(settings: Settings): void;
    /** Load the built-in prompt text into the editor without saving. */
    loadDefaultPrompt(): void;
    /**
     * Detach this instance's listeners and drop every element reference and the
     * settings snapshot. A later init() re-resolves from the document.
     */
    destroy(): void;
}

export function createCustomPromptManager(): CustomPromptManager {
    let dom: CustomPromptDom | null = null;
    let currentSettings: Settings | null = null;

    function resolveDom(): void {
        dom = {
            promptList: document.getElementById('promptList'),
            noPromptsMessage: document.getElementById('noPromptsMessage'),
            promptNameInput: document.getElementById('promptName') as HTMLInputElement | null,
            promptProviderSelect: document.getElementById('promptProvider') as HTMLSelectElement | null,
            promptSystemInput: document.getElementById('promptSystem') as HTMLInputElement | null,
            promptTextInput: document.getElementById('promptText') as HTMLTextAreaElement | null,
            editingPromptIdInput: document.getElementById('editingPromptId') as HTMLInputElement | null,
            savePromptBtn: document.getElementById('savePromptBtn') as HTMLButtonElement | null,
            cancelPromptBtn: document.getElementById('cancelPromptBtn') as HTMLButtonElement | null,
            promptStatusDiv: document.getElementById('promptStatus'),
        };
    }

    /**
     * Check if default prompt is active (no custom prompts are active)
     * @returns {boolean} True if default should be shown as active
     */
    function isDefaultActive(): boolean {
        if (!currentSettings) return true;

        const prompts = (currentSettings[StorageKeys.CUSTOM_PROMPTS] as CustomPrompt[]) || [];
        return prompts.every(p => !p.isActive);
    }

    /**
     * Render the list of saved prompts
     */
    function renderPromptList(): void {
        const { promptList, noPromptsMessage } = dom ?? {};
        if (!promptList || !noPromptsMessage || !currentSettings) return;

        const prompts = (currentSettings[StorageKeys.CUSTOM_PROMPTS] as CustomPrompt[]) || [];
        const locale = navigator.language.startsWith('ja') ? 'ja' : 'en';

        // Always hide "no prompts" message since default is always shown
        noPromptsMessage.style.display = 'none';

        // Build HTML: presets first (excluding default which is always shown), default, then custom prompts
        const activePromptId = prompts.find(p => p.isActive)?.id;
        const presetItemsHtml = PRESET_PROMPTS
            .filter(p => p.id !== 'default')
            .map(preset => createPresetPromptItem(preset, locale, activePromptId))
            .join('');
        const defaultItemHtml = createDefaultPromptItem();
        // Filter out preset-backed entries from custom list (shown in preset section)
        const customItemsHtml = prompts
            .filter(p => !p.id.startsWith(PROMPT_ID.PRESET_PREFIX))
            .map(prompt => createPromptListItem(prompt)).join('');
        setElementHtml(promptList, presetItemsHtml + defaultItemHtml + customItemsHtml);

        // Attach event listeners for preset prompts
        PRESET_PROMPTS.filter(p => p.id !== 'default').forEach(preset => {
            const activateBtn = document.getElementById(`activate-prompt-${PROMPT_ID.PRESET_PREFIX}${preset.id}`);
            const duplicateBtn = document.getElementById(`duplicate-prompt-${PROMPT_ID.PRESET_PREFIX}${preset.id}`);

            if (activateBtn) {
                activateBtn.addEventListener('click', () => handleActivatePrompt(`${PROMPT_ID.PRESET_PREFIX}${preset.id}`, 'all'));
            }
            if (duplicateBtn) {
                duplicateBtn.addEventListener('click', () => handleDuplicatePrompt(`${PROMPT_ID.PRESET_PREFIX}${preset.id}`));
            }
        });

        // Attach event listeners for default prompt
        const defaultActivateBtn = document.getElementById(`activate-prompt-${PROMPT_ID.DEFAULT}`);
        const defaultDuplicateBtn = document.getElementById(`duplicate-prompt-${PROMPT_ID.DEFAULT}`);

        if (defaultActivateBtn) {
            defaultActivateBtn.addEventListener('click', () => handleActivatePrompt(PROMPT_ID.DEFAULT, 'all'));
        }
        if (defaultDuplicateBtn) {
            defaultDuplicateBtn.addEventListener('click', () => handleDuplicatePrompt(PROMPT_ID.DEFAULT));
        }

        // Attach event listeners to custom prompt items
        prompts.forEach(prompt => {
            const editBtn = document.getElementById(`edit-prompt-${prompt.id}`);
            const deleteBtn = document.getElementById(`delete-prompt-${prompt.id}`);
            const activateBtn = document.getElementById(`activate-prompt-${prompt.id}`);
            const duplicateBtn = document.getElementById(`duplicate-prompt-${prompt.id}`);

            if (editBtn) {
                editBtn.addEventListener('click', () => handleEditPrompt(prompt.id));
            }
            if (deleteBtn) {
                deleteBtn.addEventListener('click', () => handleDeletePrompt(prompt.id));
            }
            if (activateBtn) {
                activateBtn.addEventListener('click', () => handleActivatePrompt(prompt.id, prompt.provider));
            }
            if (duplicateBtn) {
                duplicateBtn.addEventListener('click', () => handleDuplicatePrompt(prompt.id));
            }
        });
    }

    /**
     * Create HTML for a preset prompt item
     * @param preset The preset prompt to render
     * @param locale Locale ('ja' or 'en')
     * @returns {string} HTML string
     */
    function createPresetPromptItem(
        preset: import('../../utils/customPromptUtils.js').PresetPrompt,
        locale: string,
        activePromptId?: string
    ): string {
        const displayName = getPromptDisplayName(preset, locale);
        const presetId = `${PROMPT_ID.PRESET_PREFIX}${preset.id}`;
        const isActive = activePromptId === presetId;
        const activeBadge = isActive
            ? `<span class="badge badge-active" data-i18n="activePrompt">有効</span>`
            : '';

        return `
        <div class="prompt-item ${isActive ? 'active' : ''}" data-prompt-id="${presetId}">
            <div class="prompt-item-header">
                <span class="prompt-name">${escapeHtml(displayName)}</span>
                <span class="prompt-provider">(${getMessageOr('promptProviderAll', 'All Providers')})</span>
                ${activeBadge}
            </div>
            <div class="prompt-item-actions">
                ${!isActive ? `<button id="activate-prompt-${presetId}" class="btn-sm btn-activate" data-i18n="activate">有効化</button>` : ''}
                <button id="duplicate-prompt-${presetId}" class="btn-sm btn-duplicate" data-i18n="duplicate">複製</button>
            </div>
        </div>
    `;
    }

    /**
     * Create HTML for the default prompt item
     * @returns {string} HTML string
     */
    function createDefaultPromptItem(): string {
        const isActive = isDefaultActive();
        const activeBadge = isActive
            ? `<span class="badge badge-active" data-i18n="activePrompt">Active</span>`
            : '';
        const locale = navigator.language.startsWith('ja') ? 'ja' : 'en';
        const defaultPreset = getPresetPrompt('default');
        const displayName = defaultPreset ? getPromptDisplayName(defaultPreset, locale) : (getMessageOr('defaultPrompt', 'Default'));

        return `
        <div class="prompt-item ${isActive ? 'active' : ''}" data-prompt-id="${PROMPT_ID.DEFAULT}">
            <div class="prompt-item-header">
                <span class="prompt-name">${escapeHtml(displayName)}</span>
                <span class="prompt-provider">(${getMessageOr('promptProviderAll', 'All Providers')})</span>
                ${activeBadge}
            </div>
            <div class="prompt-item-actions">
                ${!isActive ? `<button id="activate-prompt-${PROMPT_ID.DEFAULT}" class="btn-sm btn-activate" data-i18n="activate">有効化</button>` : ''}
                <button id="duplicate-prompt-${PROMPT_ID.DEFAULT}" class="btn-sm btn-duplicate" data-i18n="duplicate">複製</button>
            </div>
        </div>
    `;
    }

    /**
     * Create HTML for a prompt list item
     * @param prompt The prompt to render
     * @returns {string} HTML string
     */
    function createPromptListItem(prompt: CustomPrompt): string {
        const providerLabel = getProviderLabel(prompt.provider);
        const activeBadge = prompt.isActive
            ? `<span class="badge badge-active" data-i18n="activePrompt">Active</span>`
            : '';

        return `
        <div class="prompt-item ${prompt.isActive ? 'active' : ''}" data-prompt-id="${prompt.id}">
            <div class="prompt-item-header">
                <span class="prompt-name">${escapeHtml(prompt.name)}</span>
                <span class="prompt-provider">(${providerLabel})</span>
                ${activeBadge}
            </div>
            <div class="prompt-item-actions">
                ${!prompt.isActive ? `<button id="activate-prompt-${prompt.id}" class="btn-sm btn-activate" data-i18n="activate">有効化</button>` : ''}
                <button id="duplicate-prompt-${prompt.id}" class="btn-sm btn-duplicate" data-i18n="duplicate">複製</button>
                <button id="edit-prompt-${prompt.id}" class="btn-sm btn-edit" data-i18n="edit">編集</button>
                <button id="delete-prompt-${prompt.id}" class="btn-sm btn-delete" data-i18n="delete">削除</button>
            </div>
        </div>
    `;
    }

    /**
     * Get display label for provider
     * @param provider Provider identifier
     * @returns Display label
     */
    function getProviderLabel(provider: string): string {
        if (provider === 'all') return getMessageOr('promptProviderAll', 'All Providers');
        const entry = tryResolveProviderDisplayMetadata(provider);
        if (!entry) return provider;
        return getMessageOr(entry.labelI18nKey, entry.label || provider);
    }

    /**
     * Handle save prompt button click
     */
    async function handleSavePrompt(): Promise<void> {
        const { promptNameInput, promptProviderSelect, promptSystemInput, promptTextInput, editingPromptIdInput, promptStatusDiv } = dom ?? {};
        if (!promptNameInput || !promptProviderSelect || !promptTextInput || !currentSettings) return;

        const name = promptNameInput.value.trim();
        const provider = promptProviderSelect.value as CustomPrompt['provider'];
        const systemPrompt = promptSystemInput?.value.trim() || undefined;
        const promptText = promptTextInput.value.trim();
        const editingId = editingPromptIdInput?.value || '';

        // Validate
        if (!name) {
            showStatus(promptStatusDiv ?? 'promptStatus', getMessageOr('promptNameRequired', 'Prompt name is required'), 'error');
            return;
        }

        const validation = validatePrompt(promptText);
        if (!validation.valid) {
            showStatus(promptStatusDiv ?? 'promptStatus', validation.error || 'Invalid prompt', 'error');
            return;
        }

        // Get current prompts
        let prompts = (currentSettings[StorageKeys.CUSTOM_PROMPTS] as CustomPrompt[]) || [];

        if (editingId) {
            // Update existing prompt
            prompts = updatePrompt(prompts, editingId, {
                name,
                provider,
                prompt: promptText,
                ...pickDefined({ systemPrompt })
            });
            showStatus(promptStatusDiv ?? 'promptStatus', getMessageOr('promptUpdated', 'Prompt updated'), 'success');
        } else {
            // Create new prompt
            const newPrompt = createPrompt({
                name,
                provider,
                prompt: promptText,
                isActive: false,
                ...pickDefined({ systemPrompt })
            });
            prompts.push(newPrompt);
            showStatus(promptStatusDiv ?? 'promptStatus', getMessageOr('promptCreated', 'Prompt created'), 'success');
        }

        // Save to settings — delta write: only CUSTOM_PROMPTS enters the payload,
        // so the panel's long-lived currentSettings snapshot cannot revert
        // unrelated keys a concurrent writer changed (PBI 2026-09-17-17).
        currentSettings[StorageKeys.CUSTOM_PROMPTS] = prompts;
        await settingsRepository.set(StorageKeys.CUSTOM_PROMPTS, prompts);

        // Reset form and re-render
        resetForm();
        renderPromptList();
        applyI18n();
    }

    /**
     * Handle edit prompt button click
     * @param promptId ID of prompt to edit
     */
    function handleEditPrompt(promptId: string): void {
        // Prevent editing default prompt
        if (promptId === PROMPT_ID.DEFAULT) {
            showStatus(dom?.promptStatusDiv ?? 'promptStatus', 'Cannot edit default prompt. Use duplicate to create a custom version.', 'error');
            return;
        }

        const { promptNameInput, promptProviderSelect, promptSystemInput, promptTextInput, editingPromptIdInput } = dom ?? {};
        if (!currentSettings || !promptNameInput || !promptProviderSelect || !promptTextInput) return;

        const prompts = (currentSettings[StorageKeys.CUSTOM_PROMPTS] as CustomPrompt[]) || [];
        const prompt = prompts.find(p => p.id === promptId);

        if (!prompt) return;

        // Populate form
        promptNameInput.value = prompt.name;
        promptProviderSelect.value = prompt.provider;
        if (promptSystemInput) {
            promptSystemInput.value = prompt.systemPrompt || '';
        }
        promptTextInput.value = prompt.prompt;
        if (editingPromptIdInput) {
            editingPromptIdInput.value = prompt.id;
        }

        // Update button text
        if (dom?.savePromptBtn) {
            dom.savePromptBtn.textContent = getMessageOr('updatePrompt', 'Update Prompt');
        }
        if (dom?.cancelPromptBtn) {
            dom.cancelPromptBtn.style.display = 'inline-block';
        }
    }

    /**
     * Handle delete prompt button click
     * @param promptId ID of prompt to delete
     */
    async function handleDeletePrompt(promptId: string): Promise<void> {
        // Prevent deleting default prompt
        if (promptId === PROMPT_ID.DEFAULT) {
            showStatus(dom?.promptStatusDiv ?? 'promptStatus', 'Cannot delete default prompt', 'error');
            return;
        }

        if (!currentSettings) return;

        // Confirm deletion — accessible dialog seam (PBI 2026-09-17-19)
        const confirmed = await showConfirmDialog({
          message: getMessageOr('confirmDeletePrompt', 'Are you sure you want to delete this prompt?'),
          dangerous: true,
        });
        if (!confirmed) {
            return;
        }

        let prompts = (currentSettings[StorageKeys.CUSTOM_PROMPTS] as CustomPrompt[]) || [];
        prompts = deletePrompt(prompts, promptId);

        // Save to settings — delta write (PBI 2026-09-17-17)
        currentSettings[StorageKeys.CUSTOM_PROMPTS] = prompts;
        await settingsRepository.set(StorageKeys.CUSTOM_PROMPTS, prompts);

        showStatus(dom?.promptStatusDiv ?? 'promptStatus', getMessageOr('promptDeleted', 'Prompt deleted'), 'success');
        renderPromptList();
    }

    /**
     * Handle activate prompt button click
     * @param promptId ID of prompt to activate
     * @param provider Provider of the prompt
     */
    async function handleActivatePrompt(promptId: string, provider: string): Promise<void> {
        if (!currentSettings) return;

        let prompts = (currentSettings[StorageKeys.CUSTOM_PROMPTS] as CustomPrompt[]) || [];

        if (promptId === PROMPT_ID.DEFAULT) {
            // Deactivate all custom prompts to activate default
            prompts = prompts.map(p => ({
                ...p,
                isActive: false,
                updatedAt: Date.now()
            }));

            showStatus(dom?.promptStatusDiv ?? 'promptStatus', getMessageOr('promptActivated', 'Prompt activated'), 'success');
        } else if (promptId.startsWith(PROMPT_ID.PRESET_PREFIX)) {
            // Activate preset: upsert it into CUSTOM_PROMPTS with isActive=true
            const presetRawId = promptId.slice(PROMPT_ID.PRESET_PREFIX.length);
            const preset = getPresetPrompt(presetRawId);
            if (!preset) return;

            // Deactivate all existing prompts
            prompts = prompts.map(p => ({ ...p, isActive: false, updatedAt: Date.now() }));

            // Upsert preset entry
            const existing = prompts.findIndex(p => p.id === promptId);
            const locale = navigator.language.startsWith('ja') ? 'ja' : 'en';
            const name = getPromptDisplayName(preset, locale);
            const now = Date.now();
            if (existing >= 0) {
                const current = prompts[existing];
                if (current) prompts[existing] = { ...current, isActive: true, updatedAt: now };
            } else {
                const newEntry: CustomPrompt = {
                    id: promptId,
                    name,
                    provider: 'all',
                    systemPrompt: preset.systemPrompt || '',
                    prompt: preset.userPrompt,
                    isActive: true,
                    createdAt: now,
                    updatedAt: now
                };
                prompts = [...prompts, newEntry];
            }

            showStatus(dom?.promptStatusDiv ?? 'promptStatus', getMessageOr('promptActivated', 'Prompt activated'), 'success');
        } else {
            // Activate custom prompt
            prompts = setActivePrompt(prompts, promptId, provider);
            showStatus(dom?.promptStatusDiv ?? 'promptStatus', getMessageOr('promptActivated', 'Prompt activated'), 'success');
        }

        // Save to settings — delta write (PBI 2026-09-17-17)
        currentSettings[StorageKeys.CUSTOM_PROMPTS] = prompts;
        await settingsRepository.set(StorageKeys.CUSTOM_PROMPTS, prompts);

        renderPromptList();
        applyI18n();
    }

    /**
     * Handle duplicate prompt button click
     * Loads prompt data into editor without saving
     * @param promptId ID of prompt to duplicate (or PROMPT_ID.DEFAULT or '${PROMPT_ID.PRESET_PREFIX}{id}' for presets)
     */
    function handleDuplicatePrompt(promptId: string): void {
        const { promptNameInput, promptProviderSelect, promptSystemInput, promptTextInput, editingPromptIdInput } = dom ?? {};
        if (!promptNameInput || !promptProviderSelect || !promptTextInput || !currentSettings) return;

        let name = '';
        let provider = 'all';
        let systemPrompt = '';
        let promptText = '';
        const locale = navigator.language.startsWith('ja') ? 'ja' : 'en';

        if (promptId === PROMPT_ID.DEFAULT) {
            // Duplicate default prompt
            const defaultPreset = getPresetPrompt('default');
            name = defaultPreset ? getPromptDisplayName(defaultPreset, locale) : (getMessageOr('defaultPrompt', 'Default'));
            provider = 'all';
            systemPrompt = DEFAULT_SYSTEM_PROMPT;
            promptText = DEFAULT_USER_PROMPT;
        } else if (promptId.startsWith(PROMPT_ID.PRESET_PREFIX)) {
            // Duplicate preset prompt
            const presetId = promptId.replace(PROMPT_ID.PRESET_PREFIX, '');
            const preset = getPresetPrompt(presetId);
            if (!preset) {
                showStatus(dom?.promptStatusDiv ?? 'promptStatus', 'Preset not found', 'error');
                return;
            }
            name = getPromptDisplayName(preset, locale);
            provider = 'all';
            systemPrompt = preset.systemPrompt || DEFAULT_SYSTEM_PROMPT;
            promptText = preset.userPrompt;
        } else {
            // Duplicate custom prompt
            const prompts = (currentSettings[StorageKeys.CUSTOM_PROMPTS] as CustomPrompt[]) || [];
            const prompt = prompts.find(p => p.id === promptId);

            if (!prompt) {
                showStatus(dom?.promptStatusDiv ?? 'promptStatus', 'Prompt not found', 'error');
                return;
            }

            name = prompt.name;
            provider = prompt.provider;
            systemPrompt = prompt.systemPrompt || '';
            promptText = prompt.prompt;
        }

        // Populate editor (clear editingPromptId to ensure new prompt creation)
        promptNameInput.value = `${name} (Copy)`;
        promptProviderSelect.value = provider;
        if (promptSystemInput) {
            promptSystemInput.value = systemPrompt;
        }
        promptTextInput.value = promptText;
        if (editingPromptIdInput) {
            editingPromptIdInput.value = ''; // Clear to create new
        }

        // Update button text
        if (dom?.savePromptBtn) {
            dom.savePromptBtn.textContent = getMessageOr('savePrompt', 'Save Prompt');
        }
        if (dom?.cancelPromptBtn) {
            dom.cancelPromptBtn.style.display = 'inline-block';
        }

        // Show status message
        showStatus(dom?.promptStatusDiv ?? 'promptStatus', getMessageOr('promptDuplicated', 'Prompt copied to editor'), 'success');

        // Scroll to editor
        promptNameInput.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    /**
     * Handle cancel edit button click
     */
    function handleCancelEdit(): void {
        resetForm();
    }

    /**
     * Reset the prompt editor form
     */
    function resetForm(): void {
        const { promptNameInput, promptProviderSelect, promptSystemInput, promptTextInput, editingPromptIdInput, savePromptBtn, cancelPromptBtn } = dom ?? {};
        if (promptNameInput) promptNameInput.value = '';
        if (promptProviderSelect) promptProviderSelect.value = 'all';
        if (promptSystemInput) promptSystemInput.value = '';
        if (promptTextInput) promptTextInput.value = '';
        if (editingPromptIdInput) editingPromptIdInput.value = '';

        // Reset button text
        if (savePromptBtn) {
            savePromptBtn.textContent = getMessageOr('savePrompt', 'Save Prompt');
        }
        if (cancelPromptBtn) {
            cancelPromptBtn.style.display = 'none';
        }
    }

    function init(settings: Settings): void {
        currentSettings = settings;
        resolveDom();

        const { promptProviderSelect, savePromptBtn, cancelPromptBtn } = dom!;
        if (promptProviderSelect) renderProviderOptions(promptProviderSelect, { customPrompt: true });

        if (savePromptBtn) {
            savePromptBtn.addEventListener('click', handleSavePrompt);
        }
        if (cancelPromptBtn) {
            cancelPromptBtn.addEventListener('click', handleCancelEdit);
        }

        // Render the prompt list
        renderPromptList();
    }

    function loadDefaultPrompt(): void {
        if (dom?.promptTextInput) {
            dom.promptTextInput.value = DEFAULT_USER_PROMPT;
        }
        if (dom?.promptSystemInput) {
            dom.promptSystemInput.value = DEFAULT_SYSTEM_PROMPT;
        }
    }

    function destroy(): void {
        dom?.savePromptBtn?.removeEventListener('click', handleSavePrompt);
        dom?.cancelPromptBtn?.removeEventListener('click', handleCancelEdit);
        dom = null;
        currentSettings = null;
    }

    return { init, loadDefaultPrompt, destroy };
}

/**
 * The instance the module-level functions below delegate to. One per page is
 * the whole reason the panel is a singleton today; `createCustomPromptManager`
 * exists so a test (or a second mount) can hold an isolated one instead.
 */
const sharedManager = createCustomPromptManager();

export function initCustomPromptManager(settings: Settings): void {
    sharedManager.init(settings);
}

export function loadDefaultPrompt(): void {
    sharedManager.loadDefaultPrompt();
}

export function destroyCustomPromptManager(): void {
    sharedManager.destroy();
}
