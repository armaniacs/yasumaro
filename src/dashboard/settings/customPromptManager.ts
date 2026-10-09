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

/**
 * Boundary guard for CUSTOM_PROMPTS reads. Unvalidated casts
 * (`as CustomPrompt[]`) let non-array storage values through as `undefined`;
 * this collapses them to `[]` instead. Normal arrays pass through unchanged.
 */
export function asCustomPrompts(value: unknown): CustomPrompt[] {
    return Array.isArray(value) ? (value as CustomPrompt[]) : [];
}

/** Boundary guard for the provider select: unknown option values fall back to 'all'. */
export function asPromptProvider(value: unknown): CustomPrompt['provider'] {
    return value === 'gemini' || value === 'openai' || value === 'openai2'
        || value === 'lm-studio' || value === 'ollama' || value === 'all'
        ? value
        : 'all';
}

/** Ja/En UI locale detection, consolidated from the four inline copies. */
export function getUiLocale(): string {
    return navigator.language.startsWith('ja') ? 'ja' : 'en';
}

export interface PromptItemRowConfig {
    /** Base indent width in spaces; every indentation level is a multiple of it. */
    indentUnit: number;
    /** Row identifier attribute name, e.g. 'data-prompt-id'. */
    idAttribute: string;
    /** Text before the action name in button ids, e.g. 'markdown-template-'. */
    buttonIdPrefix: string;
    /** Text after the action name in button ids, e.g. '-prompt'. */
    buttonIdSuffix: string;
    /** Row id; written into the id attribute and every button id. */
    id: string;
    /** Raw display name; escaped by the builder. */
    displayName: string;
    /** Provider label text. Omitted (no provider span) when undefined. */
    providerLabel?: string | undefined;
    isActive: boolean;
    badgeI18nKey: string;
    badgeText: string;
    labels: { activate: string; duplicate: string; edit: string; delete: string };
    /** Render an Edit/Delete pair after the Duplicate button. */
    showEditDelete: boolean;
    /** Indent level of the Edit/Delete buttons (default: same as the other actions). */
    editDeleteLevel?: number | undefined;
    /** Emit a blank indent-only line at this level before the Edit/Delete pair. */
    editDeleteBlankBeforeLevel?: number | undefined;
    /** Emit a blank indent-only line at this level after the last action. */
    actionsBlankAfterLevel?: number | undefined;
}

/**
 * Single `.prompt-item` row builder. Keeps the row skeleton (header / name /
 * provider / badge / actions) in one place; the per-row differences arrive as
 * config. Generated HTML is byte-identical to the four inline builders it
 * replaces, so escapeHtml positions, data-i18n attributes, badge conditions
 * and class names are unchanged.
 */
export function buildPromptItemRow(cfg: PromptItemRowConfig): string {
    const indent = (level: number): string => ' '.repeat(cfg.indentUnit * level);
    const button = (action: string, className: string, label: string): string =>
        `<button id="${cfg.buttonIdPrefix}${action}${cfg.buttonIdSuffix}-${cfg.id}" class="btn-sm ${className}" data-i18n="${action}">${label}</button>`;
    const badge = cfg.isActive
        ? `<span class="badge badge-active" data-i18n="${cfg.badgeI18nKey}">${cfg.badgeText}</span>`
        : '';
    const providerLine = cfg.providerLabel === undefined
        ? ''
        : `${indent(4)}<span class="prompt-provider">(${cfg.providerLabel})</span>\n`;

    const actions: string[] = [];
    actions.push(`${indent(4)}${cfg.isActive ? '' : button('activate', 'btn-activate', cfg.labels.activate)}\n`);
    actions.push(`${indent(4)}${button('duplicate', 'btn-duplicate', cfg.labels.duplicate)}\n`);
    if (cfg.showEditDelete) {
        if (cfg.editDeleteBlankBeforeLevel !== undefined) {
            actions.push(`${indent(cfg.editDeleteBlankBeforeLevel)}\n`);
        }
        const level = cfg.editDeleteLevel ?? 4;
        actions.push(`${indent(level)}${button('edit', 'btn-edit', cfg.labels.edit)}\n`);
        actions.push(`${indent(level)}${button('delete', 'btn-delete', cfg.labels.delete)}\n`);
    }
    if (cfg.actionsBlankAfterLevel !== undefined) {
        actions.push(`${indent(cfg.actionsBlankAfterLevel)}\n`);
    }

    return `${indent(0)}
${indent(2)}<div class="prompt-item ${cfg.isActive ? 'active' : ''}" ${cfg.idAttribute}="${cfg.id}">
${indent(3)}<div class="prompt-item-header">
${indent(4)}<span class="prompt-name">${escapeHtml(cfg.displayName)}</span>
${providerLine}${indent(4)}${badge}
${indent(3)}</div>
${indent(3)}<div class="prompt-item-actions">
${actions.join('')}${indent(3)}</div>
${indent(2)}</div>
${indent(1)}`;
}

/** Action button labels shared by the three prompt rows. */
const PROMPT_ROW_LABELS = {
    activate: '有効化',
    duplicate: '複製',
    edit: '編集',
    delete: '削除',
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

        const prompts = asCustomPrompts(currentSettings[StorageKeys.CUSTOM_PROMPTS]);
        return prompts.every(p => !p.isActive);
    }

    /**
     * Render the list of saved prompts
     */
    function renderPromptList(): void {
        const { promptList, noPromptsMessage } = dom ?? {};
        if (!promptList || !noPromptsMessage || !currentSettings) return;

        const prompts = asCustomPrompts(currentSettings[StorageKeys.CUSTOM_PROMPTS]);
        const locale = getUiLocale();

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

        // Region-scoped wiring: listeners attach to the fresh nodes inside
        // promptList, so a re-render (setElementHtml above) discards the old
        // wiring with the old nodes. destroy() stays limited to the two
        // editor buttons.
        wirePromptListButtons(prompts);
    }

    /**
     * Wire every row button inside the prompt list region in one pass.
     * Scoped to promptList (never document) so a second mount or another
     * region cannot be mis-wired, and preset-backed ids are wired once.
     */
    function wirePromptListButtons(prompts: CustomPrompt[]): void {
        const list = dom?.promptList;
        if (!list) return;
        const byId = new Map(prompts.map(p => [p.id, p]));
        list.querySelectorAll<HTMLButtonElement>('button[id]').forEach(btn => {
            const id = btn.id;
            if (id.startsWith('edit-prompt-')) {
                const pid = id.slice('edit-prompt-'.length);
                btn.addEventListener('click', () => handleEditPrompt(pid));
            } else if (id.startsWith('delete-prompt-')) {
                const pid = id.slice('delete-prompt-'.length);
                btn.addEventListener('click', () => { void handleDeletePrompt(pid); });
            } else if (id.startsWith('activate-prompt-')) {
                const pid = id.slice('activate-prompt-'.length);
                if (pid === PROMPT_ID.DEFAULT || pid.startsWith(PROMPT_ID.PRESET_PREFIX)) {
                    btn.addEventListener('click', () => { void handleActivatePrompt(pid, 'all'); });
                } else {
                    const provider = byId.get(pid)?.provider ?? 'all';
                    btn.addEventListener('click', () => { void handleActivatePrompt(pid, provider); });
                }
            } else if (id.startsWith('duplicate-prompt-')) {
                const pid = id.slice('duplicate-prompt-'.length);
                btn.addEventListener('click', () => handleDuplicatePrompt(pid));
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
        return buildPromptItemRow({
            indentUnit: 4,
            idAttribute: 'data-prompt-id',
            buttonIdPrefix: '',
            buttonIdSuffix: '-prompt',
            id: presetId,
            displayName,
            providerLabel: getMessageOr('promptProviderAll', 'All Providers'),
            isActive,
            badgeI18nKey: 'activePrompt',
            badgeText: '有効',
            labels: PROMPT_ROW_LABELS,
            showEditDelete: false,
        });
    }

    /**
     * Create HTML for the default prompt item
     * @returns {string} HTML string
     */
    function createDefaultPromptItem(): string {
        const isActive = isDefaultActive();
        const locale = getUiLocale();
        const defaultPreset = getPresetPrompt('default');
        const displayName = defaultPreset ? getPromptDisplayName(defaultPreset, locale) : (getMessageOr('defaultPrompt', 'Default'));
        return buildPromptItemRow({
            indentUnit: 4,
            idAttribute: 'data-prompt-id',
            buttonIdPrefix: '',
            buttonIdSuffix: '-prompt',
            id: PROMPT_ID.DEFAULT,
            displayName,
            providerLabel: getMessageOr('promptProviderAll', 'All Providers'),
            isActive,
            badgeI18nKey: 'activePrompt',
            badgeText: 'Active',
            labels: PROMPT_ROW_LABELS,
            showEditDelete: false,
        });
    }

    /**
     * Create HTML for a prompt list item
     * @param prompt The prompt to render
     * @returns {string} HTML string
     */
    function createPromptListItem(prompt: CustomPrompt): string {
        return buildPromptItemRow({
            indentUnit: 4,
            idAttribute: 'data-prompt-id',
            buttonIdPrefix: '',
            buttonIdSuffix: '-prompt',
            id: prompt.id,
            displayName: prompt.name,
            providerLabel: getProviderLabel(prompt.provider),
            isActive: prompt.isActive,
            badgeI18nKey: 'activePrompt',
            badgeText: 'Active',
            labels: PROMPT_ROW_LABELS,
            showEditDelete: true,
            editDeleteLevel: 4,
        });
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
        const provider = asPromptProvider(promptProviderSelect.value);
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
        let prompts = asCustomPrompts(currentSettings[StorageKeys.CUSTOM_PROMPTS]);

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

        const prompts = asCustomPrompts(currentSettings[StorageKeys.CUSTOM_PROMPTS]);
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

        let prompts = asCustomPrompts(currentSettings[StorageKeys.CUSTOM_PROMPTS]);
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

        let prompts = asCustomPrompts(currentSettings[StorageKeys.CUSTOM_PROMPTS]);

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
            const locale = getUiLocale();
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
        const locale = getUiLocale();

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
            const prompts = asCustomPrompts(currentSettings[StorageKeys.CUSTOM_PROMPTS]);
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
