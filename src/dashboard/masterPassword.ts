/**
 * masterPassword.ts
 * Master password settings management for the dashboard
 *
 * MasterPasswordController クラスとして実装し、DOM参照と状態を
 * インスタンスプロパティに集約する。テスト容易性を向上させる。
 */

import { getMessage } from '../utils/i18n.js';
import { showStatus } from '../utils/ui/settingsUiHelper.js';
import {
  setMasterPassword,
  verifyMasterPassword,
  isMasterPasswordSet,
  calculatePasswordStrength
} from '../utils/masterPassword.js';
import {
  validateAndSetPasswordErrors,
  validateAndSetMatchErrors,
  buildSetStorageFn,
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
    if (mode === 'change' && this.dom.confirmPasswordGroup) this.dom.confirmPasswordGroup.classList.remove('hidden');
    if (this.dom.masterPasswordInput) this.dom.masterPasswordInput.value = '';
    if (this.dom.masterPasswordConfirm) {
      this.dom.masterPasswordConfirm.value = '';
      this.dom.masterPasswordConfirm.classList.toggle('hidden', mode === 'change');
    }
    if (this.dom.passwordStrengthError) this.dom.passwordStrengthError.textContent = '';
    if (this.dom.passwordMatchError) this.dom.passwordMatchError.textContent = '';
    this.updatePasswordStrength('');
    this.dom.passwordModal.classList.remove('hidden');
    this.dom.passwordModal.style.display = 'flex';
    void this.dom.passwordModal.offsetHeight;
    this.dom.passwordModal.classList.add('show');
    this.passwordTrapId = focusTrapManager.trap(this.dom.passwordModal, () => this.closePasswordModal());
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
    this.updatePasswordStrength('');
  }

  private async savePassword(): Promise<void> {
    if (!this.dom.masterPasswordInput) return;
    const password = this.dom.masterPasswordInput.value;
    const confirmPasswordValue = this.dom.masterPasswordConfirm?.value ?? '';

    if (validateAndSetPasswordErrors(password, this.dom.passwordStrengthError)) return;

    if (this.passwordModalMode === 'set') {
      if (validateAndSetMatchErrors(password, confirmPasswordValue, this.dom.passwordMatchError)) return;
    }

    const result = await setMasterPassword(password, buildSetStorageFn());

    if (result.success) {
      showStatus('status', getMessage('passwordSaved') || 'Master password saved successfully.', 'success');
      this.closePasswordModal();
      if (this.dom.masterPasswordEnabled) this.dom.masterPasswordEnabled.checked = true;
      if (this.dom.masterPasswordOptions) this.dom.masterPasswordOptions.classList.remove('hidden');
      this.updateMasterPasswordWarningVisibility(true);
    } else {
      showStatus('status', result.error || 'Failed to save password.', 'error');
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
    this.passwordAuthTrapId = focusTrapManager.trap(this.dom.passwordAuthModal, () => this.closePasswordAuthModal());
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
    if (!this.dom.masterPasswordAuthInput) return;
    const password = this.dom.masterPasswordAuthInput.value;
    if (!password) {
      if (this.dom.passwordAuthError) {
        this.dom.passwordAuthError.textContent = getMessage('passwordRequired') || 'Please enter your master password.';
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
      this.closePasswordAuthModal();
      if (action) await action(password);
    } else {
      await recordFailedAttempt();
      if (this.dom.passwordAuthError) {
        this.dom.passwordAuthError.textContent = getMessage('passwordIncorrect') || result.error || 'Incorrect password.';
        this.dom.passwordAuthError.classList.add('visible');
      }
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
        if (isChecked) {
          this.showPasswordModal('set');
        } else {
          this.showPasswordAuthModal('export', async () => {
            await chrome.storage.local.remove(['master_password_enabled', 'master_password_salt', 'master_password_hash']);
            dom.masterPasswordOptions!.classList.add('hidden');
            this.updateMasterPasswordWarningVisibility(false);
            showStatus('status', getMessage('passwordRemoved') || 'Master password removed.', 'success');
          });
        }
      });
    }

    dom.setMasterPasswordNowBtn?.addEventListener('click', () => {
      if (dom.masterPasswordEnabled) dom.masterPasswordEnabled.checked = true;
      this.showPasswordModal('set');
    });

    dom.changeMasterPasswordBtn?.addEventListener('click', () => {
      this.showPasswordAuthModal('export', async () => {
        this.showPasswordModal('change');
      });
    });

    dom.masterPasswordInput?.addEventListener('input', () => {
      if (dom.masterPasswordInput) this.updatePasswordStrength(dom.masterPasswordInput.value);
    });

    dom.closePasswordModalBtn?.addEventListener('click', () => this.closePasswordModal());
    dom.cancelPasswordBtn?.addEventListener('click', () => this.closePasswordModal());
    dom.savePasswordBtn?.addEventListener('click', () => this.savePassword());
    dom.passwordModal?.addEventListener('click', (e: MouseEvent) => {
      if (e.target === dom.passwordModal) this.closePasswordModal();
    });

    dom.closePasswordAuthModalBtn?.addEventListener('click', () => this.closePasswordAuthModal());
    dom.cancelPasswordAuthBtn?.addEventListener('click', () => this.closePasswordAuthModal());
    dom.submitPasswordAuthBtn?.addEventListener('click', () => this.authenticatePassword());
    dom.masterPasswordAuthInput?.addEventListener('keypress', (e: KeyboardEvent) => {
      if (e.key === 'Enter') this.authenticatePassword();
    });
    dom.passwordAuthModal?.addEventListener('click', (e: MouseEvent) => {
      if (e.target === dom.passwordAuthModal) this.closePasswordAuthModal();
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
