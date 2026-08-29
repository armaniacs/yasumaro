// @vitest-environment jsdom
/**
 * masterPassword-branches.test.ts
 * Covers remaining uncovered branches in masterPassword.ts using
 * MasterPasswordController with partial (null-field) DOM refs to
 * exercise the "element missing" branches directly, and rate-limit /
 * fallback-message branches that other suites do not reach.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MasterPasswordDomRefs } from '../masterPassword.js';

vi.mock('../../utils/i18n.js', () => ({
  getMessage: vi.fn((key: string) => `i18n_${key}`),
}));

vi.mock('../../utils/ui/settingsUiHelper.js', () => ({
  showStatus: vi.fn(),
}));

vi.mock('../../utils/ui/focusTrap.js', () => ({
  focusTrapManager: {
    trap: vi.fn().mockReturnValue('trap-id'),
    release: vi.fn(),
  },
}));

vi.mock('../../utils/masterPassword.js', () => ({
  setMasterPassword: vi.fn(),
  verifyMasterPassword: vi.fn(),
  isMasterPasswordSet: vi.fn(),
  calculatePasswordStrength: vi.fn(),
  validatePasswordRequirements: vi.fn(),
  validatePasswordMatch: vi.fn(),
}));

vi.mock('../../utils/rateLimiter.js', () => ({
  checkRateLimit: vi.fn(),
  recordFailedAttempt: vi.fn(),
  resetFailedAttempts: vi.fn(),
}));

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
  },
});

import { showStatus } from '../../utils/ui/settingsUiHelper.js';
import { getMessage } from '../../utils/i18n.js';
import {
  setMasterPassword,
  verifyMasterPassword,
  isMasterPasswordSet,
  calculatePasswordStrength,
  validatePasswordRequirements,
  validatePasswordMatch,
} from '../../utils/masterPassword.js';
import { checkRateLimit, recordFailedAttempt, resetFailedAttempts } from '../../utils/rateLimiter.js';

/**
 * All-null DOM refs so every field can be overridden per-test to isolate
 * a single "element present/absent" branch at a time.
 */
function emptyDomRefs(): MasterPasswordDomRefs {
  return {
    masterPasswordEnabled: null,
    masterPasswordOptions: null,
    masterPasswordWarning: null,
    setMasterPasswordNowBtn: null,
    changeMasterPasswordBtn: null,
    passwordModal: null,
    passwordModalTitle: null,
    passwordModalDesc: null,
    masterPasswordInput: null,
    masterPasswordConfirm: null,
    passwordStrengthError: null,
    passwordMatchError: null,
    passwordStrengthBar: null,
    passwordStrengthText: null,
    confirmPasswordGroup: null,
    closePasswordModalBtn: null,
    cancelPasswordBtn: null,
    savePasswordBtn: null,
    passwordAuthModal: null,
    masterPasswordAuthInput: null,
    passwordAuthError: null,
    closePasswordAuthModalBtn: null,
    cancelPasswordAuthBtn: null,
    submitPasswordAuthBtn: null,
  };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] {
  return document.createElement(tag);
}

describe('masterPassword-branches — showPasswordModal null-element branches', () => {
  let mod: typeof import('../masterPassword.js');

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mod = await import('../masterPassword.js');
    vi.mocked(validatePasswordRequirements).mockReturnValue(null);
    vi.mocked(validatePasswordMatch).mockReturnValue(null);
  });

  it('returns immediately when passwordModal is null', () => {
    const { MasterPasswordController } = mod;
    const refs = emptyDomRefs();
    const controller = new MasterPasswordController(refs);
    expect(() => controller.showPasswordModal('set')).not.toThrow();
    // no throw and no crash proves the early-return branch executed
  });

  it('skips optional title/desc/input/confirm/error fields when absent, modal present', () => {
    const { MasterPasswordController } = mod;
    const refs = emptyDomRefs();
    refs.passwordModal = el('div');
    // All other optional fields remain null: title, desc, input, confirm,
    // strengthError, matchError.
    const controller = new MasterPasswordController(refs);
    expect(() => controller.showPasswordModal('change')).not.toThrow();
    expect(refs.passwordModal.classList.contains('show')).toBe(true);
  });
});

describe('masterPassword-branches — closePasswordModal null-element branches', () => {
  let mod: typeof import('../masterPassword.js');

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mod = await import('../masterPassword.js');
    vi.mocked(validatePasswordRequirements).mockReturnValue(null);
    vi.mocked(validatePasswordMatch).mockReturnValue(null);
  });

  it('returns immediately when passwordModal is null', () => {
    const { MasterPasswordController } = mod;
    const controller = new MasterPasswordController(emptyDomRefs());
    expect(() => controller.closePasswordModal()).not.toThrow();
  });

  it('skips optional input/confirm/error fields when absent, modal present', () => {
    const { MasterPasswordController } = mod;
    const refs = emptyDomRefs();
    refs.passwordModal = el('div');
    const controller = new MasterPasswordController(refs);
    expect(() => controller.closePasswordModal()).not.toThrow();
    expect(refs.passwordModal.classList.contains('hidden')).toBe(true);
  });
});

describe('masterPassword-branches — savePassword branches', () => {
  let mod: typeof import('../masterPassword.js');

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mod = await import('../masterPassword.js');
    vi.mocked(calculatePasswordStrength).mockReturnValue({ score: 80, level: 'strong', text: 'Strong' });
    vi.mocked(validatePasswordRequirements).mockReturnValue(null);
    vi.mocked(validatePasswordMatch).mockReturnValue(null);
    vi.mocked(getMessage).mockImplementation((key: string) => `i18n_${key}`);
  });

  function fullSaveRefs(): MasterPasswordDomRefs {
    const refs = emptyDomRefs();
    refs.passwordModal = el('div');
    refs.masterPasswordInput = el('input') as HTMLInputElement;
    refs.masterPasswordInput.value = 'StrongPassword1!';
    refs.masterPasswordConfirm = null; // exercise the `?? ''` fallback branch
    refs.passwordStrengthError = el('div');
    refs.passwordMatchError = el('div');
    refs.masterPasswordEnabled = el('input') as HTMLInputElement;
    refs.masterPasswordOptions = el('div');
    refs.masterPasswordWarning = el('div');
    return refs;
  }

  it('uses "" fallback when masterPasswordConfirm is null (mode=change skips match check)', async () => {
    const { MasterPasswordController } = mod;
    const refs = fullSaveRefs();
    refs.savePasswordBtn = el('button') as HTMLButtonElement;
    vi.mocked(setMasterPassword).mockResolvedValue({ success: true });
    const controller = new MasterPasswordController(refs);
    controller.showPasswordModal('change');
    refs.masterPasswordInput!.value = 'StrongPassword1!';
    controller.initEventListeners();
    refs.savePasswordBtn.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(setMasterPassword).toHaveBeenCalledWith('StrongPassword1!', expect.any(Function));
  });

  it('falls back to default success message when getMessage returns falsy, and skips enabled/options refs when null', async () => {
    vi.mocked(getMessage).mockReturnValue('' as unknown as string);
    const { MasterPasswordController } = mod;
    const refs = fullSaveRefs();
    refs.masterPasswordEnabled = null;
    refs.masterPasswordOptions = null;
    refs.savePasswordBtn = el('button') as HTMLButtonElement;
    vi.mocked(setMasterPassword).mockResolvedValue({ success: true });
    const controller = new MasterPasswordController(refs);
    controller.showPasswordModal('change');
    refs.masterPasswordInput!.value = 'StrongPassword1!';
    controller.initEventListeners();
    refs.savePasswordBtn.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(showStatus).toHaveBeenCalledWith('status', 'Master password saved successfully.', 'success');
  });

  it('mode=set requires matching confirm password (returns early on mismatch)', async () => {
    vi.mocked(validatePasswordMatch).mockReturnValue('Passwords do not match.');
    const { MasterPasswordController } = mod;
    const refs = fullSaveRefs();
    refs.masterPasswordConfirm = el('input') as HTMLInputElement;
    refs.savePasswordBtn = el('button') as HTMLButtonElement;
    const controller = new MasterPasswordController(refs);
    controller.showPasswordModal('set');
    refs.masterPasswordInput!.value = 'StrongPassword1!';
    refs.masterPasswordConfirm.value = 'different-value';
    controller.initEventListeners();
    refs.savePasswordBtn.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(setMasterPassword).not.toHaveBeenCalled();
  });
});

describe('masterPassword-branches — showPasswordAuthModal / closePasswordAuthModal null-element branches', () => {
  let mod: typeof import('../masterPassword.js');

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mod = await import('../masterPassword.js');
    vi.mocked(validatePasswordRequirements).mockReturnValue(null);
    vi.mocked(validatePasswordMatch).mockReturnValue(null);
  });

  it('returns immediately when passwordAuthModal is null', () => {
    const { MasterPasswordController } = mod;
    const controller = new MasterPasswordController(emptyDomRefs());
    expect(() => controller.closePasswordAuthModal()).not.toThrow();
  });

  it('skips optional authInput/authError fields when absent, modal present', () => {
    const { MasterPasswordController } = mod;
    const refs = emptyDomRefs();
    refs.passwordAuthModal = el('div');
    const controller = new MasterPasswordController(refs);
    expect(() => controller.closePasswordAuthModal()).not.toThrow();
    expect(refs.passwordAuthModal.classList.contains('hidden')).toBe(true);
  });
});

describe('masterPassword-branches — authenticatePassword rate-limit and error branches', () => {
  let mod: typeof import('../masterPassword.js');

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mod = await import('../masterPassword.js');
    vi.mocked(validatePasswordRequirements).mockReturnValue(null);
    vi.mocked(validatePasswordMatch).mockReturnValue(null);
    vi.mocked(getMessage).mockImplementation((key: string) => `i18n_${key}`);
  });

  function authRefs(): MasterPasswordDomRefs {
    const refs = emptyDomRefs();
    refs.passwordAuthModal = el('div');
    refs.masterPasswordAuthInput = el('input') as HTMLInputElement;
    refs.passwordAuthError = el('div');
    return refs;
  }

  it('shows i18n message when password is empty (true branch of !password)', async () => {
    const { MasterPasswordController } = mod;
    const refs = authRefs();
    refs.submitPasswordAuthBtn = el('button') as HTMLButtonElement;
    const controller = new MasterPasswordController(refs);
    controller.showPasswordAuthModal('export', vi.fn());
    refs.masterPasswordAuthInput!.value = '';
    controller.initEventListeners();
    refs.submitPasswordAuthBtn.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(refs.passwordAuthError!.textContent).toBe('i18n_passwordRequired');
    expect(refs.passwordAuthError!.classList.contains('visible')).toBe(true);
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it('falls back to default message when getMessage returns falsy for empty password', async () => {
    vi.mocked(getMessage).mockReturnValue('' as unknown as string);
    const { MasterPasswordController } = mod;
    const refs = authRefs();
    refs.submitPasswordAuthBtn = el('button') as HTMLButtonElement;
    const controller = new MasterPasswordController(refs);
    controller.showPasswordAuthModal('export', vi.fn());
    refs.masterPasswordAuthInput!.value = '';
    controller.initEventListeners();
    refs.submitPasswordAuthBtn.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(refs.passwordAuthError!.textContent).toBe('Please enter your master password.');
  });

  it('shows rate-limit error and returns early when checkRateLimit fails (with explicit error)', async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ success: false, error: 'Too many tries, wait 30s.' });
    const { MasterPasswordController } = mod;
    const refs = authRefs();
    refs.submitPasswordAuthBtn = el('button') as HTMLButtonElement;
    const controller = new MasterPasswordController(refs);
    controller.showPasswordAuthModal('export', vi.fn());
    refs.masterPasswordAuthInput!.value = 'somepassword';
    controller.initEventListeners();
    refs.submitPasswordAuthBtn.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(refs.passwordAuthError!.textContent).toBe('Too many tries, wait 30s.');
    expect(refs.passwordAuthError!.classList.contains('visible')).toBe(true);
    expect(verifyMasterPassword).not.toHaveBeenCalled();
  });

  it('shows default rate-limit error when checkRateLimit fails without an error message', async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ success: false });
    const { MasterPasswordController } = mod;
    const refs = authRefs();
    refs.submitPasswordAuthBtn = el('button') as HTMLButtonElement;
    const controller = new MasterPasswordController(refs);
    controller.showPasswordAuthModal('export', vi.fn());
    refs.masterPasswordAuthInput!.value = 'somepassword';
    controller.initEventListeners();
    refs.submitPasswordAuthBtn.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(refs.passwordAuthError!.textContent).toBe('Too many attempts.');
  });

  it('does not throw when rate-limited but passwordAuthError element is absent', async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ success: false, error: 'blocked' });
    const { MasterPasswordController } = mod;
    const refs = authRefs();
    refs.passwordAuthError = null;
    refs.submitPasswordAuthBtn = el('button') as HTMLButtonElement;
    const controller = new MasterPasswordController(refs);
    controller.showPasswordAuthModal('export', vi.fn());
    refs.masterPasswordAuthInput!.value = 'somepassword';
    controller.initEventListeners();
    expect(() => refs.submitPasswordAuthBtn!.click()).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });

  it('runs pending action after successful auth and resets attempts', async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ success: true });
    vi.mocked(verifyMasterPassword).mockResolvedValue({ success: true });
    const action = vi.fn().mockResolvedValue(undefined);
    const { MasterPasswordController } = mod;
    const refs = authRefs();
    refs.submitPasswordAuthBtn = el('button') as HTMLButtonElement;
    const controller = new MasterPasswordController(refs);
    controller.showPasswordAuthModal('export', action);
    refs.masterPasswordAuthInput!.value = 'correct-password';
    controller.initEventListeners();
    refs.submitPasswordAuthBtn.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(resetFailedAttempts).toHaveBeenCalled();
    expect(action).toHaveBeenCalledWith('correct-password');
  });

  it('does not invoke a pending action when none is set after successful auth', async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ success: true });
    vi.mocked(verifyMasterPassword).mockResolvedValue({ success: true });
    const { MasterPasswordController } = mod;
    const refs = authRefs();
    refs.submitPasswordAuthBtn = el('button') as HTMLButtonElement;
    const controller = new MasterPasswordController(refs);
    controller.initEventListeners();
    // Open once to attach the trap/listeners, close to clear pendingPasswordAction
    // back to null, then reopen the modal element manually (without calling
    // showPasswordAuthModal again) so authenticatePassword proceeds with a
    // null pending action.
    controller.showPasswordAuthModal('export', vi.fn());
    controller.closePasswordAuthModal();
    refs.passwordAuthModal!.classList.remove('hidden');
    refs.masterPasswordAuthInput!.value = 'correct-password';
    refs.submitPasswordAuthBtn.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(resetFailedAttempts).toHaveBeenCalled();
  });

  it('records failed attempt and shows incorrect-password message on verify failure', async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ success: true });
    vi.mocked(verifyMasterPassword).mockResolvedValue({ success: false, error: 'bad hash' });
    const { MasterPasswordController } = mod;
    const refs = authRefs();
    refs.submitPasswordAuthBtn = el('button') as HTMLButtonElement;
    const controller = new MasterPasswordController(refs);
    controller.showPasswordAuthModal('export', vi.fn());
    refs.masterPasswordAuthInput!.value = 'wrong-password';
    controller.initEventListeners();
    refs.submitPasswordAuthBtn.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(recordFailedAttempt).toHaveBeenCalled();
    expect(refs.passwordAuthError!.textContent).toBe('i18n_passwordIncorrect');
    expect(refs.passwordAuthError!.classList.contains('visible')).toBe(true);
  });

  it('does not throw when verify fails but passwordAuthError element is absent', async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ success: true });
    vi.mocked(verifyMasterPassword).mockResolvedValue({ success: false, error: 'bad hash' });
    const { MasterPasswordController } = mod;
    const refs = authRefs();
    refs.passwordAuthError = null;
    refs.submitPasswordAuthBtn = el('button') as HTMLButtonElement;
    const controller = new MasterPasswordController(refs);
    controller.showPasswordAuthModal('export', vi.fn());
    refs.masterPasswordAuthInput!.value = 'wrong-password';
    controller.initEventListeners();
    expect(() => refs.submitPasswordAuthBtn!.click()).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });

  it('falls back through getMessage then result.error then generic text on verify failure', async () => {
    vi.mocked(getMessage).mockReturnValue('' as unknown as string);
    vi.mocked(checkRateLimit).mockResolvedValue({ success: true });
    vi.mocked(verifyMasterPassword).mockResolvedValue({ success: false, error: '' });
    const { MasterPasswordController } = mod;
    const refs = authRefs();
    refs.submitPasswordAuthBtn = el('button') as HTMLButtonElement;
    const controller = new MasterPasswordController(refs);
    controller.showPasswordAuthModal('export', vi.fn());
    refs.masterPasswordAuthInput!.value = 'wrong-password';
    controller.initEventListeners();
    refs.submitPasswordAuthBtn.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(refs.passwordAuthError!.textContent).toBe('Incorrect password.');
  });
});

describe('masterPassword-branches — initEventListeners: enabled-checkbox toggle-off flow', () => {
  let mod: typeof import('../masterPassword.js');

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mod = await import('../masterPassword.js');
    vi.mocked(checkRateLimit).mockResolvedValue({ success: true });
    vi.mocked(verifyMasterPassword).mockResolvedValue({ success: true });
  });

  it('falls back to default removed-message when getMessage returns falsy', async () => {
    vi.mocked(getMessage).mockReturnValue('' as unknown as string);
    const { MasterPasswordController } = mod;
    const refs = emptyDomRefs();
    refs.masterPasswordEnabled = el('input') as HTMLInputElement;
    refs.masterPasswordOptions = el('div');
    refs.passwordAuthModal = el('div');
    refs.masterPasswordAuthInput = el('input') as HTMLInputElement;
    refs.passwordAuthError = el('div');
    refs.submitPasswordAuthBtn = el('button') as HTMLButtonElement;
    refs.masterPasswordWarning = el('div');
    const controller = new MasterPasswordController(refs);
    controller.initEventListeners();

    refs.masterPasswordEnabled.checked = false;
    refs.masterPasswordEnabled.dispatchEvent(new Event('change'));

    refs.masterPasswordAuthInput.value = 'correct-password';
    refs.submitPasswordAuthBtn.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(showStatus).toHaveBeenCalledWith('status', 'Master password removed.', 'success');
    expect(refs.masterPasswordOptions.classList.contains('hidden')).toBe(true);
  });
});

describe('masterPassword-branches — initEventListeners: setMasterPasswordNowBtn with null enabled checkbox', () => {
  let mod: typeof import('../masterPassword.js');

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mod = await import('../masterPassword.js');
    vi.mocked(validatePasswordRequirements).mockReturnValue(null);
    vi.mocked(validatePasswordMatch).mockReturnValue(null);
  });

  it('skips setting checked state when masterPasswordEnabled is null', () => {
    const { MasterPasswordController } = mod;
    const refs = emptyDomRefs();
    refs.masterPasswordEnabled = null;
    refs.setMasterPasswordNowBtn = el('button') as HTMLButtonElement;
    refs.passwordModal = el('div');
    const controller = new MasterPasswordController(refs);
    controller.initEventListeners();
    expect(() => refs.setMasterPasswordNowBtn!.click()).not.toThrow();
    expect(refs.passwordModal.classList.contains('show')).toBe(true);
  });
});

describe('masterPassword-branches — loadSettings null-element branches', () => {
  let mod: typeof import('../masterPassword.js');

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mod = await import('../masterPassword.js');
    vi.mocked(validatePasswordRequirements).mockReturnValue(null);
    vi.mocked(validatePasswordMatch).mockReturnValue(null);
  });

  it('does not throw when masterPasswordEnabled and masterPasswordOptions are null', async () => {
    vi.mocked(isMasterPasswordSet).mockResolvedValue(true);
    const { MasterPasswordController } = mod;
    const refs = emptyDomRefs();
    refs.masterPasswordWarning = el('div');
    const controller = new MasterPasswordController(refs);
    await expect(controller.loadSettings()).resolves.not.toThrow();
    expect(refs.masterPasswordWarning.classList.contains('hidden')).toBe(true);
  });

  it('adds hidden class to masterPasswordOptions when not set', async () => {
    vi.mocked(isMasterPasswordSet).mockResolvedValue(false);
    const { MasterPasswordController } = mod;
    const refs = emptyDomRefs();
    refs.masterPasswordEnabled = el('input') as HTMLInputElement;
    refs.masterPasswordOptions = el('div');
    const controller = new MasterPasswordController(refs);
    await controller.loadSettings();
    expect(refs.masterPasswordEnabled.checked).toBe(false);
    expect(refs.masterPasswordOptions.classList.contains('hidden')).toBe(true);
  });
});
