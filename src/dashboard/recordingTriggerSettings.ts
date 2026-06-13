/**
 * recordingTriggerSettings.ts
 * Dashboard settings panel for recording trigger configuration.
 */

import { StorageKeys, getSettings } from '../utils/storage.js';
import { errorMessage } from '../utils/errorUtils.js';
import { getMessage } from '../popup/i18n.js';
import type { RecordingTriggers } from '../background/recordingTriggerManager.js';

const DEFAULT_TRIGGERS: RecordingTriggers = {
  tabClose: true,
  scrollAndTime: false,
  manualSave: true,
  periodicSnapshot: false,
};

let currentTriggers: RecordingTriggers = { ...DEFAULT_TRIGGERS };
let snapshotInterval = 5;
let minVisitDuration = 5;
let minScrollDepth = 50;
let maxTokensPerPrompt = 1000;
let aiTimeoutSeconds = 0; // 0 = auto

export async function initRecordingTriggerSettings(): Promise<void> {
  const container = document.getElementById('recording-trigger-settings');
  if (!container) return;

  // Load current settings
  await loadTriggerSettings();

  renderSettings(container);
  wireEvents(container);
}

async function loadTriggerSettings(): Promise<void> {
  try {
    const result = await chrome.storage.local.get([
      StorageKeys.RECORDING_TRIGGERS,
      StorageKeys.SNAPSHOT_INTERVAL_MINUTES,
    ]);

    const raw = result[StorageKeys.RECORDING_TRIGGERS];
    if (typeof raw === 'string') {
      const parsed = JSON.parse(raw) as Partial<RecordingTriggers>;
      currentTriggers = { ...DEFAULT_TRIGGERS, ...parsed };
    } else {
      currentTriggers = { ...DEFAULT_TRIGGERS };
    }

    snapshotInterval = (result[StorageKeys.SNAPSHOT_INTERVAL_MINUTES] as number) || 5;

    // Load recording conditions
    const settings = await getSettings();
    minVisitDuration = (settings[StorageKeys.MIN_VISIT_DURATION] as number) || 5;
    minScrollDepth = (settings[StorageKeys.MIN_SCROLL_DEPTH] as number) || 50;
    maxTokensPerPrompt = (settings[StorageKeys.MAX_TOKENS_PER_PROMPT] as number) || 1000;
    const aiTimeoutMs = (settings[StorageKeys.AI_TIMEOUT_MS] as number) || 0;
    aiTimeoutSeconds = aiTimeoutMs > 0 ? Math.round(aiTimeoutMs / 1000) : 0;
  } catch {
    currentTriggers = { ...DEFAULT_TRIGGERS };
    snapshotInterval = 5;
    minVisitDuration = 5;
    minScrollDepth = 50;
    maxTokensPerPrompt = 1000;
    aiTimeoutSeconds = 0;
  }
}

function renderSettings(container: HTMLElement): void {
  container.innerHTML = `
    <!-- Recording Triggers Section -->
    <div class="settings-section">
      <h3 class="settings-section-title" data-i18n="recordingTriggersSection">記録トリガー</h3>

      <div class="form-group">
        <label class="checkbox-label">
          <input type="checkbox" id="trigger-tab-close" ${currentTriggers.tabClose ? 'checked' : ''} />
          <span data-i18n="triggerTabClose">Tab Close</span>
        </label>
        <p class="field-description" data-i18n="triggerTabCloseDesc">
          Record when a tab is closed.
        </p>
      </div>

      <div class="form-group">
        <label class="checkbox-label">
          <input type="checkbox" id="trigger-scroll-time" ${currentTriggers.scrollAndTime ? 'checked' : ''} />
          <span data-i18n="triggerScrollTime">Scroll 50% + 5s Visit</span>
        </label>
        <p class="field-description" data-i18n="triggerScrollTimeDesc">
          Record when page is scrolled past 50% and visited for at least 5 seconds.
        </p>
      </div>

      <div class="form-group">
        <label class="checkbox-label">
          <input type="checkbox" id="trigger-manual" ${currentTriggers.manualSave ? 'checked' : ''} />
          <span data-i18n="triggerManual">Manual Save (from popup)</span>
        </label>
        <p class="field-description" data-i18n="triggerManualDesc">
          Record manually by clicking "Save" in the extension popup.
        </p>
      </div>

      <div class="form-group">
        <label class="checkbox-label">
          <input type="checkbox" id="trigger-snapshot" ${currentTriggers.periodicSnapshot ? 'checked' : ''} />
          <span data-i18n="triggerSnapshot">Periodic Snapshot</span>
        </label>
        <p class="field-description" data-i18n="triggerSnapshotDesc">
          Periodically record the currently active tab.
        </p>
        <div class="snapshot-interval-setting" id="snapshot-interval-group"
             style="${currentTriggers.periodicSnapshot ? '' : 'display:none'}">
          <label for="snapshot-interval" data-i18n="snapshotIntervalLabel">Interval (minutes):</label>
          <input type="number" id="snapshot-interval" min="1" max="60"
                 value="${snapshotInterval}" />
        </div>
      </div>
    </div>

    <!-- Recording Conditions Section -->
    <div class="settings-section">
      <h3 class="settings-section-title" data-i18n="recordingSection">記録条件</h3>

      <div class="form-group">
        <label for="minVisitDuration" data-i18n="minVisitDuration">Min Visit Duration (seconds)</label>
        <input type="number" id="minVisitDuration" min="1" value="${minVisitDuration}" aria-invalid="false"
          aria-describedby="minVisitDurationError">
        <div id="minVisitDurationError" class="field-error" role="alert"></div>
      </div>

      <div class="form-group">
        <label for="minScrollDepth" data-i18n="minScrollDepth">Min Scroll Depth (%)</label>
        <input type="number" id="minScrollDepth" min="0" max="100" value="${minScrollDepth}" aria-invalid="false"
          aria-describedby="minScrollDepthError">
        <div id="minScrollDepthError" class="field-error" role="alert"></div>
      </div>

      <div class="form-group">
        <label for="maxTokensPerPrompt" data-i18n="label_max_tokens">Max Tokens Per Prompt</label>
        <input type="number" id="maxTokensPerPrompt" min="10" max="16000" step="100" value="${maxTokensPerPrompt}" aria-invalid="false"
          aria-describedby="maxTokensError maxTokensNote">
        <p class="help-text" id="maxTokensNote" data-i18n="note_max_tokens_cost_control"></p>
        <div id="maxTokensError" class="field-error" role="alert"></div>
      </div>

      <div class="form-group">
        <label for="aiTimeoutSeconds" data-i18n="label_ai_timeout">AI Timeout (seconds)</label>
        <input type="number" id="aiTimeoutSeconds" min="10" max="600" step="10" value="${aiTimeoutSeconds || ''}" aria-invalid="false"
          aria-describedby="aiTimeoutNote" placeholder="auto">
        <p class="help-text" id="aiTimeoutNote" data-i18n="note_ai_timeout"></p>
      </div>
    </div>

    <div class="form-actions">
      <button id="save-trigger-settings" class="btn-primary" data-i18n="saveTriggers">Save</button>
      <span id="trigger-validation-error" class="validation-error" role="alert" style="display:none"></span>
      <span id="trigger-save-success" class="save-success" aria-live="polite" style="display:none" data-i18n="triggersSaved">Settings saved.</span>
    </div>
  `;
}

function wireEvents(container: HTMLElement): void {
  const snapshotCheckbox = container.querySelector('#trigger-snapshot') as HTMLInputElement;
  const snapshotIntervalGroup = container.querySelector('#snapshot-interval-group') as HTMLElement;

  snapshotCheckbox?.addEventListener('change', () => {
    snapshotIntervalGroup.style.display = snapshotCheckbox.checked ? '' : 'none';
  });

  const saveBtn = container.querySelector('#save-trigger-settings') as HTMLButtonElement;
  const validationError = container.querySelector('#trigger-validation-error') as HTMLElement;
  const successMsg = container.querySelector('#trigger-save-success') as HTMLElement;

  saveBtn?.addEventListener('click', async () => {
    validationError.style.display = 'none';
    successMsg.style.display = 'none';

    const triggers: RecordingTriggers = {
      tabClose: (container.querySelector('#trigger-tab-close') as HTMLInputElement)?.checked ?? false,
      scrollAndTime: (container.querySelector('#trigger-scroll-time') as HTMLInputElement)?.checked ?? false,
      manualSave: (container.querySelector('#trigger-manual') as HTMLInputElement)?.checked ?? false,
      periodicSnapshot: snapshotCheckbox?.checked ?? false,
    };

    // Validate: at least one trigger required
    const enabled = Object.values(triggers).filter(Boolean).length;
    if (enabled === 0) {
      validationError.textContent = getMessage('triggersAtLeastOne') || 'At least one trigger must be enabled.';
      validationError.style.display = '';
      return;
    }

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
      // Save triggers
      await chrome.storage.local.set({
        [StorageKeys.RECORDING_TRIGGERS]: JSON.stringify(triggers),
      });

      // Save snapshot interval
      const intervalInput = container.querySelector('#snapshot-interval') as HTMLInputElement;
      if (intervalInput) {
        const interval = Math.max(1, Math.min(60, parseInt(intervalInput.value, 10) || 5));
        await chrome.storage.local.set({ [StorageKeys.SNAPSHOT_INTERVAL_MINUTES]: interval });
      }

      // Save recording conditions
      await chrome.storage.local.set({
        [StorageKeys.MIN_VISIT_DURATION]: minVisitVal,
        [StorageKeys.MIN_SCROLL_DEPTH]: minScrollVal,
        [StorageKeys.MAX_TOKENS_PER_PROMPT]: maxTokensVal,
        [StorageKeys.AI_TIMEOUT_MS]: aiTimeoutVal > 0 ? aiTimeoutVal * 1000 : 0,
      });

      currentTriggers = { ...triggers };
      minVisitDuration = minVisitVal;
      minScrollDepth = minScrollVal;
      maxTokensPerPrompt = maxTokensVal;
      aiTimeoutSeconds = aiTimeoutVal;

      successMsg.style.display = '';

      // Notify service worker to reload trigger config
      chrome.runtime.sendMessage({ type: 'PING' }).catch(() => { /* ignore */ });
    } catch (err) {
      validationError.textContent = `${getMessage('error') || 'Error'}: ${errorMessage(err)}`;
      validationError.style.display = '';
    }
  });
}
