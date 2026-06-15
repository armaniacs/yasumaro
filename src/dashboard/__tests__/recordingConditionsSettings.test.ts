// @vitest-environment jsdom
/**
 * recordingConditionsSettings.test.ts
 * Tests for dashboard recording conditions settings panel.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Chrome API mock
// ---------------------------------------------------------------------------
const mockStorageGet = vi.fn();
const mockStorageSet = vi.fn();

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: mockStorageGet,
      set: mockStorageSet,
    },
  },
} as any);

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------
import { initRecordingConditionsSettings } from '../recordingConditionsSettings.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function setupDOM() {
  document.body.innerHTML = `
    <div id="recording-conditions-settings">
      <div class="settings-section">
        <h3 class="settings-section-title">記録条件</h3>

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
      </div>

      <div class="form-actions">
        <button id="save-conditions-settings">Save</button>
        <span id="conditions-validation-error" style="display:none"></span>
        <span id="conditions-save-success" style="display:none"></span>
      </div>
    </div>
  `;
}

describe('recordingConditionsSettings', () => {
  beforeEach(() => {
    setupDOM();
    vi.clearAllMocks();
  });

  it('loads and renders recording conditions with defaults', async () => {
    mockStorageGet.mockResolvedValue({});
    await initRecordingConditionsSettings();

    const minVisitInput = document.getElementById('minVisitDuration') as HTMLInputElement;
    const minScrollInput = document.getElementById('minScrollDepth') as HTMLInputElement;
    const maxTokensInput = document.getElementById('maxTokensPerPrompt') as HTMLInputElement;

    expect(minVisitInput?.value).toBe('5');
    expect(minScrollInput?.value).toBe('50');
    expect(maxTokensInput?.value).toBe('1000');
  });

  it('saves recording conditions to storage on save click', async () => {
    mockStorageGet.mockResolvedValue({});
    mockStorageSet.mockResolvedValue(undefined);
    await initRecordingConditionsSettings();

    const saveBtn = document.getElementById('save-conditions-settings') as HTMLButtonElement;
    saveBtn.click();

    await vi.waitFor(() => {
      expect(mockStorageSet).toHaveBeenCalled();
    });
  });
});
