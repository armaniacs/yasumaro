/**
 * customPromptManager.ts
 * Custom Prompt UI Manager
 * Handles the prompt editor and list in the popup UI
 */
import { StorageKeys, saveSettings } from '../utils/storage.js';
import { createPrompt, updatePrompt, deletePrompt, setActivePrompt, validatePrompt, DEFAULT_USER_PROMPT, DEFAULT_SYSTEM_PROMPT } from '../utils/customPromptUtils.js';
import { applyI18n, getMessage } from './i18n.js';
// DOM Elements
let promptList = null;
let noPromptsMessage = null;
let promptNameInput = null;
let promptProviderSelect = null;
let promptSystemInput = null;
let promptTextInput = null;
let editingPromptIdInput = null;
let savePromptBtn = null;
let cancelPromptBtn = null;
let promptStatusDiv = null;
// Current settings
let currentSettings = null;
/**
 * Check if default prompt is active (no custom prompts are active)
 * @returns {boolean} True if default should be shown as active
 */
function isDefaultActive() {
    if (!currentSettings)
        return true;
    const prompts = currentSettings[StorageKeys.CUSTOM_PROMPTS] || [];
    return prompts.every(p => !p.isActive);
}
/**
 * Initialize the custom prompt manager
 * @param {Settings} settings - Current settings
 */
export function initCustomPromptManager(settings) {
    currentSettings = settings;
    // Get DOM elements
    promptList = document.getElementById('promptList');
    noPromptsMessage = document.getElementById('noPromptsMessage');
    promptNameInput = document.getElementById('promptName');
    promptProviderSelect = document.getElementById('promptProvider');
    promptSystemInput = document.getElementById('promptSystem');
    promptTextInput = document.getElementById('promptText');
    editingPromptIdInput = document.getElementById('editingPromptId');
    savePromptBtn = document.getElementById('savePromptBtn');
    cancelPromptBtn = document.getElementById('cancelPromptBtn');
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
function renderPromptList() {
    if (!promptList || !noPromptsMessage || !currentSettings)
        return;
    const prompts = currentSettings[StorageKeys.CUSTOM_PROMPTS] || [];
    // Always hide "no prompts" message since default is always shown
    noPromptsMessage.style.display = 'none';
    // Build HTML: default first, then custom prompts
    const defaultItemHtml = createDefaultPromptItem();
    const customItemsHtml = prompts.map(prompt => createPromptListItem(prompt)).join('');
    promptList.innerHTML = defaultItemHtml + customItemsHtml;
    // Attach event listeners for default prompt
    const defaultActivateBtn = document.getElementById('activate-prompt-__default__');
    const defaultDuplicateBtn = document.getElementById('duplicate-prompt-__default__');
    if (defaultActivateBtn) {
        defaultActivateBtn.addEventListener('click', () => handleActivatePrompt('__default__', 'all'));
    }
    if (defaultDuplicateBtn) {
        defaultDuplicateBtn.addEventListener('click', () => handleDuplicatePrompt('__default__'));
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
 * Create HTML for the default prompt item
 * @returns {string} HTML string
 */
function createDefaultPromptItem() {
    const isActive = isDefaultActive();
    const activeBadge = isActive
        ? `<span class="badge badge-active" data-i18n="activePrompt">Active</span>`
        : '';
    return `
        <div class="prompt-item ${isActive ? 'active' : ''}" data-prompt-id="__default__">
            <div class="prompt-item-header">
                <span class="prompt-name" data-i18n="defaultPrompt">Default</span>
                <span class="prompt-provider">(${getMessage('promptProviderAll') || 'All Providers'})</span>
                ${activeBadge}
            </div>
            <div class="prompt-item-actions">
                ${!isActive ? `<button id="activate-prompt-__default__" class="btn-sm btn-activate" data-i18n="activate">有効化</button>` : ''}
                <button id="duplicate-prompt-__default__" class="btn-sm btn-duplicate" data-i18n="duplicate">複製</button>
            </div>
        </div>
    `;
}
/**
 * Create HTML for a prompt list item
 * @param {CustomPrompt} prompt - The prompt to render
 * @returns {string} HTML string
 */
function createPromptListItem(prompt) {
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
function getProviderLabel(provider) {
    const labels = {
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
async function handleSavePrompt() {
    if (!promptNameInput || !promptProviderSelect || !promptTextInput || !currentSettings)
        return;
    const name = promptNameInput.value.trim();
    const provider = promptProviderSelect.value;
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
    let prompts = currentSettings[StorageKeys.CUSTOM_PROMPTS] || [];
    if (editingId) {
        // Update existing prompt
        prompts = updatePrompt(prompts, editingId, {
            name,
            provider,
            systemPrompt,
            prompt: promptText
        });
        showStatus(getMessage('promptUpdated') || 'Prompt updated', 'success');
    }
    else {
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
function handleEditPrompt(promptId) {
    // Prevent editing default prompt
    if (promptId === '__default__') {
        showStatus('Cannot edit default prompt. Use duplicate to create a custom version.', 'error');
        return;
    }
    if (!currentSettings || !promptNameInput || !promptProviderSelect || !promptTextInput)
        return;
    const prompts = currentSettings[StorageKeys.CUSTOM_PROMPTS] || [];
    const prompt = prompts.find(p => p.id === promptId);
    if (!prompt)
        return;
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
async function handleDeletePrompt(promptId) {
    // Prevent deleting default prompt
    if (promptId === '__default__') {
        showStatus('Cannot delete default prompt', 'error');
        return;
    }
    if (!currentSettings)
        return;
    // Confirm deletion
    if (!confirm(getMessage('confirmDeletePrompt') || 'Are you sure you want to delete this prompt?')) {
        return;
    }
    let prompts = currentSettings[StorageKeys.CUSTOM_PROMPTS] || [];
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
async function handleActivatePrompt(promptId, provider) {
    if (!currentSettings)
        return;
    let prompts = currentSettings[StorageKeys.CUSTOM_PROMPTS] || [];
    if (promptId === '__default__') {
        // Deactivate all custom prompts to activate default
        prompts = prompts.map(p => ({
            ...p,
            isActive: false,
            updatedAt: Date.now()
        }));
        showStatus(getMessage('promptActivated') || 'Prompt activated', 'success');
    }
    else {
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
 * @param {string} promptId - ID of prompt to duplicate (or '__default__' for default)
 */
function handleDuplicatePrompt(promptId) {
    if (!promptNameInput || !promptProviderSelect || !promptTextInput || !currentSettings)
        return;
    let name = '';
    let provider = 'all';
    let systemPrompt = '';
    let promptText = '';
    if (promptId === '__default__') {
        // Duplicate default prompt
        name = getMessage('defaultPrompt') || 'Default';
        provider = 'all';
        systemPrompt = DEFAULT_SYSTEM_PROMPT;
        promptText = DEFAULT_USER_PROMPT;
    }
    else {
        // Duplicate custom prompt
        const prompts = currentSettings[StorageKeys.CUSTOM_PROMPTS] || [];
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
function handleCancelEdit() {
    resetForm();
}
/**
 * Reset the prompt editor form
 */
function resetForm() {
    if (promptNameInput)
        promptNameInput.value = '';
    if (promptProviderSelect)
        promptProviderSelect.value = 'all';
    if (promptSystemInput)
        promptSystemInput.value = '';
    if (promptTextInput)
        promptTextInput.value = '';
    if (editingPromptIdInput)
        editingPromptIdInput.value = '';
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
function showStatus(message, type) {
    if (!promptStatusDiv)
        return;
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
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
/**
 * Load default prompt into editor
 */
export function loadDefaultPrompt() {
    if (promptTextInput) {
        promptTextInput.value = DEFAULT_USER_PROMPT;
    }
    if (promptSystemInput) {
        promptSystemInput.value = DEFAULT_SYSTEM_PROMPT;
    }
}
//# sourceMappingURL=customPromptManager.js.map