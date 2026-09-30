/**
 * masterPassword.ts
 * Master password settings management for the dashboard
 *
 * MasterPasswordController クラスとして実装し、DOM参照と状態を
 * インスタンスプロパティに集約する。テスト容易性を向上させる。
 */

import { getMessage, getMessageOr, getMessageWithSubstitutions } from '../utils/i18n.js';
import { showStatus } from '../utils/ui/settingsUiHelper.js';
import { errorMessage } from '../utils/errorUtils.js';
import {
  verifyMasterPassword,
  isMasterPasswordSet,
  calculatePasswordStrength
} from '../utils/masterPassword.js';
import {
  setMasterPassword as setMasterPasswordService,
  changeMasterPassword as changeMasterPasswordService,
  removeMasterPassword as removeMasterPasswordService,
  ReencryptionAbortedError,
  MasterPasswordAlreadySetError,
  PendingRotationMismatchError,
} from '../utils/storage/encryptionSession.js';
import {
  validateAndSetPasswordErrors,
  validateAndSetMatchErrors,
  buildGetStorageFn,
  updatePasswordStrengthDisplay
} from '../utils/masterPasswordUiCore.js';
import { checkRateLimit, recordFailedAttempt, resetFailedAttempts } from '../utils/rateLimiter.js';
import { focusTrapManager } from '../utils/ui/focusTrap.js';

/**
 * DOM要素の参照を保持するインターフェース。
 * テストで注入可能にする。
 */
export interface MasterPasswordDomRefs {
  masterPasswordEnabled: HTMLInputElement | null;
  masterPasswordOptions: HTMLElement | null;
  masterPasswordWarning: HTMLElement | null;
  setMasterPasswordNowBtn: HTMLButtonElement | null;
  changeMasterPasswordBtn: HTMLButtonElement | null;
  passwordModal: HTMLElement | null;
  passwordModalTitle: HTMLElement | null;
  passwordModalDesc: HTMLElement | null;
  masterPasswordInput: HTMLInputElement | null;
  masterPasswordConfirm: HTMLInputElement | null;
  passwordStrengthError: HTMLElement | null;
  passwordMatchError: HTMLElement | null;
  passwordStrengthBar: HTMLElement | null;
  passwordStrengthText: HTMLElement | null;
  confirmPasswordGroup: HTMLElement | null;
  closePasswordModalBtn: HTMLButtonElement | null;
  cancelPasswordBtn: HTMLButtonElement | null;
  savePasswordBtn: HTMLButtonElement | null;
  passwordAuthModal: HTMLElement | null;
  masterPasswordAuthInput: HTMLInputElement | null;
  passwordAuthError: HTMLElement | null;
  closePasswordAuthModalBtn: HTMLButtonElement | null;
  cancelPasswordAuthBtn: HTMLButtonElement | null;
  submitPasswordAuthBtn: HTMLButtonElement | null;
}

/**
 * デフォルトのDOM参照を解決する。
 */
function resolveDefaultDomRefs(): MasterPasswordDomRefs {
  return {
    masterPasswordEnabled: document.getElementById('masterPasswordEnabled') as HTMLInputElement | null,
    masterPasswordOptions: document.getElementById('masterPasswordOptions') as HTMLElement | null,
    masterPasswordWarning: document.getElementById('masterPasswordWarning') as HTMLElement | null,
    setMasterPasswordNowBtn: document.getElementById('setMasterPasswordNowBtn') as HTMLButtonElement | null,
    changeMasterPasswordBtn: document.getElementById('changeMasterPassword') as HTMLButtonElement | null,
    passwordModal: document.getElementById('passwordModal') as HTMLElement | null,
    passwordModalTitle: document.getElementById('passwordModalTitle') as HTMLElement | null,
    passwordModalDesc: document.getElementById('passwordModalDesc') as HTMLElement | null,
    masterPasswordInput: document.getElementById('masterPasswordInput') as HTMLInputElement | null,
    masterPasswordConfirm: document.getElementById('masterPasswordConfirm') as HTMLInputElement | null,
    passwordStrengthError: document.getElementById('passwordStrengthError') as HTMLElement | null,
    passwordMatchError: document.getElementById('passwordMatchError') as HTMLElement | null,
    passwordStrengthBar: document.querySelector('#passwordStrength .strength-fill') as HTMLElement | null,
    passwordStrengthText: document.getElementById('passwordStrengthText') as HTMLElement | null,
    confirmPasswordGroup: document.getElementById('confirmPasswordGroup') as HTMLElement | null,
    closePasswordModalBtn: document.getElementById('closePasswordModalBtn') as HTMLButtonElement | null,
    cancelPasswordBtn: document.getElementById('cancelPasswordBtn') as HTMLButtonElement | null,
    savePasswordBtn: document.getElementById('savePasswordBtn') as HTMLButtonElement | null,
    passwordAuthModal: document.getElementById('passwordAuthModal') as HTMLElement | null,
    masterPasswordAuthInput: document.getElementById('masterPasswordAuthInput') as HTMLInputElement | null,
    passwordAuthError: document.getElementById('passwordAuthError') as HTMLElement | null,
    closePasswordAuthModalBtn: document.getElementById('closePasswordAuthModalBtn') as HTMLButtonElement | null,
    cancelPasswordAuthBtn: document.getElementById('cancelPasswordAuthBtn') as HTMLButtonElement | null,
    submitPasswordAuthBtn: document.getElementById('submitPasswordAuthBtn') as HTMLButtonElement | null,
  };
}

/**
 * マスターパスワード設定を管理するコントローラー。
 * DOM参照と状態をインスタンスプロパティに保持し、テスト容易性を向上させる。
 */
export class MasterPasswordController {
  private dom: MasterPasswordDomRefs;
  private passwordTrapId: string | null = null;
  private passwordAuthTrapId: string | null = null;
  private passwordModalMode: 'set' | 'change' = 'set';
  private pendingPasswordAction: ((password: string) => Promise<void>) | null = null;
  // Old password captured by the auth modal for the change flow. The change
  // modal itself only collects the new password, so the old one must travel
  // here. Cleared on modal close and after a successful save — never on
  // failure, so the open change modal stays retryable. Never persisted.
  private pendingOldPassword: string | null = null;
  private saveInFlight = false;
  // Checkbox state before the user's toggle; the DOM value is already flipped
  // by the time save runs, so it cannot be read back then.
  private preToggleChecked = false;

  constructor(domRefs?: MasterPasswordDomRefs) {
    this.dom = domRefs ?? resolveDefaultDomRefs();
  }

  private updateMasterPasswordWarningVisibility(isSet: boolean): void {
    if (this.dom.masterPasswordWarning) {
      this.dom.masterPasswordWarning.classList.toggle('hidden', isSet);
    }
  }

  private updatePasswordStrength(password: string): void {
    updatePasswordStrengthDisplay(
      password,
      this.dom.passwordStrengthBar,
      this.dom.passwordStrengthText,
      calculatePasswordStrength,
    );
  }

  showPasswordModal(mode: 'set' | 'change' = 'set'): void {
    if (!this.dom.passwordModal) return;
    this.passwordModalMode = mode;
    const titleKey = mode === 'change' ? 'changeMasterPassword' : 'setMasterPassword';
    if (this.dom.passwordModalTitle) this.dom.passwordModalTitle.textContent = getMessage(titleKey);
    if (this.dom.passwordModalDesc) this.dom.passwordModalDesc.textContent = getMessage('setMasterPasswordDesc');
    // Only the set flow collects a confirmation; hide label, input and error together.
    this.dom.confirmPasswordGroup?.classList.toggle('hidden', mode === 'change');
    if (this.dom.masterPasswordInput) this.dom.masterPasswordInput.value = '';
    if (this.dom.masterPasswordConfirm) this.dom.masterPasswordConfirm.value = '';
    if (this.dom.passwordStrengthError) this.dom.passwordStrengthError.textContent = '';
    if (this.dom.passwordMatchError) this.dom.passwordMatchError.textContent = '';
    this.updatePasswordStrength('');
    this.dom.passwordModal.classList.remove('hidden');
    this.dom.passwordModal.style.display = 'flex';
    void this.dom.passwordModal.offsetHeight;
    this.dom.passwordModal.classList.add('show');
    this.passwordTrapId = focusTrapManager.trap(this.dom.passwordModal, () => this.cancelPasswordModal());
    this.dom.masterPasswordInput?.focus();
  }

  closePasswordModal(): void {
    if (!this.dom.passwordModal) return;
    this.dom.passwordModal.classList.remove('show');
    this.dom.passwordModal.style.display = 'none';
    this.dom.passwordModal.classList.add('hidden');
    if (this.passwordTrapId) { focusTrapManager.release(this.passwordTrapId); this.passwordTrapId = null; }
    if (this.dom.masterPasswordInput) this.dom.masterPasswordInput.value = '';
    if (this.dom.masterPasswordConfirm) this.dom.masterPasswordConfirm.value = '';
    if (this.dom.passwordStrengthError) this.dom.passwordStrengthError.textContent = '';
    if (this.dom.passwordMatchError) this.dom.passwordMatchError.textContent = '';
    this.pendingOldPassword = null;
    this.updatePasswordStrength('');
  }

  // User-initiated dismissal: the checkbox may have been toggled optimistically,
  // so re-read storage instead of trusting the DOM.
  private cancelPasswordModal(): void {
    this.closePasswordModal();
    void this.loadSettings();
  }

  private cancelPasswordAuthModal(): void {
    this.closePasswordAuthModal();
    void this.loadSettings();
  }

  private async savePassword(): Promise<void> {
    if (!this.dom.masterPasswordInput) return;
    // No re-entry while a rotation is running: set/change derive a fresh salt
    // per call, so two concurrent runs could persist mismatched KEK pairs.
    if (this.saveInFlight) return;
    this.saveInFlight = true;
    const saveBtn = this.dom.savePasswordBtn;
    if (saveBtn) saveBtn.disabled = true;
    try {
      await this.savePasswordInner();
    } finally {
      this.saveInFlight = false;
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  private abortMessage(e: ReencryptionAbortedError): string {
    const fields = e.fields.join(', ');
    return getMessageWithSubstitutions(
      'masterPasswordReencryptAborted',
      { fields },
      `Some items could not be decrypted (${fields}). Re-enter them, then retry.`,
    );
  }

  private async savePasswordInner(): Promise<void> {
    if (!this.dom.masterPasswordInput) return;
    const password = this.dom.masterPasswordInput.value;
    const confirmPasswordValue = this.dom.masterPasswordConfirm?.value ?? '';

    if (validateAndSetPasswordErrors(password, this.dom.passwordStrengthError)) return;

    if (this.passwordModalMode === 'set') {
      if (validateAndSetMatchErrors(password, confirmPasswordValue, this.dom.passwordMatchError)) return;
    }

    try {
      if (this.passwordModalMode === 'change') {
        const oldPassword = this.pendingOldPassword;
        if (!oldPassword) {
          showStatus('status', getMessageOr('passwordRequired', 'Please enter your master password.'), 'error');
          return;
        }
        const changed = await changeMasterPasswordService(oldPassword, password);
        if (!changed) {
          showStatus('status', getMessageOr('passwordIncorrect', 'Incorrect password.'), 'error');
          return;
        }
      } else {
        await setMasterPasswordService(password);
      }
      this.pendingOldPassword = null;
      showStatus('status', getMessageOr('masterPasswordReencryptedKept', 'Master password updated. API keys were kept.'), 'success');
      this.closePasswordModal();
      if (this.dom.masterPasswordEnabled) this.dom.masterPasswordEnabled.checked = true;
      if (this.dom.masterPasswordOptions) this.dom.masterPasswordOptions.classList.remove('hidden');
      this.updateMasterPasswordWarningVisibility(true);
    } catch (e) {
      // In change mode the checkbox was never toggled by this flow.
      if (this.passwordModalMode === 'set' && this.dom.masterPasswordEnabled) {
        this.dom.masterPasswordEnabled.checked = this.preToggleChecked;
      }
      if (e instanceof ReencryptionAbortedError) {
        showStatus('status', this.abortMessage(e), 'error');
      } else if (e instanceof MasterPasswordAlreadySetError) {
        showStatus('status', getMessage('masterPasswordAlreadySet'), 'error');
      } else if (e instanceof PendingRotationMismatchError) {
        showStatus('status', getMessage('masterPasswordPendingRotationMismatch'), 'error');
      } else {
        showStatus('status', errorMessage(e), 'error');
      }
    }
  }

  showPasswordAuthModal(actionType: 'export' | 'import', action: (password: string) => Promise<void>): void {
    if (!this.dom.passwordAuthModal) return;
    this.pendingPasswordAction = action;
    if (this.dom.masterPasswordAuthInput) this.dom.masterPasswordAuthInput.value = '';
    if (this.dom.passwordAuthError) this.dom.passwordAuthError.textContent = '';
    this.dom.passwordAuthModal.classList.remove('hidden');
    this.dom.passwordAuthModal.style.display = 'flex';
    void this.dom.passwordAuthModal.offsetHeight;
    this.dom.passwordAuthModal.classList.add('show');
    this.passwordAuthTrapId = focusTrapManager.trap(this.dom.passwordAuthModal, () => this.cancelPasswordAuthModal());
    this.dom.masterPasswordAuthInput?.focus();
  }

  closePasswordAuthModal(): void {
    if (!this.dom.passwordAuthModal) return;
    this.dom.passwordAuthModal.classList.remove('show');
    this.dom.passwordAuthModal.style.display = 'none';
    this.dom.passwordAuthModal.classList.add('hidden');
    if (this.passwordAuthTrapId) { focusTrapManager.release(this.passwordAuthTrapId); this.passwordAuthTrapId = null; }
    if (this.dom.masterPasswordAuthInput) this.dom.masterPasswordAuthInput.value = '';
    if (this.dom.passwordAuthError) this.dom.passwordAuthError.textContent = '';
    this.pendingPasswordAction = null;
  }

  private async authenticatePassword(): Promise<void> {
    // Re-entry guard first: Enter key calls here directly and bypasses the
    // disabled submit button, so a second call while an action runs must be a
    // no-op before it touches verification or rate limiting.
    const submitBtn = this.dom.submitPasswordAuthBtn;
    if (submitBtn?.disabled) return;
    if (!this.dom.masterPasswordAuthInput) return;
    const password = this.dom.masterPasswordAuthInput.value;
    if (!password) {
      if (this.dom.passwordAuthError) {
        this.dom.passwordAuthError.textContent = getMessageOr('passwordRequired', 'Please enter your master password.');
        this.dom.passwordAuthError.classList.add('visible');
      }
      return;
    }

    const rateLimitResult = await checkRateLimit();
    if (!rateLimitResult.success) {
      if (this.dom.passwordAuthError) {
        this.dom.passwordAuthError.textContent = rateLimitResult.error || 'Too many attempts.';
        this.dom.passwordAuthError.classList.add('visible');
      }
      return;
    }

    const result = await verifyMasterPassword(password, buildGetStorageFn());
    if (result.success) {
      await resetFailedAttempts();
      const action = this.pendingPasswordAction;
      // Run the action before closing the modal: on failure the modal stays
      // open with the error, instead of closing into a silent broken state.
      // (Re-entry already guarded at the top: submitBtn is disabled below.)
      const submitBtn = this.dom.submitPasswordAuthBtn;
      if (submitBtn) submitBtn.disabled = true;
      try {
        if (action) await action(password);
        // The change action closes the auth modal itself before opening the
        // change modal (single focus trap at a time); close here otherwise.
        if (this.dom.passwordAuthModal && !this.dom.passwordAuthModal.classList.contains('hidden')) {
          this.closePasswordAuthModal();
        }
      } catch (e) {
        if (this.dom.passwordAuthError) {
          this.dom.passwordAuthError.textContent = e instanceof ReencryptionAbortedError
            ? this.abortMessage(e)
            : errorMessage(e);
          this.dom.passwordAuthError.classList.add('visible');
        }
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    } else {
      await recordFailedAttempt();
      if (this.dom.passwordAuthError) {
        this.dom.passwordAuthError.textContent = getMessageOr('passwordIncorrect', result.error || 'Incorrect password.');
        this.dom.passwordAuthError.classList.add('visible');
      }
    }
  }

  private beginChange(): void {
    this.showPasswordAuthModal('export', async (password) => {
      // The change modal only collects the new password; carry the old one
      // here so savePassword() can call the service change route.
      this.pendingOldPassword = password;
      // Close the auth modal before opening the change modal: two live
      // focus traps would fight over focus and leak keydown handlers.
      // (This action cannot fail, so closing first is safe.)
      this.closePasswordAuthModal();
      this.showPasswordModal('change');
    });
  }

  // The checkbox can disagree with storage (cancelling the remove auth modal
  // leaves it unchecked while the password stays enabled), so storage decides
  // whether "enable" means set or change.
  private async beginSetOrChange(): Promise<void> {
    const alreadySet = await isMasterPasswordSet(async (keys) => chrome.storage.local.get(keys));
    if (alreadySet) {
      this.beginChange();
    } else {
      this.showPasswordModal('set');
    }
  }

  /**
   * イベントリスナーを初期化する。
   */
  initEventListeners(): void {
    const { dom } = this;

    if (dom.masterPasswordEnabled && dom.masterPasswordOptions) {
      dom.masterPasswordEnabled.addEventListener('change', async (e: Event) => {
        const isChecked = (e.target as HTMLInputElement).checked;
        this.preToggleChecked = !isChecked;
        if (isChecked) {
          await this.beginSetOrChange();
        } else {
          this.showPasswordAuthModal('export', async (password) => {
            try {
              await removeMasterPasswordService(password);
            } catch (e) {
              // Roll back to the pre-action state; the auth modal stays open
              // with the error (handled by authenticatePassword).
              if (dom.masterPasswordEnabled) dom.masterPasswordEnabled.checked = true;
              if (dom.masterPasswordOptions) dom.masterPasswordOptions.classList.remove('hidden');
              this.updateMasterPasswordWarningVisibility(true);
              throw e;
            }
            if (dom.masterPasswordEnabled) dom.masterPasswordEnabled.checked = false;
            dom.masterPasswordOptions!.classList.add('hidden');
            this.updateMasterPasswordWarningVisibility(false);
            showStatus('status', getMessageOr('masterPasswordReencryptedKept', 'Master password updated. API keys were kept.'), 'success');
          });
        }
      });
    }

    dom.setMasterPasswordNowBtn?.addEventListener('click', async () => {
      this.preToggleChecked = dom.masterPasswordEnabled?.checked ?? false;
      if (dom.masterPasswordEnabled) dom.masterPasswordEnabled.checked = true;
      await this.beginSetOrChange();
    });

    dom.changeMasterPasswordBtn?.addEventListener('click', () => this.beginChange());

    dom.masterPasswordInput?.addEventListener('input', () => {
      if (dom.masterPasswordInput) this.updatePasswordStrength(dom.masterPasswordInput.value);
    });

    dom.closePasswordModalBtn?.addEventListener('click', () => this.cancelPasswordModal());
    dom.cancelPasswordBtn?.addEventListener('click', () => this.cancelPasswordModal());
    dom.savePasswordBtn?.addEventListener('click', () => this.savePassword());
    dom.passwordModal?.addEventListener('click', (e: MouseEvent) => {
      if (e.target === dom.passwordModal) this.cancelPasswordModal();
    });

    dom.closePasswordAuthModalBtn?.addEventListener('click', () => this.cancelPasswordAuthModal());
    dom.cancelPasswordAuthBtn?.addEventListener('click', () => this.cancelPasswordAuthModal());
    dom.submitPasswordAuthBtn?.addEventListener('click', () => this.authenticatePassword());
    dom.masterPasswordAuthInput?.addEventListener('keypress', (e: KeyboardEvent) => {
      if (e.key === 'Enter') this.authenticatePassword();
    });
    dom.passwordAuthModal?.addEventListener('click', (e: MouseEvent) => {
      if (e.target === dom.passwordAuthModal) this.cancelPasswordAuthModal();
    });
  }

  /**
   * 設定をロードする。
   */
  async loadSettings(): Promise<void> {
    const isSet = await isMasterPasswordSet(async (keys) => chrome.storage.local.get(keys));
    if (this.dom.masterPasswordEnabled) this.dom.masterPasswordEnabled.checked = isSet;
    if (this.dom.masterPasswordOptions) {
      if (isSet) {
        this.dom.masterPasswordOptions.classList.remove('hidden');
      } else {
        this.dom.masterPasswordOptions.classList.add('hidden');
      }
    }
    this.updateMasterPasswordWarningVisibility(isSet);
  }
}

// ─── Backward-compatible exports ───────────────────────────────────────

let defaultController: MasterPasswordController | null = null;

function getOrCreateController(): MasterPasswordController {
  if (!defaultController) {
    defaultController = new MasterPasswordController();
  }
  return defaultController;
}

export function initMasterPasswordSettings(): void {
  getOrCreateController().initEventListeners();
}

export async function loadMasterPasswordSettings(): Promise<void> {
  return getOrCreateController().loadSettings();
}

export function showPasswordAuthModal(actionType: 'export' | 'import', action: (password: string) => Promise<void>): void {
  getOrCreateController().showPasswordAuthModal(actionType, action);
}

export function closePasswordModal(): void {
  getOrCreateController().closePasswordModal();
}
