/**
 * recordingTriggerSettings.ts
 * Dashboard settings panel for recording trigger configuration.
 */

import { StorageKeys } from '../utils/storage.js';
import type { RecordingTriggers } from '../background/recordingTriggerManager.js';

const DEFAULT_TRIGGERS: RecordingTriggers = {
  tabClose: true,
  scrollAndTime: false,
  manualSave: true,
  periodicSnapshot: false,
};

let currentTriggers: RecordingTriggers = { ...DEFAULT_TRIGGERS };
let snapshotInterval = 5;

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
  } catch {
    currentTriggers = { ...DEFAULT_TRIGGERS };
    snapshotInterval = 5;
  }
}

function renderSettings(container: HTMLElement): void {
  container.innerHTML = `
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

    <div class="form-actions">
      <button id="save-trigger-settings" class="btn-primary" data-i18n="saveTriggers">Save</button>
      <span id="trigger-validation-error" class="validation-error" style="display:none"></span>
      <span id="trigger-save-success" class="save-success" style="display:none" data-i18n="triggersSaved">Settings saved.</span>
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
      validationError.textContent = 'At least one trigger must be enabled.';
      validationError.style.display = '';
      return;
    }

    try {
      await chrome.storage.local.set({
        [StorageKeys.RECORDING_TRIGGERS]: JSON.stringify(triggers),
      });

      // Save snapshot interval
      const intervalInput = container.querySelector('#snapshot-interval') as HTMLInputElement;
      if (intervalInput) {
        const interval = Math.max(1, Math.min(60, parseInt(intervalInput.value, 10) || 5));
        await chrome.storage.local.set({ [StorageKeys.SNAPSHOT_INTERVAL_MINUTES]: interval });
      }

      currentTriggers = { ...triggers };
      successMsg.style.display = '';

      // Notify service worker to reload trigger config
      chrome.runtime.sendMessage({ type: 'PING' }).catch(() => { /* ignore */ });
    } catch (err) {
      validationError.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
      validationError.style.display = '';
    }
  });
}
