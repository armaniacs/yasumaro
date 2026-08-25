// @vitest-environment jsdom
/**
 * recordingConditionsSettings.test.ts
 * Tests for dashboard recording conditions settings panel.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks for storage module
// ---------------------------------------------------------------------------
const { mockGetAll, mockGetMany, mockSetAll } = vi.hoisted(() => ({
  mockGetAll: vi.fn(),
  mockGetMany: vi.fn(),
  mockSetAll: vi.fn(),
}));

vi.mock('../../utils/storage/types.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    StorageKeys: {
      MIN_VISIT_DURATION: 'minVisitDuration',
      MIN_SCROLL_DEPTH: 'minScrollDepth',
      MAX_TOKENS_PER_PROMPT: 'maxTokensPerPrompt',
      AI_TIMEOUT_MS: 'aiTimeoutMs',
      MAX_MONTHLY_TOKENS: 'maxMonthlyTokens',
      AI_RATE_LIMIT_MAX: 'aiRateLimitMax',
      OPENAI_CONTENT_CHARS: 'openaiContentChars',
      GEMINI_CONTENT_CHARS: 'geminiContentChars',
    },
  };
});

vi.mock('../../utils/storage/SettingsRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    settingsRepository: {
      getAll: mockGetAll,
      getMany: mockGetMany,
      setAll: mockSetAll,
      get: vi.fn(),
      set: vi.fn(),
    },
    SettingsRepository: class {
      getAll = mockGetAll;
      getMany = mockGetMany;
      setAll = mockSetAll;
      get = vi.fn();
      set = vi.fn();
    },
  };
});

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
    mockGetAll.mockResolvedValue({});
    mockGetMany.mockResolvedValue({});
  });

  it('loads and renders recording conditions with defaults when no settings exist', async () => {
    mockGetMany.mockResolvedValue({});
    mockGetAll.mockResolvedValue({});
    await initRecordingConditionsSettings();

    const minVisitInput = document.getElementById('minVisitDuration') as HTMLInputElement;
    const minScrollInput = document.getElementById('minScrollDepth') as HTMLInputElement;
    const maxTokensInput = document.getElementById('maxTokensPerPrompt') as HTMLInputElement;

    expect(minVisitInput?.value).toBe('5');
    expect(minScrollInput?.value).toBe('50');
    expect(maxTokensInput?.value).toBe('1000');
  });

  it('loads previously saved values from getSettings', async () => {
    mockGetMany.mockResolvedValue({
      minVisitDuration: 10,
      minScrollDepth: 75,
      maxTokensPerPrompt: 2000,
      aiTimeoutMs: 30000,
      maxMonthlyTokens: 50000,
      aiRateLimitMax: 5,
      openaiContentChars: 15000,
      geminiContentChars: 20000,
    });
    mockGetAll.mockResolvedValue({
      minVisitDuration: 10,
      minScrollDepth: 75,
      maxTokensPerPrompt: 2000,
      aiTimeoutMs: 30000,
      maxMonthlyTokens: 50000,
      aiRateLimitMax: 5,
      openaiContentChars: 15000,
      geminiContentChars: 20000,
    });
    await initRecordingConditionsSettings();

    const minVisitInput = document.getElementById('minVisitDuration') as HTMLInputElement;
    const minScrollInput = document.getElementById('minScrollDepth') as HTMLInputElement;
    const maxTokensInput = document.getElementById('maxTokensPerPrompt') as HTMLInputElement;
    const aiTimeoutInput = document.getElementById('aiTimeoutSeconds') as HTMLInputElement;
    const maxMonthlyTokensInput = document.getElementById('maxMonthlyTokens') as HTMLInputElement;
    const aiRateLimitMaxInput = document.getElementById('aiRateLimitMax') as HTMLInputElement;
    const openaiContentCharsInput = document.getElementById('openaiContentChars') as HTMLInputElement;
    const geminiContentCharsInput = document.getElementById('geminiContentChars') as HTMLInputElement;

    expect(minVisitInput?.value).toBe('10');
    expect(minScrollInput?.value).toBe('75');
    expect(maxTokensInput?.value).toBe('2000');
    expect(aiTimeoutInput?.value).toBe('30');
    expect(maxMonthlyTokensInput?.value).toBe('50000');
    expect(aiRateLimitMaxInput?.value).toBe('5');
    expect(openaiContentCharsInput?.value).toBe('15000');
    expect(geminiContentCharsInput?.value).toBe('20000');
  });

  it('saves recording conditions via saveSettings on save click', async () => {
    mockGetMany.mockResolvedValue({});
    mockGetAll.mockResolvedValue({});
    mockSetAll.mockResolvedValue(undefined);
    await initRecordingConditionsSettings();

    const minVisitInput = document.getElementById('minVisitDuration') as HTMLInputElement;
    const maxTokensInput = document.getElementById('maxTokensPerPrompt') as HTMLInputElement;
    minVisitInput.value = '15';
    maxTokensInput.value = '3000';

    const saveBtn = document.getElementById('save-conditions-settings') as HTMLButtonElement;
    saveBtn.click();

    await vi.waitFor(() => {
      expect(mockSetAll).toHaveBeenCalled();
    });

    expect(mockSetAll).toHaveBeenCalledWith({
      minVisitDuration: 15,
      minScrollDepth: 50,
      maxTokensPerPrompt: 3000,
      aiTimeoutMs: 0,
      maxMonthlyTokens: 1000000,
      aiRateLimitMax: 10,
      openaiContentChars: 10000,
      geminiContentChars: 30000,
    });
  });

  it('shows success message after save', async () => {
    mockGetMany.mockResolvedValue({});
    mockGetAll.mockResolvedValue({});
    mockSetAll.mockResolvedValue(undefined);
    await initRecordingConditionsSettings();

    const saveBtn = document.getElementById('save-conditions-settings') as HTMLButtonElement;
    saveBtn.click();

    await vi.waitFor(() => {
      const successMsg = document.getElementById('conditions-save-success');
      expect(successMsg?.style.display).toBe('');
    });
  });

  it('shows validation error for invalid min visit duration', async () => {
    mockGetMany.mockResolvedValue({});
    mockGetAll.mockResolvedValue({});
    await initRecordingConditionsSettings();

    const minVisitInput = document.getElementById('minVisitDuration') as HTMLInputElement;
    minVisitInput.value = '0';

    const saveBtn = document.getElementById('save-conditions-settings') as HTMLButtonElement;
    saveBtn.click();

    await vi.waitFor(() => {
      const errorMsg = document.getElementById('conditions-validation-error');
      expect(errorMsg?.style.display).toBe('');
    });

    expect(mockSetAll).not.toHaveBeenCalled();
  });

  it('handles saveSettings error gracefully', async () => {
    mockGetMany.mockResolvedValue({});
    mockGetAll.mockResolvedValue({});
    mockSetAll.mockRejectedValue(new Error('Storage full'));
    await initRecordingConditionsSettings();

    const saveBtn = document.getElementById('save-conditions-settings') as HTMLButtonElement;
    saveBtn.click();

    await vi.waitFor(() => {
      const errorMsg = document.getElementById('conditions-validation-error');
      expect(errorMsg?.style.display).toBe('');
    });
  });
});
