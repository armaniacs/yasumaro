/**
 * masterPasswordUi.ts
 * マスターパスワードモーダル UI（設定・認証・強度インジケータ・イベントハンドラ・状態管理）
 */

import { getSettings, saveSettingsWithAllowedUrls, Settings } from '../utils/storage.js';
import {
    setMasterPassword,
    verifyMasterPassword,
    isMasterPasswordSet,
    calculatePasswordStrength,
    validatePasswordRequirements,
    validatePasswordMatch
} from '../utils/masterPassword.js';
import {
    checkRateLimit,
    recordFailedAttempt,
    resetFailedAttempts
} from '../utils/rateLimiter.js';
import { showStatus } from './settingsUiHelper.js';
import { getMessage } from './i18n.js';
import { focusTrapManager } from './utils/focusTrap.js';

const masterPasswordEnabled = document.getElementById('masterPasswordEnabled') as HTMLInputElement | null;
const masterPasswordOptions = document.getElementById('masterPasswordOptions') as HTMLElement | null;
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
const passwordAuthModalTitle = document.getElementById('passwordAuthModalTitle') as HTMLElement | null;
const passwordAuthModalDesc = document.getElementById('passwordAuthModalDesc') as HTMLElement | null;
const masterPasswordAuthInput = document.getElementById('masterPasswordAuthInput') as HTMLInputElement | null;
const passwordAuthError = document.getElementById('passwordAuthError') as HTMLElement | null;
const closePasswordAuthModalBtn = document.getElementById('closePasswordAuthModalBtn') as HTMLButtonElement | null;
const cancelPasswordAuthBtn = document.getElementById('cancelPasswordAuthBtn') as HTMLButtonElement | null;
const submitPasswordAuthBtn = document.getElementById('submitPasswordAuthBtn') as HTMLButtonElement | null;

let passwordTrapId: string | null = null;
let passwordAuthTrapId: string | null = null;
let passwordModalMode: 'set' | 'change' = 'set';
let pendingPasswordAction: ((password: string) => Promise<void>) | null = null;

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
    const descKey = mode === 'change' ? 'changeMasterPasswordDesc' : 'setMasterPasswordDesc';
    if (passwordModalTitle) passwordModalTitle.textContent = getMessage(titleKey);
    if (passwordModalDesc) passwordModalDesc.textContent = getMessage(descKey);

    if (mode === 'change' && confirmPasswordGroup) {
        confirmPasswordGroup.classList.remove('hidden');
    }

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

    if (passwordTrapId) {
        focusTrapManager.release(passwordTrapId);
        passwordTrapId = null;
    }

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

    if (passwordAuthTrapId) {
        focusTrapManager.release(passwordAuthTrapId);
        passwordAuthTrapId = null;
    }

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

    const rateLimitResult = await checkRateLimit();
    if (!rateLimitResult.success) {
        if (passwordAuthError) {
            passwordAuthError.textContent = rateLimitResult.error || 'Too many attempts.';
            passwordAuthError.classList.add('visible');
        }
        return;
    }

    const getStorageFn = async (keys: string[]) => {
        return chrome.storage.local.get(keys);
    };

    const result = await verifyMasterPassword(password, getStorageFn);

    if (result.success) {
        await resetFailedAttempts();
        closePasswordAuthModal();
        if (pendingPasswordAction) {
            await pendingPasswordAction(password);
        }
    } else {
        await recordFailedAttempt();
        if (passwordAuthError) {
            passwordAuthError.textContent = getMessage('passwordIncorrect') || result.error || 'Incorrect password.';
            passwordAuthError.classList.add('visible');
        }
    }
}

function initMasterPasswordUi(): void {
    if (masterPasswordEnabled && masterPasswordOptions) {
        masterPasswordEnabled.addEventListener('change', async (e: Event) => {
            const isChecked = (e.target as HTMLInputElement).checked;

            if (isChecked) {
                showPasswordModal('set');
            } else {
                masterPasswordEnabled.checked = true;
                showPasswordAuthModal('export', async () => {
                    const confirmed = confirm(
                        getMessage('passwordRemoveConfirm') ||
                        'Disabling the master password will remove all encrypted API keys. This action cannot be undone. Continue?'
                    );
                    if (!confirmed) {
                        masterPasswordEnabled.checked = true;
                        return;
                    }

                    await chrome.storage.local.remove([
                        'master_password_enabled',
                        'master_password_salt',
                        'master_password_hash'
                    ]);

                    const settings = await getSettings();
                    const apiKeysToRemove = ['obsidian_api_key', 'gemini_api_key', 'openai_api_key', 'openai_2_api_key', 'provider_api_key'];
                    for (const key of apiKeysToRemove) {
                        if (key in settings) {
                            settings[key as keyof Settings] = '';
                        }
                    }
                    await saveSettingsWithAllowedUrls(settings);

                    masterPasswordEnabled.checked = false;
                    masterPasswordOptions.classList.add('hidden');
                    showStatus('status', getMessage('passwordRemoved') || 'Master password and encrypted data removed.', 'success');
                });
            }
        });
    }

    if (changeMasterPasswordBtn) {
        changeMasterPasswordBtn.addEventListener('click', () => {
            showPasswordAuthModal('export', async () => {
                showPasswordModal('change');
            });
        });
    }

    if (masterPasswordInput) {
        masterPasswordInput.addEventListener('input', () => {
            updatePasswordStrength(masterPasswordInput.value);
        });
    }

    if (closePasswordModalBtn) {
        closePasswordModalBtn.addEventListener('click', closePasswordModal);
    }

    if (cancelPasswordBtn) {
        cancelPasswordBtn.addEventListener('click', closePasswordModal);
    }

    if (savePasswordBtn) {
        savePasswordBtn.addEventListener('click', savePassword);
    }

    if (passwordModal) {
        passwordModal.addEventListener('click', (e: MouseEvent) => {
            if (e.target === passwordModal) {
                closePasswordModal();
            }
        });
    }

    if (closePasswordAuthModalBtn) {
        closePasswordAuthModalBtn.addEventListener('click', closePasswordAuthModal);
    }

    if (cancelPasswordAuthBtn) {
        cancelPasswordAuthBtn.addEventListener('click', closePasswordAuthModal);
    }

    if (submitPasswordAuthBtn) {
        submitPasswordAuthBtn.addEventListener('click', authenticatePassword);
    }

    if (masterPasswordAuthInput) {
        masterPasswordAuthInput.addEventListener('keypress', (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                authenticatePassword();
            }
        });
    }

    if (passwordAuthModal) {
        passwordAuthModal.addEventListener('click', (e: MouseEvent) => {
            if (e.target === passwordAuthModal) {
                closePasswordAuthModal();
            }
        });
    }
}

async function loadMasterPasswordSettings(): Promise<void> {
    const isSet = await isMasterPasswordSet(async (keys) => chrome.storage.local.get(keys));
    if (masterPasswordEnabled) {
        masterPasswordEnabled.checked = isSet;
    }
    if (masterPasswordOptions) {
        if (isSet) {
            masterPasswordOptions.classList.remove('hidden');
        } else {
            masterPasswordOptions.classList.add('hidden');
        }
    }
}

export { initMasterPasswordUi, loadMasterPasswordSettings, showPasswordAuthModal };