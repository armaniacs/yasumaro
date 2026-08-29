// @vitest-environment jsdom
/**
 * recordingConditionsSettings.branches.test.ts
 * Focused branch-coverage tests for src/dashboard/recordingConditionsSettings.ts
 * Targets the 28 uncovered branches (77.2% -> ~98%+).
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

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
const chromeI18nMock = vi.fn().mockReturnValue('');
vi.stubGlobal('chrome', {
  i18n: {
    getMessage: chromeI18nMock,
  },
} as any);

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------
import { initRecordingConditionsSettings } from '../recordingConditionsSettings.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function setupDOM(includeContainer = true) {
  if (!includeContainer) {
    document.body.innerHTML = '<div id="other"></div>';
    return;
  }
  // Provide container empty, init will render. Also pre-fill with existing rendered structure
  // for fallback tests we need container to exist.
  document.body.innerHTML = '<div id="recording-conditions-settings"></div>';
}

async function clickSaveAndWait(shouldSucceed = false) {
  const saveBtn = document.getElementById('save-conditions-settings') as HTMLButtonElement;
  expect(saveBtn).not.toBeNull();
  saveBtn.click();
  // allow async handler to run
  await new Promise((r) => setTimeout(r, 0));
  await vi.waitFor(() => {
    // whichever message appears, ensure handler completed; check that mockSetAll or error visible
  }, { timeout: 200 }).catch(() => {});
  // flush microtasks
  await new Promise((r) => setTimeout(r, 10));
}

describe('recordingConditionsSettings branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chromeI18nMock.mockReturnValue('');
    mockGetAll.mockResolvedValue({});
    mockGetMany.mockResolvedValue({});
    mockSetAll.mockResolvedValue(undefined);
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('early return when container missing (branch 1)', async () => {
    setupDOM(false);
    mockGetMany.mockClear();
    await initRecordingConditionsSettings();
    // should not throw and should not have rendered container
    expect(document.getElementById('recording-conditions-settings')).toBeNull();
    // getMany should not be called because we returned early
    expect(mockGetMany).not.toHaveBeenCalled();
  });

  it('loadConditionsSettings catch fallback when getMany rejects', async () => {
    setupDOM(true);
    mockGetMany.mockRejectedValue(new Error('fail'));
    await initRecordingConditionsSettings();
    // Should render defaults after catch
    const minVisit = document.getElementById('minVisitDuration') as HTMLInputElement;
    expect(minVisit.value).toBe('5');
    const minScroll = document.getElementById('minScrollDepth') as HTMLInputElement;
    expect(minScroll.value).toBe('50');
    const maxTokens = document.getElementById('maxTokensPerPrompt') as HTMLInputElement;
    expect(maxTokens.value).toBe('1000');
    // aiTimeout 0 renders empty string
    const aiTimeout = document.getElementById('aiTimeoutSeconds') as HTMLInputElement;
    expect(aiTimeout.value).toBe('');
  });

  it('covers aiTimeoutMs >0 true branch and parsing with value', async () => {
    setupDOM(true);
    mockGetMany.mockResolvedValue({
      minVisitDuration: 5,
      minScrollDepth: 50,
      maxTokensPerPrompt: 1000,
      aiTimeoutMs: 45000,
      maxMonthlyTokens: 1000000,
      aiRateLimitMax: 10,
      openaiContentChars: 10000,
      geminiContentChars: 30000,
    });
    await initRecordingConditionsSettings();
    const aiTimeout = document.getElementById('aiTimeoutSeconds') as HTMLInputElement;
    // 45000 -> 45 seconds rounded
    expect(aiTimeout.value).toBe('45');

    // Now test save with aiTimeout >0 (covers cond-expr at line 225 true branch)
    aiTimeout.value = '30';
    mockSetAll.mockResolvedValue(undefined);
    const saveBtn = document.getElementById('save-conditions-settings') as HTMLButtonElement;
    saveBtn.click();
    await vi.waitFor(() => expect(mockSetAll).toHaveBeenCalled());
    expect(mockSetAll).toHaveBeenCalledWith(expect.objectContaining({ aiTimeoutMs: 30000 }));
  });

  it('covers save with aiTimeout empty (false branch at line 225)', async () => {
    setupDOM(true);
    mockGetMany.mockResolvedValue({});
    await initRecordingConditionsSettings();
    const aiTimeout = document.getElementById('aiTimeoutSeconds') as HTMLInputElement;
    aiTimeout.value = '';
    mockSetAll.mockResolvedValue(undefined);
    const saveBtn = document.getElementById('save-conditions-settings') as HTMLButtonElement;
    saveBtn.click();
    await vi.waitFor(() => expect(mockSetAll).toHaveBeenCalled());
    // last call should have aiTimeoutMs 0
    expect(mockSetAll).toHaveBeenCalledWith(expect.objectContaining({ aiTimeoutMs: 0 }));
  });

  // -------------------------------------------------------------------------
  // Fallback binary-expr branches: missing inputs (|| fallback, ?? fallback)
  // Each covers one uncovered branch (lines 160-167)
  // -------------------------------------------------------------------------
  it('covers fallback when minVisitInput missing (|| fallback)', async () => {
    setupDOM(true);
    mockGetMany.mockResolvedValue({});
    await initRecordingConditionsSettings();
    // Remove minVisitDuration input to trigger fallback
    document.getElementById('minVisitDuration')?.remove();
    // Need other inputs valid
    (document.getElementById('minScrollDepth') as HTMLInputElement).value = '50';
    (document.getElementById('maxTokensPerPrompt') as HTMLInputElement).value = '1000';
    (document.getElementById('aiTimeoutSeconds') as HTMLInputElement).value = '';
    (document.getElementById('maxMonthlyTokens') as HTMLInputElement).value = '1000';
    (document.getElementById('aiRateLimitMax') as HTMLInputElement).value = '10';
    (document.getElementById('openaiContentChars') as HTMLInputElement).value = '10000';
    (document.getElementById('geminiContentChars') as HTMLInputElement).value = '30000';
    mockSetAll.mockResolvedValue(undefined);
    const saveBtn = document.getElementById('save-conditions-settings') as HTMLButtonElement;
    saveBtn.click();
    await vi.waitFor(() => expect(mockSetAll).toHaveBeenCalled());
    expect(mockSetAll).toHaveBeenCalledWith(expect.objectContaining({ minVisitDuration: 5 }));
  });

  it('covers fallback when minScrollInput empty (|| fallback)', async () => {
    setupDOM(true);
    mockGetMany.mockResolvedValue({});
    await initRecordingConditionsSettings();
    (document.getElementById('minVisitDuration') as HTMLInputElement).value = '5';
    const minScroll = document.getElementById('minScrollDepth') as HTMLInputElement;
    minScroll.value = ''; // empty triggers fallback '50'
    (document.getElementById('maxTokensPerPrompt') as HTMLInputElement).value = '1000';
    (document.getElementById('maxMonthlyTokens') as HTMLInputElement).value = '1000';
    (document.getElementById('aiRateLimitMax') as HTMLInputElement).value = '10';
    (document.getElementById('openaiContentChars') as HTMLInputElement).value = '10000';
    (document.getElementById('geminiContentChars') as HTMLInputElement).value = '30000';
    mockSetAll.mockResolvedValue(undefined);
    const saveBtn = document.getElementById('save-conditions-settings') as HTMLButtonElement;
    saveBtn.click();
    await vi.waitFor(() => expect(mockSetAll).toHaveBeenCalled());
    expect(mockSetAll).toHaveBeenCalledWith(expect.objectContaining({ minScrollDepth: 50 }));
  });

  it('covers fallback when maxTokensInput missing', async () => {
    setupDOM(true);
    mockGetMany.mockResolvedValue({});
    await initRecordingConditionsSettings();
    document.getElementById('maxTokensPerPrompt')?.remove();
    (document.getElementById('minVisitDuration') as HTMLInputElement).value = '5';
    (document.getElementById('minScrollDepth') as HTMLInputElement).value = '50';
    (document.getElementById('maxMonthlyTokens') as HTMLInputElement).value = '1000';
    (document.getElementById('aiRateLimitMax') as HTMLInputElement).value = '10';
    (document.getElementById('openaiContentChars') as HTMLInputElement).value = '10000';
    (document.getElementById('geminiContentChars') as HTMLInputElement).value = '30000';
    mockSetAll.mockResolvedValue(undefined);
    const saveBtn = document.getElementById('save-conditions-settings') as HTMLButtonElement;
    saveBtn.click();
    await vi.waitFor(() => expect(mockSetAll).toHaveBeenCalled());
    expect(mockSetAll).toHaveBeenCalledWith(expect.objectContaining({ maxTokensPerPrompt: 1000 }));
  });

  it('covers aiTimeoutInput truthy branch (cond-expr true at line 163)', async () => {
    setupDOM(true);
    mockGetMany.mockResolvedValue({});
    await initRecordingConditionsSettings();
    (document.getElementById('aiTimeoutSeconds') as HTMLInputElement).value = '60';
    (document.getElementById('minVisitDuration') as HTMLInputElement).value = '5';
    (document.getElementById('minScrollDepth') as HTMLInputElement).value = '50';
    (document.getElementById('maxTokensPerPrompt') as HTMLInputElement).value = '1000';
    (document.getElementById('maxMonthlyTokens') as HTMLInputElement).value = '1000';
    (document.getElementById('aiRateLimitMax') as HTMLInputElement).value = '10';
    (document.getElementById('openaiContentChars') as HTMLInputElement).value = '10000';
    (document.getElementById('geminiContentChars') as HTMLInputElement).value = '30000';
    mockSetAll.mockResolvedValue(undefined);
    const saveBtn = document.getElementById('save-conditions-settings') as HTMLButtonElement;
    saveBtn.click();
    await vi.waitFor(() => expect(mockSetAll).toHaveBeenCalled());
    expect(mockSetAll).toHaveBeenCalledWith(expect.objectContaining({ aiTimeoutMs: 60000 }));
  });

  it('covers ?? fallback when maxMonthlyTokensInput missing', async () => {
    setupDOM(true);
    mockGetMany.mockResolvedValue({});
    await initRecordingConditionsSettings();
    document.getElementById('maxMonthlyTokens')?.remove();
    (document.getElementById('minVisitDuration') as HTMLInputElement).value = '5';
    (document.getElementById('minScrollDepth') as HTMLInputElement).value = '50';
    (document.getElementById('maxTokensPerPrompt') as HTMLInputElement).value = '1000';
    (document.getElementById('aiRateLimitMax') as HTMLInputElement).value = '10';
    (document.getElementById('openaiContentChars') as HTMLInputElement).value = '10000';
    (document.getElementById('geminiContentChars') as HTMLInputElement).value = '30000';
    mockSetAll.mockResolvedValue(undefined);
    const saveBtn = document.getElementById('save-conditions-settings') as HTMLButtonElement;
    saveBtn.click();
    await vi.waitFor(() => expect(mockSetAll).toHaveBeenCalled());
    expect(mockSetAll).toHaveBeenCalledWith(expect.objectContaining({ maxMonthlyTokens: 1000000 }));
  });

  it('covers ?? fallback when aiRateLimitMax missing', async () => {
    setupDOM(true);
    mockGetMany.mockResolvedValue({});
    await initRecordingConditionsSettings();
    document.getElementById('aiRateLimitMax')?.remove();
    (document.getElementById('minVisitDuration') as HTMLInputElement).value = '5';
    (document.getElementById('minScrollDepth') as HTMLInputElement).value = '50';
    (document.getElementById('maxTokensPerPrompt') as HTMLInputElement).value = '1000';
    (document.getElementById('maxMonthlyTokens') as HTMLInputElement).value = '1000';
    (document.getElementById('openaiContentChars') as HTMLInputElement).value = '10000';
    (document.getElementById('geminiContentChars') as HTMLInputElement).value = '30000';
    mockSetAll.mockResolvedValue(undefined);
    const saveBtn = document.getElementById('save-conditions-settings') as HTMLButtonElement;
    saveBtn.click();
    await vi.waitFor(() => expect(mockSetAll).toHaveBeenCalled());
    expect(mockSetAll).toHaveBeenCalledWith(expect.objectContaining({ aiRateLimitMax: 10 }));
  });

  it('covers ?? fallback when openaiContentChars missing', async () => {
    setupDOM(true);
    mockGetMany.mockResolvedValue({});
    await initRecordingConditionsSettings();
    document.getElementById('openaiContentChars')?.remove();
    (document.getElementById('minVisitDuration') as HTMLInputElement).value = '5';
    (document.getElementById('minScrollDepth') as HTMLInputElement).value = '50';
    (document.getElementById('maxTokensPerPrompt') as HTMLInputElement).value = '1000';
    (document.getElementById('maxMonthlyTokens') as HTMLInputElement).value = '1000';
    (document.getElementById('aiRateLimitMax') as HTMLInputElement).value = '10';
    (document.getElementById('geminiContentChars') as HTMLInputElement).value = '30000';
    mockSetAll.mockResolvedValue(undefined);
    const saveBtn = document.getElementById('save-conditions-settings') as HTMLButtonElement;
    saveBtn.click();
    await vi.waitFor(() => expect(mockSetAll).toHaveBeenCalled());
    expect(mockSetAll).toHaveBeenCalledWith(expect.objectContaining({ openaiContentChars: 10000 }));
  });

  it('covers ?? fallback when geminiContentChars missing', async () => {
    setupDOM(true);
    mockGetMany.mockResolvedValue({});
    await initRecordingConditionsSettings();
    document.getElementById('geminiContentChars')?.remove();
    (document.getElementById('minVisitDuration') as HTMLInputElement).value = '5';
    (document.getElementById('minScrollDepth') as HTMLInputElement).value = '50';
    (document.getElementById('maxTokensPerPrompt') as HTMLInputElement).value = '1000';
    (document.getElementById('maxMonthlyTokens') as HTMLInputElement).value = '1000';
    (document.getElementById('aiRateLimitMax') as HTMLInputElement).value = '10';
    (document.getElementById('openaiContentChars') as HTMLInputElement).value = '10000';
    mockSetAll.mockResolvedValue(undefined);
    const saveBtn = document.getElementById('save-conditions-settings') as HTMLButtonElement;
    saveBtn.click();
    await vi.waitFor(() => expect(mockSetAll).toHaveBeenCalled());
    expect(mockSetAll).toHaveBeenCalledWith(expect.objectContaining({ geminiContentChars: 30000 }));
  });

  // -------------------------------------------------------------------------
  // Validation branches (lines 176, 183, 190, 197, 204, 211)
  // Each block has an if + binary-expr for getMessage fallback.
  // We hit invalid cases with getMessage returning '' (fallback) and truthy.
  // -------------------------------------------------------------------------
  async function triggerValidation(invalidSetup: () => void) {
    setupDOM(true);
    mockGetMany.mockResolvedValue({});
    await initRecordingConditionsSettings();
    // set all to valid first
    (document.getElementById('minVisitDuration') as HTMLInputElement).value = '5';
    (document.getElementById('minScrollDepth') as HTMLInputElement).value = '50';
    (document.getElementById('maxTokensPerPrompt') as HTMLInputElement).value = '1000';
    (document.getElementById('aiTimeoutSeconds') as HTMLInputElement).value = '';
    (document.getElementById('maxMonthlyTokens') as HTMLInputElement).value = '1000';
    (document.getElementById('aiRateLimitMax') as HTMLInputElement).value = '10';
    (document.getElementById('openaiContentChars') as HTMLInputElement).value = '10000';
    (document.getElementById('geminiContentChars') as HTMLInputElement).value = '30000';
    invalidSetup();
    const saveBtn = document.getElementById('save-conditions-settings') as HTMLButtonElement;
    saveBtn.click();
    await new Promise((r) => setTimeout(r, 10));
  }

  it('validation: minScrollDepth invalid with fallback message (|| fallback)', async () => {
    chromeI18nMock.mockReturnValue(''); // ensures fallback branch
    await triggerValidation(() => {
      (document.getElementById('minScrollDepth') as HTMLInputElement).value = '-1';
    });
    const err = document.getElementById('conditions-validation-error') as HTMLElement;
    expect(err.style.display).toBe('');
    expect(err.textContent).toContain('Min scroll depth');
    expect(mockSetAll).not.toHaveBeenCalled();
  });

  it('validation: minScrollDepth invalid with translated message (truthy branch)', async () => {
    chromeI18nMock.mockImplementation((key: string) => (key === 'minScrollDepthError' ? 'translated scroll error' : ''));
    await triggerValidation(() => {
      (document.getElementById('minScrollDepth') as HTMLInputElement).value = '101';
    });
    const err = document.getElementById('conditions-validation-error') as HTMLElement;
    expect(err.style.display).toBe('');
    expect(err.textContent).toBe('translated scroll error');
    expect(mockSetAll).not.toHaveBeenCalled();
  });

  it('validation: maxTokens invalid (low)', async () => {
    chromeI18nMock.mockReturnValue('');
    await triggerValidation(() => {
      (document.getElementById('maxTokensPerPrompt') as HTMLInputElement).value = '5';
    });
    const err = document.getElementById('conditions-validation-error') as HTMLElement;
    expect(err.style.display).toBe('');
    expect(mockSetAll).not.toHaveBeenCalled();
  });

  it('validation: maxTokens invalid with translated message (high)', async () => {
    chromeI18nMock.mockImplementation((key: string) => (key === 'maxTokensError' ? 'translated maxTokens' : ''));
    await triggerValidation(() => {
      (document.getElementById('maxTokensPerPrompt') as HTMLInputElement).value = '20000';
    });
    const err = document.getElementById('conditions-validation-error') as HTMLElement;
    expect(err.textContent).toBe('translated maxTokens');
    expect(mockSetAll).not.toHaveBeenCalled();
  });

  it('validation: maxTokens NaN (non-numeric)', async () => {
    chromeI18nMock.mockReturnValue('');
    await triggerValidation(() => {
      const el = document.getElementById('maxTokensPerPrompt') as HTMLInputElement;
      Object.defineProperty(el, 'value', { value: 'abc', writable: true, configurable: true });
    });
    const err = document.getElementById('conditions-validation-error') as HTMLElement;
    expect(err.style.display).toBe('');
    expect(mockSetAll).not.toHaveBeenCalled();
  });

  it('validation: maxMonthlyTokens invalid negative', async () => {
    chromeI18nMock.mockReturnValue('');
    await triggerValidation(() => {
      (document.getElementById('maxMonthlyTokens') as HTMLInputElement).value = '-5';
    });
    const err = document.getElementById('conditions-validation-error') as HTMLElement;
    expect(err.style.display).toBe('');
    expect(mockSetAll).not.toHaveBeenCalled();
  });

  it('validation: maxMonthlyTokens invalid with translated message', async () => {
    chromeI18nMock.mockImplementation((key: string) => (key === 'maxMonthlyTokensError' ? 'translated monthly' : ''));
    await triggerValidation(() => {
      (document.getElementById('maxMonthlyTokens') as HTMLInputElement).value = 'abc';
    });
    const err = document.getElementById('conditions-validation-error') as HTMLElement;
    expect(err.textContent).toBe('translated monthly');
  });

  it('validation: aiRateLimitMax invalid low', async () => {
    chromeI18nMock.mockReturnValue('');
    await triggerValidation(() => {
      (document.getElementById('aiRateLimitMax') as HTMLInputElement).value = '0';
    });
    const err = document.getElementById('conditions-validation-error') as HTMLElement;
    expect(err.style.display).toBe('');
    expect(mockSetAll).not.toHaveBeenCalled();
  });

  it('validation: aiRateLimitMax invalid high with translated message', async () => {
    chromeI18nMock.mockImplementation((key: string) => (key === 'aiRateLimitMaxError' ? 'translated rate' : ''));
    await triggerValidation(() => {
      (document.getElementById('aiRateLimitMax') as HTMLInputElement).value = '100';
    });
    const err = document.getElementById('conditions-validation-error') as HTMLElement;
    expect(err.textContent).toBe('translated rate');
  });

  it('validation: aiRateLimitMax NaN', async () => {
    chromeI18nMock.mockReturnValue('');
    await triggerValidation(() => {
      (document.getElementById('aiRateLimitMax') as HTMLInputElement).value = '';
    });
    // empty => parseInt '' => NaN? Actually '' ?? '10' but for this field it uses ??, so '' parseInt '' = NaN => triggers.
    // However note: aiRateLimitMax uses ?? '10', not ||, so empty string '' is not nullish, parseInt('',10)=NaN -> validation fails
    const err = document.getElementById('conditions-validation-error') as HTMLElement;
    expect(err.style.display).toBe('');
  });

  it('validation: openaiContentChars invalid low', async () => {
    chromeI18nMock.mockReturnValue('');
    await triggerValidation(() => {
      (document.getElementById('openaiContentChars') as HTMLInputElement).value = '500';
    });
    const err = document.getElementById('conditions-validation-error') as HTMLElement;
    expect(err.style.display).toBe('');
    expect(mockSetAll).not.toHaveBeenCalled();
  });

  it('validation: openaiContentChars invalid with translated message', async () => {
    chromeI18nMock.mockImplementation((key: string) => (key === 'openaiContentCharsError' ? 'translated openai' : ''));
    await triggerValidation(() => {
      (document.getElementById('openaiContentChars') as HTMLInputElement).value = '200000';
    });
    const err = document.getElementById('conditions-validation-error') as HTMLElement;
    expect(err.textContent).toBe('translated openai');
  });

  it('validation: geminiContentChars invalid low', async () => {
    chromeI18nMock.mockReturnValue('');
    await triggerValidation(() => {
      (document.getElementById('geminiContentChars') as HTMLInputElement).value = '999';
    });
    const err = document.getElementById('conditions-validation-error') as HTMLElement;
    expect(err.style.display).toBe('');
  });

  it('validation: geminiContentChars invalid with translated message', async () => {
    chromeI18nMock.mockImplementation((key: string) => (key === 'geminiContentCharsError' ? 'translated gemini' : ''));
    await triggerValidation(() => {
      (document.getElementById('geminiContentChars') as HTMLInputElement).value = '999999';
    });
    const err = document.getElementById('conditions-validation-error') as HTMLElement;
    expect(err.textContent).toBe('translated gemini');
  });

  it('validation: minVisitDuration NaN and fallback message', async () => {
    // For type=number inputs, setting 'abc' is sanitized to '' and then falls back to '5' (valid).
    // To exercise the isNaN branch we must bypass sanitization via defineProperty.
    chromeI18nMock.mockImplementation((key: string) => (key === 'minVisitDurationError' ? 'translated minVisit' : ''));
    await triggerValidation(() => {
      const el = document.getElementById('minVisitDuration') as HTMLInputElement;
      Object.defineProperty(el, 'value', { value: 'abc', writable: true, configurable: true });
    });
    const err = document.getElementById('conditions-validation-error') as HTMLElement;
    expect(err.textContent).toBe('translated minVisit');
  });

  it('covers errorMessage with non-Error throw (string) and error fallback', async () => {
    setupDOM(true);
    mockGetMany.mockResolvedValue({});
    await initRecordingConditionsSettings();
    // set valid values
    (document.getElementById('minVisitDuration') as HTMLInputElement).value = '5';
    (document.getElementById('minScrollDepth') as HTMLInputElement).value = '50';
    (document.getElementById('maxTokensPerPrompt') as HTMLInputElement).value = '1000';
    (document.getElementById('maxMonthlyTokens') as HTMLInputElement).value = '1000';
    (document.getElementById('aiRateLimitMax') as HTMLInputElement).value = '10';
    (document.getElementById('openaiContentChars') as HTMLInputElement).value = '10000';
    (document.getElementById('geminiContentChars') as HTMLInputElement).value = '30000';
    chromeI18nMock.mockImplementation((key: string) => {
      if (key === 'error') return 'ERR';
      return '';
    });
    mockSetAll.mockRejectedValue('plain string error');
    const saveBtn = document.getElementById('save-conditions-settings') as HTMLButtonElement;
    saveBtn.click();
    await vi.waitFor(() => {
      const err = document.getElementById('conditions-validation-error') as HTMLElement;
      expect(err.style.display).toBe('');
    });
    const err = document.getElementById('conditions-validation-error') as HTMLElement;
    expect(err.textContent).toContain('plain string error');
    expect(err.textContent).toContain('ERR');
  });

  it('covers errorMessage with Error and fallback for getMessage error', async () => {
    setupDOM(true);
    mockGetMany.mockResolvedValue({});
    await initRecordingConditionsSettings();
    chromeI18nMock.mockReturnValue(''); // fallback to 'Error'
    mockSetAll.mockRejectedValue(new Error('boom'));
    const saveBtn = document.getElementById('save-conditions-settings') as HTMLButtonElement;
    saveBtn.click();
    await vi.waitFor(() => {
      const err = document.getElementById('conditions-validation-error') as HTMLElement;
      expect(err.style.display).toBe('');
    });
    const err = document.getElementById('conditions-validation-error') as HTMLElement;
    expect(err.textContent).toContain('boom');
    expect(err.textContent).toContain('Error');
  });

  it('covers injected repo seam with getMany throwing (catch)', async () => {
    // use injected repo param directly, not the mocked singleton
    const { StorageKeys } = await import('../../utils/storage/types.js');
    const throwingRepo = {
      getMany: vi.fn().mockRejectedValue(new Error('repo fail')),
      getAll: vi.fn(),
    };
    setupDOM(true);
    await initRecordingConditionsSettings(throwingRepo as any);
    const minVisit = document.getElementById('minVisitDuration') as HTMLInputElement;
    expect(minVisit.value).toBe('5');
    expect(throwingRepo.getMany).toHaveBeenCalled();
  });
});
