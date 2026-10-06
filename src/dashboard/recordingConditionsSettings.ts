/**
 * recordingConditionsSettings.ts
 * Dashboard settings panel for recording conditions configuration.
 * Note: Recording triggers (scroll/time/snapshot) are no longer configurable.
 *
 * WHY a factory: the eight form-value fields were module-level `let`s that
 * survived every test in a file, and the panel had no teardown path, so a test
 * reusing one document read the previous mount's values. The state now lives in
 * the instance returned by createRecordingConditionsSettings() and `destroy()`
 * releases the element references and the listeners. The module-level functions
 * below stay for existing callers and delegate to one default instance.
 */

import { StorageKeys } from '../utils/storage/types.js';
import { DEFAULT_MIN_SCROLL_DEPTH, DEFAULT_MIN_VISIT_DURATION } from '../utils/visitThresholds.js';
import { settingsRepository, type SettingsReader } from '../utils/storage/SettingsRepository.js';
import { errorMessage } from '../utils/errorUtils.js';
import { setElementHtml } from '../utils/htmlFragment.js';
import { getMessageOr } from '../utils/i18n.js';
import { applyI18n } from '../utils/i18n-dom.js';
import { clearFieldError, setFieldError } from './settings/fieldValidation.js';
import {
  validateMaxTokensValue,
  validateMinScrollDepthValue,
  validateMinVisitDurationValue,
} from './settings/fieldDescriptor.js';

interface RecordingConditionsDom {
  container: HTMLElement;
  saveBtn: HTMLButtonElement;
  validationError: HTMLElement;
  successMsg: HTMLElement;
}

export interface RecordingConditionsSettingsController {
  /**
   * (Re-)mount the panel: load persisted values, render the form, wire it up.
   * @param repo Reader to load from; the production singleton by default.
   */
  init(repo?: SettingsReader): Promise<void>;
  /**
   * Detach every listener init() attached and drop every element reference and
   * form value. A later init() re-resolves from the document, so a re-mount
   * after destroy() starts from the persisted values again.
   */
  destroy(): void;
}

export function createRecordingConditionsSettings(): RecordingConditionsSettingsController {
  // ============================================================================
  // Instance state
  // ============================================================================

  let minVisitDuration = 5;
  let minScrollDepth = 50;
  let maxTokensPerPrompt = 1000;
  let aiTimeoutSeconds = 0; // 0 = auto
  let maxMonthlyTokens = 1000000;
  let aiRateLimitMax = 10;
  let openaiContentChars = 10000;
  let geminiContentChars = 30000;

  /** Null until init() resolves it; destroy() and the handlers both key off it. */
  let dom: RecordingConditionsDom | null = null;
  /** Removers for every listener init() attached, in attach order. */
  const teardown: Array<() => void> = [];

  /** The values a reader that threw, or a torn-down instance, falls back to. */
  function resetToDefaults(): void {
    minVisitDuration = 5;
    minScrollDepth = 50;
    maxTokensPerPrompt = 1000;
    aiTimeoutSeconds = 0;
    maxMonthlyTokens = 1000000;
    aiRateLimitMax = 10;
    openaiContentChars = 10000;
    geminiContentChars = 30000;
  }

  /** Attach a listener and record how to undo it, so destroy() is complete. */
  function listen(target: EventTarget | null | undefined, type: string, handler: EventListenerOrEventListenerObject): void {
    if (!target) return;
    target.addEventListener(type, handler);
    teardown.push(() => target.removeEventListener(type, handler));
  }

  async function loadConditionsSettings(repo: SettingsReader): Promise<void> {
    try {
      const settings = await repo.getMany([
        StorageKeys.MIN_VISIT_DURATION,
        StorageKeys.MIN_SCROLL_DEPTH,
        StorageKeys.MAX_TOKENS_PER_PROMPT,
        StorageKeys.AI_TIMEOUT_MS,
        StorageKeys.MAX_MONTHLY_TOKENS,
        StorageKeys.AI_RATE_LIMIT_MAX,
        StorageKeys.OPENAI_CONTENT_CHARS,
        StorageKeys.GEMINI_CONTENT_CHARS,
      ]);
      minVisitDuration = settings[StorageKeys.MIN_VISIT_DURATION] ?? DEFAULT_MIN_VISIT_DURATION;
      minScrollDepth = settings[StorageKeys.MIN_SCROLL_DEPTH] ?? DEFAULT_MIN_SCROLL_DEPTH;
      maxTokensPerPrompt = settings[StorageKeys.MAX_TOKENS_PER_PROMPT] ?? 1000;
      const aiTimeoutMs = settings[StorageKeys.AI_TIMEOUT_MS] ?? 0;
      aiTimeoutSeconds = aiTimeoutMs > 0 ? Math.round(aiTimeoutMs / 1000) : 0;
      maxMonthlyTokens = settings[StorageKeys.MAX_MONTHLY_TOKENS] ?? 1000000;
      aiRateLimitMax = settings[StorageKeys.AI_RATE_LIMIT_MAX] ?? 10;
      openaiContentChars = settings[StorageKeys.OPENAI_CONTENT_CHARS] ?? 10000;
      geminiContentChars = settings[StorageKeys.GEMINI_CONTENT_CHARS] ?? 30000;
    } catch {
      resetToDefaults();
    }
  }

  function renderSettings(container: HTMLElement): void {
    setElementHtml(container, `
    <div class="settings-section">
      <h3 class="settings-section-title">${getMessageOr('recordingSection', '記録条件')}</h3>

      <div class="form-group">
        <label for="rc-minVisitDuration">${getMessageOr('minVisitDuration', 'Min Visit Duration (seconds)')}</label>
        <input type="number" id="rc-minVisitDuration" min="1" value="${minVisitDuration}" aria-invalid="false"
          aria-describedby="rc-minVisitDurationError">
        <div id="rc-minVisitDurationError" class="field-error" role="alert"></div>
      </div>

      <div class="form-group">
        <label for="rc-minScrollDepth">${getMessageOr('minScrollDepth', 'Min Scroll Depth (%)')}</label>
        <input type="number" id="rc-minScrollDepth" min="0" max="100" value="${minScrollDepth}" aria-invalid="false"
          aria-describedby="rc-minScrollDepthError">
        <div id="rc-minScrollDepthError" class="field-error" role="alert"></div>
      </div>

      <div class="form-group">
        <label for="rc-maxTokensPerPrompt">${getMessageOr('label_max_tokens', 'Max Tokens Per Prompt')}</label>
        <input type="number" id="rc-maxTokensPerPrompt" min="10" max="16000" step="100" value="${maxTokensPerPrompt}" aria-invalid="false"
          aria-describedby="rc-maxTokensError rc-maxTokensNote">
        <p class="help-text" id="rc-maxTokensNote">${getMessageOr('note_max_tokens_cost_control', '')}</p>
        <div id="rc-maxTokensError" class="field-error" role="alert"></div>
      </div>

      <div class="form-group">
        <label for="aiTimeoutSeconds">${getMessageOr('label_ai_timeout', 'AI Timeout (seconds)')}</label>
        <input type="number" id="aiTimeoutSeconds" min="10" max="600" step="10" value="${aiTimeoutSeconds || ''}" aria-invalid="false"
          aria-describedby="aiTimeoutNote" placeholder="auto">
        <p class="help-text" id="aiTimeoutNote">${getMessageOr('note_ai_timeout', '')}</p>
      </div>

      <h3 class="settings-section-title">${getMessageOr('aiUsageControlsSection', 'AI 使用量制限')}</h3>

      <div class="form-group">
        <label for="maxMonthlyTokens">${getMessageOr('label_max_monthly_tokens', 'Monthly Token Limit (0 = unlimited)')}</label>
        <input type="number" id="maxMonthlyTokens" min="0" step="1000" value="${maxMonthlyTokens}" aria-invalid="false"
          aria-describedby="maxMonthlyTokensNote">
        <p class="help-text" id="maxMonthlyTokensNote">${getMessageOr('note_max_monthly_tokens', '0 を指定すると無制限になります。')}</p>
      </div>

      <div class="form-group">
        <label for="aiRateLimitMax">${getMessageOr('label_ai_rate_limit_max', 'AI Rate Limit (requests/min)')}</label>
        <input type="number" id="aiRateLimitMax" min="1" max="60" step="1" value="${aiRateLimitMax}" aria-invalid="false"
          aria-describedby="aiRateLimitMaxNote">
        <p class="help-text" id="aiRateLimitMaxNote">${getMessageOr('note_ai_rate_limit_max', '1 分間に許可する AI リクエスト数です。')}</p>
      </div>

      <div class="form-group">
        <label for="openaiContentChars">${getMessageOr('label_openai_content_chars', 'OpenAI Max Content Characters')}</label>
        <input type="number" id="openaiContentChars" min="1000" max="100000" step="1000" value="${openaiContentChars}" aria-invalid="false">
      </div>

      <div class="form-group">
        <label for="geminiContentChars">${getMessageOr('label_gemini_content_chars', 'Gemini Max Content Characters')}</label>
        <input type="number" id="geminiContentChars" min="1000" max="100000" step="1000" value="${geminiContentChars}" aria-invalid="false">
      </div>
    </div>

    <div class="form-actions">
      <button id="save-conditions-settings" class="btn-primary">${getMessageOr('save', 'Save')}</button>
      <span id="conditions-validation-error" class="validation-error hidden" role="alert"></span>
      <span id="conditions-save-success" class="save-success hidden" aria-live="polite">${getMessageOr('settingsSaved', 'Settings saved.')}</span>
    </div>
  `);
  }

  function wireEvents(container: HTMLElement): void {
    // The form is rebuilt on every init, so these come from the render just
    // above rather than from a document-wide lookup.
    const saveBtn = container.querySelector('#save-conditions-settings') as HTMLButtonElement;
    const validationError = container.querySelector('#conditions-validation-error') as HTMLElement;
    const successMsg = container.querySelector('#conditions-save-success') as HTMLElement;
    dom = { container, saveBtn, validationError, successMsg };

    listen(saveBtn, 'click', async () => {
      // A torn-down instance must not keep writing into the nodes it captured.
      if (!dom) return;
      const { container: root, validationError: errorEl, successMsg: successEl } = dom;

      errorEl.classList.add('hidden');
      errorEl.style.display = 'none';
      successEl.classList.add('hidden');
      successEl.style.display = 'none';

      // Validate recording conditions through the fieldDescriptor SSOT so both
      // screens share one accept/reject decision. Lookups stay inside `root`
      // (container scope), never the document, so the #panel-general inputs
      // with the unprefixed ids can never steal the resolution.
      const minVisitInput = root.querySelector('#rc-minVisitDuration') as HTMLInputElement;
      const minScrollInput = root.querySelector('#rc-minScrollDepth') as HTMLInputElement;
      const maxTokensInput = root.querySelector('#rc-maxTokensPerPrompt') as HTMLInputElement;
      const aiTimeoutInput = root.querySelector('#aiTimeoutSeconds') as HTMLInputElement;
      const maxMonthlyTokensInput = root.querySelector('#maxMonthlyTokens') as HTMLInputElement;
      const aiRateLimitMaxInput = root.querySelector('#aiRateLimitMax') as HTMLInputElement;
      const openaiContentCharsInput = root.querySelector('#openaiContentChars') as HTMLInputElement;
      const geminiContentCharsInput = root.querySelector('#geminiContentChars') as HTMLInputElement;

      const minVisitVal = parseInt(minVisitInput?.value || '5', 10);
      const minScrollVal = parseInt(minScrollInput?.value || '50', 10);
      const maxTokensVal = parseInt(maxTokensInput?.value || '1000', 10);
      const aiTimeoutVal = aiTimeoutInput?.value ? parseInt(aiTimeoutInput.value, 10) : 0;
      const maxMonthlyTokensVal = parseInt(maxMonthlyTokensInput?.value ?? '1000000', 10);
      const aiRateLimitMaxVal = parseInt(aiRateLimitMaxInput?.value ?? '10', 10);
      const openaiContentCharsVal = parseInt(openaiContentCharsInput?.value ?? '10000', 10);
      const geminiContentCharsVal = parseInt(geminiContentCharsInput?.value ?? '30000', 10);

      for (const [el, errId] of [
        [minVisitInput, 'rc-minVisitDurationError'],
        [minScrollInput, 'rc-minScrollDepthError'],
        [maxTokensInput, 'rc-maxTokensError'],
      ] as Array<[HTMLInputElement | null, string]>) {
        if (el) clearFieldError(el, errId, root);
      }

      if (validateMinVisitDurationValue(minVisitVal) !== null) {
        const message = getMessageOr('minVisitDurationError', 'Min visit duration must be at least 1 second.');
        errorEl.textContent = message;
        errorEl.classList.remove('hidden');
        errorEl.style.display = '';
        if (minVisitInput) setFieldError(minVisitInput, 'rc-minVisitDurationError', message, root);
        return;
      }

      if (validateMinScrollDepthValue(minScrollVal) !== null) {
        const message = getMessageOr('minScrollDepthError', 'Min scroll depth must be between 0 and 100.');
        errorEl.textContent = message;
        errorEl.classList.remove('hidden');
        errorEl.style.display = '';
        if (minScrollInput) setFieldError(minScrollInput, 'rc-minScrollDepthError', message, root);
        return;
      }

      if (validateMaxTokensValue(maxTokensVal) !== null) {
        const message = getMessageOr('maxTokensError', 'Max tokens must be between 10 and 16000.');
        errorEl.textContent = message;
        errorEl.classList.remove('hidden');
        errorEl.style.display = '';
        if (maxTokensInput) setFieldError(maxTokensInput, 'rc-maxTokensError', message, root);
        return;
      }

      if (isNaN(maxMonthlyTokensVal) || maxMonthlyTokensVal < 0) {
        errorEl.textContent = getMessageOr('maxMonthlyTokensError', 'Monthly token limit must be 0 or greater.');
        errorEl.classList.remove('hidden');
        errorEl.style.display = '';
        return;
      }

      if (isNaN(aiRateLimitMaxVal) || aiRateLimitMaxVal < 1 || aiRateLimitMaxVal > 60) {
        errorEl.textContent = getMessageOr('aiRateLimitMaxError', 'AI rate limit must be between 1 and 60.');
        errorEl.classList.remove('hidden');
        errorEl.style.display = '';
        return;
      }

      if (isNaN(openaiContentCharsVal) || openaiContentCharsVal < 1000 || openaiContentCharsVal > 100000) {
        errorEl.textContent = getMessageOr('openaiContentCharsError', 'OpenAI content characters must be between 1000 and 100000.');
        errorEl.classList.remove('hidden');
        errorEl.style.display = '';
        return;
      }

      if (isNaN(geminiContentCharsVal) || geminiContentCharsVal < 1000 || geminiContentCharsVal > 100000) {
        errorEl.textContent = getMessageOr('geminiContentCharsError', 'Gemini content characters must be between 1000 and 100000.');
        errorEl.classList.remove('hidden');
        errorEl.style.display = '';
        return;
      }

      try {
        // Save recording conditions via SettingsRepository so values are written
        // to the 'settings' object, matching what getAll reads.
        await settingsRepository.setAll({
          [StorageKeys.MIN_VISIT_DURATION]: minVisitVal,
          [StorageKeys.MIN_SCROLL_DEPTH]: minScrollVal,
          [StorageKeys.MAX_TOKENS_PER_PROMPT]: maxTokensVal,
          [StorageKeys.AI_TIMEOUT_MS]: aiTimeoutVal > 0 ? aiTimeoutVal * 1000 : 0,
          [StorageKeys.MAX_MONTHLY_TOKENS]: maxMonthlyTokensVal,
          [StorageKeys.AI_RATE_LIMIT_MAX]: aiRateLimitMaxVal,
          [StorageKeys.OPENAI_CONTENT_CHARS]: openaiContentCharsVal,
          [StorageKeys.GEMINI_CONTENT_CHARS]: geminiContentCharsVal,
        });

        minVisitDuration = minVisitVal;
        minScrollDepth = minScrollVal;
        maxTokensPerPrompt = maxTokensVal;
        aiTimeoutSeconds = aiTimeoutVal;
        maxMonthlyTokens = maxMonthlyTokensVal;
        aiRateLimitMax = aiRateLimitMaxVal;
        openaiContentChars = openaiContentCharsVal;
        geminiContentChars = geminiContentCharsVal;

        successEl.classList.remove('hidden');
        successEl.style.display = '';
      } catch (err) {
        errorEl.textContent = `${getMessageOr('error', 'Error')}: ${errorMessage(err)}`;
        errorEl.classList.remove('hidden');
        errorEl.style.display = '';
      }
    });

    // Any field edit invalidates both messages: a leftover「設定を保存しました」
    // after editing reads as saved-when-it-isn't, and a stale error mislabels
    // the current state (stale-message / doubled-text report 2026-09-22).
    listen(container, 'input', () => {
      if (!dom) return;
      const { container: root, validationError: errorEl, successMsg: successEl } = dom;
      errorEl.classList.add('hidden');
      errorEl.style.display = 'none';
      successEl.classList.add('hidden');
      successEl.style.display = 'none';
      for (const [selector, errId] of [
        ['#rc-minVisitDuration', 'rc-minVisitDurationError'],
        ['#rc-minScrollDepth', 'rc-minScrollDepthError'],
        ['#rc-maxTokensPerPrompt', 'rc-maxTokensError'],
      ] as Array<[string, string]>) {
        const el = root.querySelector(selector) as HTMLInputElement | null;
        if (el) clearFieldError(el, errId, root);
      }
    });
  }

  async function init(repo: SettingsReader = settingsRepository): Promise<void> {
    // The container survives a re-render, so a second init without an
    // intervening destroy() would stack another listener on it. Release the
    // previous mount first; init stays the single entry point that owns wiring.
    for (const off of teardown.splice(0)) off();
    dom = null;

    const container = document.getElementById('recording-conditions-settings');
    if (!container) return;

    // Load current settings
    await loadConditionsSettings(repo);

    renderSettings(container);
    wireEvents(container);

    // Apply i18n to dynamically rendered content
    applyI18n(container);
  }

  function destroy(): void {
    for (const off of teardown.splice(0)) off();
    dom = null;
    resetToDefaults();
  }

  return { init, destroy };
}

/**
 * The instance the module-level functions below delegate to. One per page is
 * the whole reason the panel is a singleton today; `createRecordingConditionsSettings`
 * exists so a test (or a second mount) can hold an isolated one instead.
 */
const sharedController = createRecordingConditionsSettings();

export function initRecordingConditionsSettings(repo: SettingsReader = settingsRepository): Promise<void> {
  return sharedController.init(repo);
}

export function destroyRecordingConditionsSettings(): void {
  sharedController.destroy();
}
