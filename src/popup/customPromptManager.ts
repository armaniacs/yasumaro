/**
 * customPromptManager.ts
 * Custom Prompt UI Manager
 * Handles the prompt editor and list in the popup UI
 */

import { Settings, StorageKeys, saveSettings } from '../utils/storage.js';
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
} from '../utils/customPromptUtils.js';
import { applyI18n, getMessage } from './i18n.js';
import { escapeHtml } from './errorUtils.js';

// Prompt ID prefix constants
const PROMPT_ID = {
    DEFAULT: '__default__',
    PRESET_PREFIX: '__preset__'
} as const;

// DOM Elements
let promptList: HTMLElement | null = null;
let noPromptsMessage: HTMLElement | null = null;
let promptNameInput: HTMLInputElement | null = null;
let promptProviderSelect: HTMLSelectElement | null = null;
let promptSystemInput: HTMLInputElement | null = null;
let promptTextInput: HTMLTextAreaElement | null = null;
let editingPromptIdInput: HTMLInputElement | null = null;
let savePromptBtn: HTMLButtonElement | null = null;
let cancelPromptBtn: HTMLButtonElement | null = null;
let promptStatusDiv: HTMLElement | null = null;

// Current settings
let currentSettings: Settings | null = null;

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
 * Initialize the custom prompt manager
 * @param {Settings} settings - Current settings
 */
export function initCustomPromptManager(settings: Settings): void {
    currentSettings = settings;
    
    // Get DOM elements
    promptList = document.getElementById('promptList');
    noPromptsMessage = document.getElementById('noPromptsMessage');
    promptNameInput = document.getElementById('promptName') as HTMLInputElement;
    promptProviderSelect = document.getElementById('promptProvider') as HTMLSelectElement;
    promptSystemInput = document.getElementById('promptSystem') as HTMLInputElement;
    promptTextInput = document.getElementById('promptText') as HTMLTextAreaElement;
    editingPromptIdInput = document.getElementById('editingPromptId') as HTMLInputElement;
    savePromptBtn = document.getElementById('savePromptBtn') as HTMLButtonElement;
    cancelPromptBtn = document.getElementById('cancelPromptBtn') as HTMLButtonElement;
    promptStatusDiv = document.getElementById('promptStatus');

    // Attach event listeners
    if (savePromptBtn) {
        savePromptBtn.addEventListener('click', handleSavePrompt);
    }
    if (cancelPromptBtn) {
        cancelPromptBtn.addEventListener('click', handleCancelEdit);
    }

    // Render the prompt list
    renderPromptList();
}

/**
 * Render the list of saved prompts
 */
function renderPromptList(): void {
    if (!promptList || !noPromptsMessage || !currentSettings) return;

    const prompts = (currentSettings[StorageKeys.CUSTOM_PROMPTS] as CustomPrompt[]) || [];
    const locale = getMessage('locale') || navigator.language.startsWith('ja') ? 'ja' : 'en';

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
    promptList.innerHTML = presetItemsHtml + defaultItemHtml + customItemsHtml;

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
 * @param {import('../utils/customPromptUtils.js').PresetPrompt} preset - The preset prompt to render
 * @param {string} locale - Locale ('ja' or 'en')
 * @returns {string} HTML string
 */
function createPresetPromptItem(
    preset: import('../utils/customPromptUtils.js').PresetPrompt,
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
                <span class="prompt-provider">(${getMessage('promptProviderAll') || 'All Providers'})</span>
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
    const locale = getMessage('locale') || navigator.language.startsWith('ja') ? 'ja' : 'en';
    const defaultPreset = getPresetPrompt('default');
    const displayName = defaultPreset ? getPromptDisplayName(defaultPreset, locale) : (getMessage('defaultPrompt') || 'Default');

    return `
        <div class="prompt-item ${isActive ? 'active' : ''}" data-prompt-id="${PROMPT_ID.DEFAULT}">
            <div class="prompt-item-header">
                <span class="prompt-name">${escapeHtml(displayName)}</span>
                <span class="prompt-provider">(${getMessage('promptProviderAll') || 'All Providers'})</span>
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
 * @param {CustomPrompt} prompt - The prompt to render
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
 * @param {string} provider - Provider identifier
 * @returns {string} Display label
 */
function getProviderLabel(provider: string): string {
    const labels: Record<string, string> = {
        'all': getMessage('promptProviderAll') || 'All Providers',
        'gemini': 'Gemini',
        'openai': 'OpenAI',
        'openai2': 'OpenAI 2'
    };
    return labels[provider] || provider;
}

/**
 * Handle save prompt button click
 */
async function handleSavePrompt(): Promise<void> {
    if (!promptNameInput || !promptProviderSelect || !promptTextInput || !currentSettings) return;

    const name = promptNameInput.value.trim();
    const provider = promptProviderSelect.value as CustomPrompt['provider'];
    const systemPrompt = promptSystemInput?.value.trim() || undefined;
    const promptText = promptTextInput.value.trim();
    const editingId = editingPromptIdInput?.value || '';

    // Validate
    if (!name) {
        showStatus(getMessage('promptNameRequired') || 'Prompt name is required', 'error');
        return;
    }

    const validation = validatePrompt(promptText);
    if (!validation.valid) {
        showStatus(validation.error || 'Invalid prompt', 'error');
        return;
    }

    // Get current prompts
    let prompts = (currentSettings[StorageKeys.CUSTOM_PROMPTS] as CustomPrompt[]) || [];

    if (editingId) {
        // Update existing prompt
        prompts = updatePrompt(prompts, editingId, {
            name,
            provider,
            systemPrompt,
            prompt: promptText
        });
        showStatus(getMessage('promptUpdated') || 'Prompt updated', 'success');
    } else {
        // Create new prompt
        const newPrompt = createPrompt({
            name,
            provider,
            systemPrompt,
            prompt: promptText,
            isActive: false
        });
        prompts.push(newPrompt);
        showStatus(getMessage('promptCreated') || 'Prompt created', 'success');
    }

    // Save to settings
    currentSettings[StorageKeys.CUSTOM_PROMPTS] = prompts;
    await saveSettings(currentSettings);

    // Reset form and re-render
    resetForm();
    renderPromptList();
    applyI18n();
}

/**
 * Handle edit prompt button click
 * @param {string} promptId - ID of prompt to edit
 */
function handleEditPrompt(promptId: string): void {
    // Prevent editing default prompt
    if (promptId === PROMPT_ID.DEFAULT) {
        showStatus('Cannot edit default prompt. Use duplicate to create a custom version.', 'error');
        return;
    }

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
    if (savePromptBtn) {
        savePromptBtn.textContent = getMessage('updatePrompt') || 'Update Prompt';
    }
    if (cancelPromptBtn) {
        cancelPromptBtn.style.display = 'inline-block';
    }
}

/**
 * Handle delete prompt button click
 * @param {string} promptId - ID of prompt to delete
 */
async function handleDeletePrompt(promptId: string): Promise<void> {
    // Prevent deleting default prompt
    if (promptId === PROMPT_ID.DEFAULT) {
        showStatus('Cannot delete default prompt', 'error');
        return;
    }

    if (!currentSettings) return;

    // Confirm deletion
    if (!confirm(getMessage('confirmDeletePrompt') || 'Are you sure you want to delete this prompt?')) {
        return;
    }

    let prompts = (currentSettings[StorageKeys.CUSTOM_PROMPTS] as CustomPrompt[]) || [];
    prompts = deletePrompt(prompts, promptId);

    // Save to settings
    currentSettings[StorageKeys.CUSTOM_PROMPTS] = prompts;
    await saveSettings(currentSettings);

    showStatus(getMessage('promptDeleted') || 'Prompt deleted', 'success');
    renderPromptList();
}

/**
 * Handle activate prompt button click
 * @param {string} promptId - ID of prompt to activate
 * @param {string} provider - Provider of the prompt
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

        showStatus(getMessage('promptActivated') || 'Prompt activated', 'success');
    } else if (promptId.startsWith(PROMPT_ID.PRESET_PREFIX)) {
        // Activate preset: upsert it into CUSTOM_PROMPTS with isActive=true
        const presetRawId = promptId.slice(PROMPT_ID.PRESET_PREFIX.length);
        const preset = getPresetPrompt(presetRawId);
        if (!preset) return;

        // Deactivate all existing prompts
        prompts = prompts.map(p => ({ ...p, isActive: false, updatedAt: Date.now() }));

        // Upsert preset entry
        const existing = prompts.findIndex(p => p.id === promptId);
        const locale = getMessage('locale') || (navigator.language.startsWith('ja') ? 'ja' : 'en');
        const name = getPromptDisplayName(preset, locale);
        const now = Date.now();
        if (existing >= 0) {
            prompts[existing] = { ...prompts[existing], isActive: true, updatedAt: now };
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

        showStatus(getMessage('promptActivated') || 'Prompt activated', 'success');
    } else {
        // Activate custom prompt
        prompts = setActivePrompt(prompts, promptId, provider);
        showStatus(getMessage('promptActivated') || 'Prompt activated', 'success');
    }

    // Save to settings
    currentSettings[StorageKeys.CUSTOM_PROMPTS] = prompts;
    await saveSettings(currentSettings);

    renderPromptList();
    applyI18n();
}

/**
 * Handle duplicate prompt button click
 * Loads prompt data into editor without saving
 * @param {string} promptId - ID of prompt to duplicate (or PROMPT_ID.DEFAULT or '${PROMPT_ID.PRESET_PREFIX}{id}' for presets)
 */
function handleDuplicatePrompt(promptId: string): void {
    if (!promptNameInput || !promptProviderSelect || !promptTextInput || !currentSettings) return;

    let name = '';
    let provider = 'all';
    let systemPrompt = '';
    let promptText = '';
    const locale = getMessage('locale') || navigator.language.startsWith('ja') ? 'ja' : 'en';

    if (promptId === PROMPT_ID.DEFAULT) {
        // Duplicate default prompt
        const defaultPreset = getPresetPrompt('default');
        name = defaultPreset ? getPromptDisplayName(defaultPreset, locale) : (getMessage('defaultPrompt') || 'Default');
        provider = 'all';
        systemPrompt = DEFAULT_SYSTEM_PROMPT;
        promptText = DEFAULT_USER_PROMPT;
    } else if (promptId.startsWith(PROMPT_ID.PRESET_PREFIX)) {
        // Duplicate preset prompt
        const presetId = promptId.replace(PROMPT_ID.PRESET_PREFIX, '');
        const preset = getPresetPrompt(presetId);
        if (!preset) {
            showStatus('Preset not found', 'error');
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
            showStatus('Prompt not found', 'error');
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
    if (savePromptBtn) {
        savePromptBtn.textContent = getMessage('savePrompt') || 'Save Prompt';
    }
    if (cancelPromptBtn) {
        cancelPromptBtn.style.display = 'inline-block';
    }

    // Show status message
    showStatus(getMessage('promptDuplicated') || 'Prompt copied to editor', 'success');

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
    if (promptNameInput) promptNameInput.value = '';
    if (promptProviderSelect) promptProviderSelect.value = 'all';
    if (promptSystemInput) promptSystemInput.value = '';
    if (promptTextInput) promptTextInput.value = '';
    if (editingPromptIdInput) editingPromptIdInput.value = '';

    // Reset button text
    if (savePromptBtn) {
        savePromptBtn.textContent = getMessage('savePrompt') || 'Save Prompt';
    }
    if (cancelPromptBtn) {
        cancelPromptBtn.style.display = 'none';
    }
}

/**
 * Show status message
 * @param {string} message - Message to show
 * @param {'success' | 'error'} type - Message type
 */
function showStatus(message: string, type: 'success' | 'error'): void {
    if (!promptStatusDiv) return;
    
    promptStatusDiv.textContent = message;
    promptStatusDiv.className = `status-${type}`;
    
    // Clear after 3 seconds
    setTimeout(() => {
        if (promptStatusDiv) {
            promptStatusDiv.textContent = '';
            promptStatusDiv.className = '';
        }
    }, 3000);
}

/**
 * Load default prompt into editor
 */
export function loadDefaultPrompt(): void {
    if (promptTextInput) {
        promptTextInput.value = DEFAULT_USER_PROMPT;
    }
    if (promptSystemInput) {
        promptSystemInput.value = DEFAULT_SYSTEM_PROMPT;
    }
}