/**
 * masterPassword.ts
 * Master password settings management for the dashboard
 */

import { getMessage } from '../utils/i18n.js';
import { showStatus } from '../popup/settingsUiHelper.js';
import {
  setMasterPassword,
  verifyMasterPassword,
  isMasterPasswordSet,
  calculatePasswordStrength,
  validatePasswordRequirements,
  validatePasswordMatch
} from '../utils/masterPassword.js';
import { checkRateLimit, recordFailedAttempt, resetFailedAttempts } from '../utils/rateLimiter.js';
import { focusTrapManager } from '../popup/utils/focusTrap.js';

// DOM Elements
const masterPasswordEnabled = document.getElementById('masterPasswordEnabled') as HTMLInputElement | null;
const masterPasswordOptions = document.getElementById('masterPasswordOptions') as HTMLElement | null;
const masterPasswordWarning = document.getElementById('masterPasswordWarning') as HTMLElement | null;
const setMasterPasswordNowBtn = document.getElementById('setMasterPasswordNowBtn') as HTMLButtonElement | null;
const changeMasterPasswordBtn = document.getElementById('changeMasterPassword') as HTMLButtonElement | null;

const passwordModal = document.getElementById('passwordModal') as HTMLElement | null;
const passwordModalTitle = document.getElementById('passwordModalTitle') as HTMLElement | null;
const passwordModalDesc = document.getElementById('passwordModalDesc') as HTMLElement | null;
const masterPasswordInput = document.getElementById('masterPasswordInput') as HTMLInputElement | null;
const masterPasswordConfirm = document.getElementById('masterPasswordConfirm') as HTMLInputElement | null;
const passwordStrengthError = document.getElementById('passwordStrengthError') as HTMLElement | null;
const passwordMatchError = document.getElementById('passwordMatchError') as HTMLElement | null;
const passwordStrengthBar = document.querySelector('#passwordStrength .strength-fill') as HTMLElement | null;
const passwordStrengthText = document.getElementById('passwordStrengthText') as HTMLElement | null;
const confirmPasswordGroup = document.getElementById('confirmPasswordGroup') as HTMLElement | null;
const closePasswordModalBtn = document.getElementById('closePasswordModalBtn') as HTMLButtonElement | null;
const cancelPasswordBtn = document.getElementById('cancelPasswordBtn') as HTMLButtonElement | null;
const savePasswordBtn = document.getElementById('savePasswordBtn') as HTMLButtonElement | null;

const passwordAuthModal = document.getElementById('passwordAuthModal') as HTMLElement | null;
const _passwordAuthModalTitle = document.getElementById('passwordAuthModalTitle') as HTMLElement | null;
const _passwordAuthModalDesc = document.getElementById('passwordAuthModalDesc') as HTMLElement | null;
const masterPasswordAuthInput = document.getElementById('masterPasswordAuthInput') as HTMLInputElement | null;
const passwordAuthError = document.getElementById('passwordAuthError') as HTMLElement | null;
const closePasswordAuthModalBtn = document.getElementById('closePasswordAuthModalBtn') as HTMLButtonElement | null;
const cancelPasswordAuthBtn = document.getElementById('cancelPasswordAuthBtn') as HTMLButtonElement | null;
const submitPasswordAuthBtn = document.getElementById('submitPasswordAuthBtn') as HTMLButtonElement | null;

// State
let passwordTrapId: string | null = null;
let passwordAuthTrapId: string | null = null;
let passwordModalMode: 'set' | 'change' = 'set';
let pendingPasswordAction: ((password: string) => Promise<void>) | null = null;

function updateMasterPasswordWarningVisibility(isSet: boolean): void {
  if (masterPasswordWarning) {
    masterPasswordWarning.classList.toggle('hidden', isSet);
  }
}

function updatePasswordStrength(password: string): void {
  if (!passwordStrengthBar || !passwordStrengthText) return;
  if (!password) {
    passwordStrengthBar.style.width = '0%';
    passwordStrengthBar.className = 'strength-fill';
    passwordStrengthText.textContent = getMessage('passwordStrengthWeak') || 'Weak';
    return;
  }
  const result = calculatePasswordStrength(password);
  passwordStrengthBar.style.width = `${result.score}%`;
  passwordStrengthBar.className = `strength-fill ${result.level}`;
  passwordStrengthText.textContent = getMessage(`passwordStrength${result.level.charAt(0).toUpperCase() + result.level.slice(1)}`) || result.text;
}

function showPasswordModal(mode: 'set' | 'change' = 'set'): void {
  if (!passwordModal) return;
  passwordModalMode = mode;
  const titleKey = mode === 'change' ? 'changeMasterPassword' : 'setMasterPassword';
  if (passwordModalTitle) passwordModalTitle.textContent = getMessage(titleKey);
  if (passwordModalDesc) passwordModalDesc.textContent = getMessage('setMasterPasswordDesc');
  if (mode === 'change' && confirmPasswordGroup) confirmPasswordGroup.classList.remove('hidden');
  if (masterPasswordInput) masterPasswordInput.value = '';
  if (masterPasswordConfirm) {
    masterPasswordConfirm.value = '';
    masterPasswordConfirm.classList.toggle('hidden', mode === 'change');
  }
  if (passwordStrengthError) passwordStrengthError.textContent = '';
  if (passwordMatchError) passwordMatchError.textContent = '';
  updatePasswordStrength('');
  passwordModal.classList.remove('hidden');
  passwordModal.style.display = 'flex';
  void passwordModal.offsetHeight;
  passwordModal.classList.add('show');
  passwordTrapId = focusTrapManager.trap(passwordModal, closePasswordModal);
  masterPasswordInput?.focus();
}

function closePasswordModal(): void {
  if (!passwordModal) return;
  passwordModal.classList.remove('show');
  passwordModal.style.display = 'none';
  passwordModal.classList.add('hidden');
  if (passwordTrapId) { focusTrapManager.release(passwordTrapId); passwordTrapId = null; }
  if (masterPasswordInput) masterPasswordInput.value = '';
  if (masterPasswordConfirm) masterPasswordConfirm.value = '';
  if (passwordStrengthError) passwordStrengthError.textContent = '';
  if (passwordMatchError) passwordMatchError.textContent = '';
  updatePasswordStrength('');
}

async function savePassword(): Promise<void> {
  if (!masterPasswordInput) return;
  const password = masterPasswordInput.value;
  const confirmPasswordValue = masterPasswordConfirm?.value ?? '';

  const requirementError = validatePasswordRequirements(password);
  if (requirementError) {
    if (passwordStrengthError) {
      passwordStrengthError.textContent = getMessage('passwordTooShort') || requirementError;
      passwordStrengthError.classList.add('visible');
    }
    return;
  }

  if (passwordModalMode === 'set') {
    const matchError = validatePasswordMatch(password, confirmPasswordValue);
    if (matchError) {
      if (passwordMatchError) {
        passwordMatchError.textContent = getMessage('passwordMismatch') || matchError;
        passwordMatchError.classList.add('visible');
      }
      return;
    }
  }

  const setStorageFn = async (key: string, value: unknown) => {
    await chrome.storage.local.set({ [key]: value });
  };
  const result = await setMasterPassword(password, setStorageFn);

  if (result.success) {
    showStatus('status', getMessage('passwordSaved') || 'Master password saved successfully.', 'success');
    closePasswordModal();
    if (masterPasswordEnabled) masterPasswordEnabled.checked = true;
    if (masterPasswordOptions) masterPasswordOptions.classList.remove('hidden');
    updateMasterPasswordWarningVisibility(true);
  } else {
    showStatus('status', result.error || 'Failed to save password.', 'error');
  }
}

function showPasswordAuthModal(actionType: 'export' | 'import', action: (password: string) => Promise<void>): void {
  if (!passwordAuthModal) return;
  pendingPasswordAction = action;
  if (masterPasswordAuthInput) masterPasswordAuthInput.value = '';
  if (passwordAuthError) passwordAuthError.textContent = '';
  passwordAuthModal.classList.remove('hidden');
  passwordAuthModal.style.display = 'flex';
  void passwordAuthModal.offsetHeight;
  passwordAuthModal.classList.add('show');
  passwordAuthTrapId = focusTrapManager.trap(passwordAuthModal, closePasswordAuthModal);
  masterPasswordAuthInput?.focus();
}

function closePasswordAuthModal(): void {
  if (!passwordAuthModal) return;
  passwordAuthModal.classList.remove('show');
  passwordAuthModal.style.display = 'none';
  passwordAuthModal.classList.add('hidden');
  if (passwordAuthTrapId) { focusTrapManager.release(passwordAuthTrapId); passwordAuthTrapId = null; }
  if (masterPasswordAuthInput) masterPasswordAuthInput.value = '';
  if (passwordAuthError) passwordAuthError.textContent = '';
  pendingPasswordAction = null;
}

async function authenticatePassword(): Promise<void> {
  if (!masterPasswordAuthInput) return;
  const password = masterPasswordAuthInput.value;
  if (!password) {
    if (passwordAuthError) {
      passwordAuthError.textContent = getMessage('passwordRequired') || 'Please enter your master password.';
      passwordAuthError.classList.add('visible');
    }
    return;
  }

  // VULN-021 fix: check rate limit before attempting password verification
  const rateLimitResult = await checkRateLimit();
  if (!rateLimitResult.success) {
    if (passwordAuthError) {
      passwordAuthError.textContent = rateLimitResult.error || 'Too many attempts.';
      passwordAuthError.classList.add('visible');
    }
    return;
  }

  const getStorageFn = async (keys: string[]) => chrome.storage.local.get(keys);
  const result = await verifyMasterPassword(password, getStorageFn);
  if (result.success) {
    // VULN-021 fix: reset failed attempts on successful authentication
    await resetFailedAttempts();
    const action = pendingPasswordAction;
    closePasswordAuthModal();
    if (action) await action(password);
  } else {
    // VULN-021 fix: record failed attempt
    await recordFailedAttempt();
    if (passwordAuthError) {
      passwordAuthError.textContent = getMessage('passwordIncorrect') || result.error || 'Incorrect password.';
      passwordAuthError.classList.add('visible');
    }
  }
}

export function initMasterPasswordSettings(): void {
  if (masterPasswordEnabled && masterPasswordOptions) {
    masterPasswordEnabled.addEventListener('change', async (e: Event) => {
      const isChecked = (e.target as HTMLInputElement).checked;
      if (isChecked) {
        showPasswordModal('set');
      } else {
        // VULN-015 fix: require password authentication before disabling master password
        showPasswordAuthModal('export', async () => {
          await chrome.storage.local.remove(['master_password_enabled', 'master_password_salt', 'master_password_hash']);
          masterPasswordOptions.classList.add('hidden');
          updateMasterPasswordWarningVisibility(false);
          showStatus('status', getMessage('passwordRemoved') || 'Master password removed.', 'success');
        });
      }
    });
  }

  setMasterPasswordNowBtn?.addEventListener('click', () => {
    if (masterPasswordEnabled) masterPasswordEnabled.checked = true;
    showPasswordModal('set');
  });

  changeMasterPasswordBtn?.addEventListener('click', () => {
    showPasswordAuthModal('export', async () => {
      showPasswordModal('change');
    });
  });

  masterPasswordInput?.addEventListener('input', () => {
    if (masterPasswordInput) updatePasswordStrength(masterPasswordInput.value);
  });

  closePasswordModalBtn?.addEventListener('click', closePasswordModal);
  cancelPasswordBtn?.addEventListener('click', closePasswordModal);
  savePasswordBtn?.addEventListener('click', savePassword);
  passwordModal?.addEventListener('click', (e: MouseEvent) => {
    if (e.target === passwordModal) closePasswordModal();
  });

  closePasswordAuthModalBtn?.addEventListener('click', closePasswordAuthModal);
  cancelPasswordAuthBtn?.addEventListener('click', closePasswordAuthModal);
  submitPasswordAuthBtn?.addEventListener('click', authenticatePassword);
  masterPasswordAuthInput?.addEventListener('keypress', (e: KeyboardEvent) => {
    if (e.key === 'Enter') authenticatePassword();
  });
  passwordAuthModal?.addEventListener('click', (e: MouseEvent) => {
    if (e.target === passwordAuthModal) closePasswordAuthModal();
  });
}

export async function loadMasterPasswordSettings(): Promise<void> {
  const isSet = await isMasterPasswordSet(async (keys) => chrome.storage.local.get(keys));
  if (masterPasswordEnabled) masterPasswordEnabled.checked = isSet;
  if (masterPasswordOptions) {
    if (isSet) {
      masterPasswordOptions.classList.remove('hidden');
    } else {
      masterPasswordOptions.classList.add('hidden');
    }
  }
  updateMasterPasswordWarningVisibility(isSet);
}

export { showPasswordAuthModal, closePasswordModal };
