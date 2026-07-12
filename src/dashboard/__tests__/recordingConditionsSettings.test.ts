// @vitest-environment jsdom
/**
 * recordingConditionsSettings.test.ts
 * Tests for dashboard recording conditions settings panel.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks for storage module
// ---------------------------------------------------------------------------
const { mockGetSettings, mockSaveSettings } = vi.hoisted(() => ({
  mockGetSettings: vi.fn(),
  mockSaveSettings: vi.fn(),
}));

vi.mock('../../utils/storage.js', () => ({
  getSettings: mockGetSettings,
  saveSettings: mockSaveSettings,
  StorageKeys: {
    MIN_VISIT_DURATION: 'minVisitDuration',
    MIN_SCROLL_DEPTH: 'minScrollDepth',
    MAX_TOKENS_PER_PROMPT: 'maxTokensPerPrompt',
    AI_TIMEOUT_MS: 'aiTimeoutMs',
  },
}));

// ---------------------------------------------------------------------------
// Chrome API mock (for i18n)
// ---------------------------------------------------------------------------
vi.stubGlobal('chrome', {
  i18n: {
    getMessage: vi.fn().mockReturnValue(''),
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

  it('loads and renders recording conditions with defaults when no settings exist', async () => {
    mockGetSettings.mockResolvedValue({});
    await initRecordingConditionsSettings();

    const minVisitInput = document.getElementById('minVisitDuration') as HTMLInputElement;
    const minScrollInput = document.getElementById('minScrollDepth') as HTMLInputElement;
    const maxTokensInput = document.getElementById('maxTokensPerPrompt') as HTMLInputElement;

    expect(minVisitInput?.value).toBe('5');
    expect(minScrollInput?.value).toBe('50');
    expect(maxTokensInput?.value).toBe('1000');
  });

  it('loads previously saved values from getSettings', async () => {
    mockGetSettings.mockResolvedValue({
      minVisitDuration: 10,
      minScrollDepth: 75,
      maxTokensPerPrompt: 2000,
      aiTimeoutMs: 30000,
    });
    await initRecordingConditionsSettings();

    const minVisitInput = document.getElementById('minVisitDuration') as HTMLInputElement;
    const minScrollInput = document.getElementById('minScrollDepth') as HTMLInputElement;
    const maxTokensInput = document.getElementById('maxTokensPerPrompt') as HTMLInputElement;
    const aiTimeoutInput = document.getElementById('aiTimeoutSeconds') as HTMLInputElement;

    expect(minVisitInput?.value).toBe('10');
    expect(minScrollInput?.value).toBe('75');
    expect(maxTokensInput?.value).toBe('2000');
    expect(aiTimeoutInput?.value).toBe('30');
  });

  it('saves recording conditions via saveSettings on save click', async () => {
    mockGetSettings.mockResolvedValue({});
    mockSaveSettings.mockResolvedValue(undefined);
    await initRecordingConditionsSettings();

    const minVisitInput = document.getElementById('minVisitDuration') as HTMLInputElement;
    const maxTokensInput = document.getElementById('maxTokensPerPrompt') as HTMLInputElement;
    minVisitInput.value = '15';
    maxTokensInput.value = '3000';

    const saveBtn = document.getElementById('save-conditions-settings') as HTMLButtonElement;
    saveBtn.click();

    await vi.waitFor(() => {
      expect(mockSaveSettings).toHaveBeenCalled();
    });

    expect(mockSaveSettings).toHaveBeenCalledWith({
      minVisitDuration: 15,
      minScrollDepth: 50,
      maxTokensPerPrompt: 3000,
      aiTimeoutMs: 0,
    });
  });

  it('shows success message after save', async () => {
    mockGetSettings.mockResolvedValue({});
    mockSaveSettings.mockResolvedValue(undefined);
    await initRecordingConditionsSettings();

    const saveBtn = document.getElementById('save-conditions-settings') as HTMLButtonElement;
    saveBtn.click();

    await vi.waitFor(() => {
      const successMsg = document.getElementById('conditions-save-success');
      expect(successMsg?.style.display).toBe('');
    });
  });

  it('shows validation error for invalid min visit duration', async () => {
    mockGetSettings.mockResolvedValue({});
    await initRecordingConditionsSettings();

    const minVisitInput = document.getElementById('minVisitDuration') as HTMLInputElement;
    minVisitInput.value = '0';

    const saveBtn = document.getElementById('save-conditions-settings') as HTMLButtonElement;
    saveBtn.click();

    await vi.waitFor(() => {
      const errorMsg = document.getElementById('conditions-validation-error');
      expect(errorMsg?.style.display).toBe('');
    });

    expect(mockSaveSettings).not.toHaveBeenCalled();
  });

  it('handles saveSettings error gracefully', async () => {
    mockGetSettings.mockResolvedValue({});
    mockSaveSettings.mockRejectedValue(new Error('Storage full'));
    await initRecordingConditionsSettings();

    const saveBtn = document.getElementById('save-conditions-settings') as HTMLButtonElement;
    saveBtn.click();

    await vi.waitFor(() => {
      const errorMsg = document.getElementById('conditions-validation-error');
      expect(errorMsg?.style.display).toBe('');
    });
  });
});
