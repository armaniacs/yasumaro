/**
 * recordingConditionsSettings.ts
 * Dashboard settings panel for recording conditions configuration.
 * Note: Recording triggers (scroll/time/snapshot) are no longer configurable.
 */

import { StorageKeys, getSettings, saveSettings } from '../utils/storage.js';
import { errorMessage } from '../utils/errorUtils.js';
import { getMessage } from '../utils/i18n.js';
import { applyI18n } from '../utils/i18n-dom.js';

let minVisitDuration = 5;
let minScrollDepth = 50;
let maxTokensPerPrompt = 1000;
let aiTimeoutSeconds = 0; // 0 = auto

export async function initRecordingConditionsSettings(): Promise<void> {
  const container = document.getElementById('recording-conditions-settings');
  if (!container) return;

  // Load current settings
  await loadConditionsSettings();

  renderSettings(container);
  wireEvents(container);

  // Apply i18n to dynamically rendered content
  applyI18n(container);
}

async function loadConditionsSettings(): Promise<void> {
  try {
    const settings = await getSettings();
    minVisitDuration = (settings[StorageKeys.MIN_VISIT_DURATION] as number) || 5;
    minScrollDepth = (settings[StorageKeys.MIN_SCROLL_DEPTH] as number) || 50;
    maxTokensPerPrompt = (settings[StorageKeys.MAX_TOKENS_PER_PROMPT] as number) || 1000;
    const aiTimeoutMs = (settings[StorageKeys.AI_TIMEOUT_MS] as number) || 0;
    aiTimeoutSeconds = aiTimeoutMs > 0 ? Math.round(aiTimeoutMs / 1000) : 0;
  } catch {
    minVisitDuration = 5;
    minScrollDepth = 50;
    maxTokensPerPrompt = 1000;
    aiTimeoutSeconds = 0;
  }
}

function renderSettings(container: HTMLElement): void {
  container.innerHTML = `
    <div class="settings-section">
      <h3 class="settings-section-title">${getMessage('recordingSection') || '記録条件'}</h3>

      <div class="form-group">
        <label for="minVisitDuration">${getMessage('minVisitDuration') || 'Min Visit Duration (seconds)'}</label>
        <input type="number" id="minVisitDuration" min="1" value="${minVisitDuration}" aria-invalid="false"
          aria-describedby="minVisitDurationError">
        <div id="minVisitDurationError" class="field-error" role="alert"></div>
      </div>

      <div class="form-group">
        <label for="minScrollDepth">${getMessage('minScrollDepth') || 'Min Scroll Depth (%)'}</label>
        <input type="number" id="minScrollDepth" min="0" max="100" value="${minScrollDepth}" aria-invalid="false"
          aria-describedby="minScrollDepthError">
        <div id="minScrollDepthError" class="field-error" role="alert"></div>
      </div>

      <div class="form-group">
        <label for="maxTokensPerPrompt">${getMessage('label_max_tokens') || 'Max Tokens Per Prompt'}</label>
        <input type="number" id="maxTokensPerPrompt" min="10" max="16000" step="100" value="${maxTokensPerPrompt}" aria-invalid="false"
          aria-describedby="maxTokensError maxTokensNote">
        <p class="help-text" id="maxTokensNote">${getMessage('note_max_tokens_cost_control') || ''}</p>
        <div id="maxTokensError" class="field-error" role="alert"></div>
      </div>

      <div class="form-group">
        <label for="aiTimeoutSeconds">${getMessage('label_ai_timeout') || 'AI Timeout (seconds)'}</label>
        <input type="number" id="aiTimeoutSeconds" min="10" max="600" step="10" value="${aiTimeoutSeconds || ''}" aria-invalid="false"
          aria-describedby="aiTimeoutNote" placeholder="auto">
        <p class="help-text" id="aiTimeoutNote">${getMessage('note_ai_timeout') || ''}</p>
      </div>
    </div>

    <div class="form-actions">
      <button id="save-conditions-settings" class="btn-primary">${getMessage('save') || 'Save'}</button>
      <span id="conditions-validation-error" class="validation-error" role="alert" style="display:none"></span>
      <span id="conditions-save-success" class="save-success" aria-live="polite" style="display:none">${getMessage('settingsSaved') || 'Settings saved.'}</span>
    </div>
  `;
}

function wireEvents(container: HTMLElement): void {
  const saveBtn = container.querySelector('#save-conditions-settings') as HTMLButtonElement;
  const validationError = container.querySelector('#conditions-validation-error') as HTMLElement;
  const successMsg = container.querySelector('#conditions-save-success') as HTMLElement;

  saveBtn?.addEventListener('click', async () => {
    validationError.style.display = 'none';
    successMsg.style.display = 'none';

    // Validate recording conditions
    const minVisitInput = container.querySelector('#minVisitDuration') as HTMLInputElement;
    const minScrollInput = container.querySelector('#minScrollDepth') as HTMLInputElement;
    const maxTokensInput = container.querySelector('#maxTokensPerPrompt') as HTMLInputElement;
    const aiTimeoutInput = container.querySelector('#aiTimeoutSeconds') as HTMLInputElement;

    const minVisitVal = parseInt(minVisitInput?.value || '5', 10);
    const minScrollVal = parseInt(minScrollInput?.value || '50', 10);
    const maxTokensVal = parseInt(maxTokensInput?.value || '1000', 10);
    const aiTimeoutVal = aiTimeoutInput?.value ? parseInt(aiTimeoutInput.value, 10) : 0;

    if (isNaN(minVisitVal) || minVisitVal < 1) {
      validationError.textContent = getMessage('minVisitDurationError') || 'Min visit duration must be at least 1 second.';
      validationError.style.display = '';
      return;
    }

    if (isNaN(minScrollVal) || minScrollVal < 0 || minScrollVal > 100) {
      validationError.textContent = getMessage('minScrollDepthError') || 'Min scroll depth must be between 0 and 100.';
      validationError.style.display = '';
      return;
    }

    if (isNaN(maxTokensVal) || maxTokensVal < 10 || maxTokensVal > 16000) {
      validationError.textContent = getMessage('maxTokensError') || 'Max tokens must be between 10 and 16000.';
      validationError.style.display = '';
      return;
    }

    try {
      // Save recording conditions via saveSettings so values are written
      // to the 'settings' object, matching what getSettings reads.
      await saveSettings({
        [StorageKeys.MIN_VISIT_DURATION]: minVisitVal,
        [StorageKeys.MIN_SCROLL_DEPTH]: minScrollVal,
        [StorageKeys.MAX_TOKENS_PER_PROMPT]: maxTokensVal,
        [StorageKeys.AI_TIMEOUT_MS]: aiTimeoutVal > 0 ? aiTimeoutVal * 1000 : 0,
      });

      minVisitDuration = minVisitVal;
      minScrollDepth = minScrollVal;
      maxTokensPerPrompt = maxTokensVal;
      aiTimeoutSeconds = aiTimeoutVal;

      successMsg.style.display = '';
    } catch (err) {
      validationError.textContent = `${getMessage('error') || 'Error'}: ${errorMessage(err)}`;
      validationError.style.display = '';
    }
  });
}
