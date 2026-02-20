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
    DEFAULT_SYSTEM_PROMPT
} from '../utils/customPromptUtils.js';
import { applyI18n, getMessage } from './i18n.js';

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
    
    if (prompts.length === 0) {
        promptList.innerHTML = '';
        noPromptsMessage.style.display = 'block';
        return;
    }

    noPromptsMessage.style.display = 'none';
    promptList.innerHTML = prompts.map(prompt => createPromptListItem(prompt)).join('');

    // Attach event listeners to prompt items
    prompts.forEach(prompt => {
        const editBtn = document.getElementById(`edit-prompt-${prompt.id}`);
        const deleteBtn = document.getElementById(`delete-prompt-${prompt.id}`);
        const activateBtn = document.getElementById(`activate-prompt-${prompt.id}`);

        if (editBtn) {
            editBtn.addEventListener('click', () => handleEditPrompt(prompt.id));
        }
        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => handleDeletePrompt(prompt.id));
        }
        if (activateBtn) {
            activateBtn.addEventListener('click', () => handleActivatePrompt(prompt.id, prompt.provider));
        }
    });
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
            <div class="prompt-item-content">
                ${escapeHtml(prompt.prompt.substring(0, 100))}${prompt.prompt.length > 100 ? '...' : ''}
            </div>
            <div class="prompt-item-actions">
                ${!prompt.isActive ? `<button id="activate-prompt-${prompt.id}" class="btn-sm btn-activate" data-i18n="activate">Activate</button>` : ''}
                <button id="edit-prompt-${prompt.id}" class="btn-sm btn-edit" data-i18n="edit">Edit</button>
                <button id="delete-prompt-${prompt.id}" class="btn-sm btn-delete" data-i18n="delete">Delete</button>
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
    prompts = setActivePrompt(prompts, promptId, provider);

    // Save to settings
    currentSettings[StorageKeys.CUSTOM_PROMPTS] = prompts;
    await saveSettings(currentSettings);

    showStatus(getMessage('promptActivated') || 'Prompt activated', 'success');
    renderPromptList();
    applyI18n();
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
 * Escape HTML to prevent XSS
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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