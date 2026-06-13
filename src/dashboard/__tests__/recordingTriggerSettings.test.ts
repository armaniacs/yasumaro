// @vitest-environment jsdom
/**
 * recordingTriggerSettings.test.ts
 * Tests for dashboard recording trigger settings panel.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Chrome API mock
// ---------------------------------------------------------------------------
const mockStorageGet = vi.fn();
const mockStorageSet = vi.fn();
const mockSendMessage = vi.fn();
const mockGetMessage = vi.fn((key: string) => key);

globalThis.chrome = {
  runtime: {
    sendMessage: mockSendMessage,
  },
  storage: {
    local: {
      get: mockStorageGet,
      set: mockStorageSet,
    },
  },
  i18n: {
    getMessage: mockGetMessage,
  },
} as any;

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------
import { initRecordingTriggerSettings } from '../recordingTriggerSettings.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function setupDOM() {
  document.body.innerHTML = `
    <div id="recording-trigger-settings">
      <!-- Recording Triggers Section -->
      <div class="settings-section">
        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" id="trigger-tab-close" />
            <span>Tab Close</span>
          </label>
        </div>
        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" id="trigger-scroll-time" />
            <span>Scroll 50% + 5s Visit</span>
          </label>
        </div>
        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" id="trigger-manual" />
            <span>Manual Save</span>
          </label>
        </div>
        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" id="trigger-snapshot" />
            <span>Periodic Snapshot</span>
          </label>
          <div id="snapshot-interval-group" style="display:none">
            <input type="number" id="snapshot-interval" min="1" max="60" value="5" />
          </div>
        </div>
      </div>

      <!-- Recording Conditions Section -->
      <div class="settings-section">
        <div class="form-group">
          <label for="minVisitDuration">Min Visit Duration (seconds)</label>
          <input type="number" id="minVisitDuration" min="1" value="5" />
          <div id="minVisitDurationError" class="field-error" role="alert"></div>
        </div>
        <div class="form-group">
          <label for="minScrollDepth">Min Scroll Depth (%)</label>
          <input type="number" id="minScrollDepth" min="0" max="100" value="50" />
          <div id="minScrollDepthError" class="field-error" role="alert"></div>
        </div>
        <div class="form-group">
          <label for="maxTokensPerPrompt">Max Tokens Per Prompt</label>
          <input type="number" id="maxTokensPerPrompt" min="10" max="16000" step="100" value="1000" />
          <div id="maxTokensError" class="field-error" role="alert"></div>
        </div>
        <div class="form-group">
          <label for="aiTimeoutSeconds">AI Timeout (seconds)</label>
          <input type="number" id="aiTimeoutSeconds" min="10" max="600" step="10" value="" />
        </div>
      </div>

      <div class="form-actions">
        <button id="save-trigger-settings">Save</button>
        <span id="trigger-validation-error" style="display:none"></span>
        <span id="trigger-save-success" style="display:none"></span>
      </div>
    </div>
  `;
}

const STORAGE_KEYS = {
  RECORDING_TRIGGERS: 'recording_triggers',
  SNAPSHOT_INTERVAL_MINUTES: 'snapshot_interval_minutes',
};

describe('recordingTriggerSettings', () => {
  beforeEach(() => {
    setupDOM();
    vi.clearAllMocks();
  });

  // =========================================================================
  // loadTriggerSettings — default values
  // =========================================================================

  it('loads and renders triggers with defaults when no stored settings', async () => {
    mockStorageGet.mockResolvedValue({});
    await initRecordingTriggerSettings();

    const tabCloseCheckbox = document.getElementById('trigger-tab-close') as HTMLInputElement;
    const manualCheckbox = document.getElementById('trigger-manual') as HTMLInputElement;
    const scrollCheckbox = document.getElementById('trigger-scroll-time') as HTMLInputElement;
    const snapshotCheckbox = document.getElementById('trigger-snapshot') as HTMLInputElement;

    expect(tabCloseCheckbox?.checked).toBe(true);
    expect(manualCheckbox?.checked).toBe(true);
    expect(scrollCheckbox?.checked).toBe(false);
    expect(snapshotCheckbox?.checked).toBe(false);
  });

  it('restores saved trigger settings from storage', async () => {
    mockStorageGet.mockImplementation((keys: string[]) => {
      const result: Record<string, any> = {};
      if (keys.includes(STORAGE_KEYS.RECORDING_TRIGGERS)) {
        result[STORAGE_KEYS.RECORDING_TRIGGERS] = JSON.stringify({
          tabClose: false,
          scrollAndTime: true,
          manualSave: false,
          periodicSnapshot: true,
        });
      }
      if (keys.includes(STORAGE_KEYS.SNAPSHOT_INTERVAL_MINUTES)) {
        result[STORAGE_KEYS.SNAPSHOT_INTERVAL_MINUTES] = 10;
      }
      return result;
    });

    await initRecordingTriggerSettings();

    const tabCloseCheckbox = document.getElementById('trigger-tab-close') as HTMLInputElement;
    const scrollCheckbox = document.getElementById('trigger-scroll-time') as HTMLInputElement;
    const snapshotCheckbox = document.getElementById('trigger-snapshot') as HTMLInputElement;
    const intervalInput = document.getElementById('snapshot-interval') as HTMLInputElement;

    expect(tabCloseCheckbox?.checked).toBe(false);
    expect(scrollCheckbox?.checked).toBe(true);
    expect(snapshotCheckbox?.checked).toBe(true);
    expect(intervalInput?.value).toBe('10');
  });

  it('parses stored trigger JSON correctly', async () => {
    mockStorageGet.mockImplementation((keys: string[]) => {
      const result: Record<string, any> = {};
      if (keys.includes(STORAGE_KEYS.RECORDING_TRIGGERS)) {
        result[STORAGE_KEYS.RECORDING_TRIGGERS] = JSON.stringify({
          tabClose: false, scrollAndTime: true, manualSave: true, periodicSnapshot: false,
        });
      }
      if (keys.includes(STORAGE_KEYS.SNAPSHOT_INTERVAL_MINUTES)) {
        result[STORAGE_KEYS.SNAPSHOT_INTERVAL_MINUTES] = 3;
      }
      return result;
    });

    await initRecordingTriggerSettings();
    const tabCloseCheckbox = document.getElementById('trigger-tab-close') as HTMLInputElement;
    expect(tabCloseCheckbox?.checked).toBe(false);
  });

  it('falls back to defaults on JSON parse error', async () => {
    mockStorageGet.mockImplementation((keys: string[]) => {
      const result: Record<string, any> = {};
      if (keys.includes(STORAGE_KEYS.RECORDING_TRIGGERS)) {
        result[STORAGE_KEYS.RECORDING_TRIGGERS] = '{invalid json}';
      }
      return result;
    });

    await initRecordingTriggerSettings();
    const tabCloseCheckbox = document.getElementById('trigger-tab-close') as HTMLInputElement;
    expect(tabCloseCheckbox?.checked).toBe(true); // Default
  });

  it('falls back to defaults on storage error', async () => {
    mockStorageGet.mockRejectedValue(new Error('Storage error'));
    await initRecordingTriggerSettings();

    const tabCloseCheckbox = document.getElementById('trigger-tab-close') as HTMLInputElement;
    expect(tabCloseCheckbox?.checked).toBe(true);
  });

  it('does nothing when container element is missing', async () => {
    document.body.innerHTML = '';
    mockStorageGet.mockResolvedValue({});

    await expect(initRecordingTriggerSettings()).resolves.toBeUndefined();
    expect(mockStorageGet).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Save behavior
  // =========================================================================

  describe('save triggers', () => {
    beforeEach(async () => {
      mockStorageGet.mockImplementation((keys: string[]) => {
        const result: Record<string, any> = {};
        if (keys.includes(STORAGE_KEYS.RECORDING_TRIGGERS)) {
          result[STORAGE_KEYS.RECORDING_TRIGGERS] = JSON.stringify({
            tabClose: true, scrollAndTime: false, manualSave: true, periodicSnapshot: false,
          });
        }
        if (keys.includes(STORAGE_KEYS.SNAPSHOT_INTERVAL_MINUTES)) {
          result[STORAGE_KEYS.SNAPSHOT_INTERVAL_MINUTES] = 5;
        }
        return result;
      });
      mockStorageSet.mockResolvedValue(undefined);
      mockSendMessage.mockImplementation((_msg: any, callback?: Function) => {
        if (callback) callback({});
      });

      await initRecordingTriggerSettings();
    });

    it('saves trigger settings to storage on save click', async () => {
      const saveBtn = document.getElementById('save-trigger-settings') as HTMLButtonElement;
      saveBtn.click();

      await vi.waitFor(() => {
        expect(mockStorageSet).toHaveBeenCalled();
      });

      // RECORDING_TRIGGERS should be saved
      const setCalls = mockStorageSet.mock.calls;
      const triggerCall = setCalls.find(
        (call: any[]) => call[0][STORAGE_KEYS.RECORDING_TRIGGERS] !== undefined,
      );
      expect(triggerCall).toBeDefined();
      const savedTriggers = JSON.parse(triggerCall[0][STORAGE_KEYS.RECORDING_TRIGGERS]);
      expect(savedTriggers.tabClose).toBe(true);
      expect(savedTriggers.manualSave).toBe(true);
    });

    it('saves snapshot interval', async () => {
      const intervalInput = document.getElementById('snapshot-interval') as HTMLInputElement;
      intervalInput.value = '15';

      const saveBtn = document.getElementById('save-trigger-settings') as HTMLButtonElement;
      saveBtn.click();

      await vi.waitFor(() => {
        const setCalls = mockStorageSet.mock.calls;
        const intervalCall = setCalls.find(
          (call: any[]) => call[0][STORAGE_KEYS.SNAPSHOT_INTERVAL_MINUTES] !== undefined,
        );
        expect(intervalCall).toBeDefined();
        expect(intervalCall[0][STORAGE_KEYS.SNAPSHOT_INTERVAL_MINUTES]).toBe(15);
      });
    });

    it('clamps snapshot interval to 1-60 range', async () => {
      const intervalInput = document.getElementById('snapshot-interval') as HTMLInputElement;
      intervalInput.value = '-5';

      const saveBtn = document.getElementById('save-trigger-settings') as HTMLButtonElement;
      saveBtn.click();

      await vi.waitFor(() => {
        const setCalls = mockStorageSet.mock.calls;
        const intervalCall = setCalls.find(
          (call: any[]) => call[0][STORAGE_KEYS.SNAPSHOT_INTERVAL_MINUTES] !== undefined,
        );
        expect(intervalCall[0][STORAGE_KEYS.SNAPSHOT_INTERVAL_MINUTES]).toBe(1);
      });
    });

    it('shows validation error when no triggers enabled', async () => {
      // Uncheck all checkboxes
      const checkboxes = document.querySelectorAll<HTMLInputElement>('#recording-trigger-settings input[type="checkbox"]');
      checkboxes.forEach(cb => { cb.checked = false; });

      const validationError = document.getElementById('trigger-validation-error') as HTMLElement;
      expect(validationError.style.display).toBe('none');

      const saveBtn = document.getElementById('save-trigger-settings') as HTMLButtonElement;
      saveBtn.click();

      await vi.waitFor(() => {
        expect(validationError.style.display).not.toBe('none');
      });
      // The error message is now an i18n key
      expect(validationError.textContent).toBeTruthy();
    });

    it('shows success message after saving', async () => {
      const successMsg = document.getElementById('trigger-save-success') as HTMLElement;
      expect(successMsg.style.display).toBe('none');

      const saveBtn = document.getElementById('save-trigger-settings') as HTMLButtonElement;
      saveBtn.click();

      await vi.waitFor(() => {
        expect(successMsg.style.display).not.toBe('none');
      });
    });

    it('shows error message on storage failure', async () => {
      mockStorageSet.mockRejectedValue(new Error('Storage quota exceeded'));

      const saveBtn = document.getElementById('save-trigger-settings') as HTMLButtonElement;
      saveBtn.click();

      const validationError = document.getElementById('trigger-validation-error') as HTMLElement;
      await vi.waitFor(() => {
        expect(validationError.style.display).not.toBe('none');
      });
      expect(validationError.textContent).toContain('quota');
    });

    it('shows snapshot interval group when snapshot is toggled', async () => {
      const snapshotCheckbox = document.getElementById('trigger-snapshot') as HTMLInputElement;
      const intervalGroup = document.getElementById('snapshot-interval-group') as HTMLElement;

      snapshotCheckbox.checked = true;
      snapshotCheckbox.dispatchEvent(new Event('change'));

      expect(intervalGroup.style.display).not.toBe('none');

      snapshotCheckbox.checked = false;
      snapshotCheckbox.dispatchEvent(new Event('change'));

      expect(intervalGroup.style.display).toBe('none');
    });
  });
});
