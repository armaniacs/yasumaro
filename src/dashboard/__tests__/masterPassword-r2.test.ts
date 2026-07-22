// @vitest-environment jsdom
/**
 * masterPassword-r2.test.ts
 * R2: Cover remaining branches — change mode confirmPasswordGroup visibility,
 * closePasswordAuthModal, authenticatePassword empty/error paths,
 * Enter key handler, and updatePasswordStrength with null elements.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/i18n.js', () => ({
  getMessage: vi.fn((key: string) => `i18n_${key}`),
}));

vi.mock('../../popup/settingsUiHelper.js', () => ({
  showStatus: vi.fn(),
}));

vi.mock('../../popup/utils/focusTrap.js', () => ({
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

const mockChromeGet = vi.fn();
const mockChromeSet = vi.fn();
const mockChromeRemove = vi.fn();
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: mockChromeGet,
      set: mockChromeSet,
      remove: mockChromeRemove,
    },
    session: {
      get: vi.fn(() => Promise.resolve({})),
      set: vi.fn(() => Promise.resolve()),
      remove: vi.fn(() => Promise.resolve()),
    },
  },
});

import { showStatus } from '../../popup/settingsUiHelper.js';
import { focusTrapManager } from '../../popup/utils/focusTrap.js';
import {
  setMasterPassword,
  verifyMasterPassword,
  isMasterPasswordSet,
  calculatePasswordStrength,
  validatePasswordRequirements,
  validatePasswordMatch,
} from '../../utils/masterPassword.js';

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function setupFullDOM(): void {
  document.body.innerHTML = [
    '<input type="checkbox" id="masterPasswordEnabled" />',
    '<div id="masterPasswordOptions"></div>',
    '<button id="changeMasterPassword"></button>',
    '<div id="passwordModal">',
    '  <div id="passwordModalTitle"></div>',
    '  <div id="passwordModalDesc"></div>',
    '  <input id="masterPasswordInput" />',
    '  <input id="masterPasswordConfirm" />',
    '  <div id="passwordStrengthError"></div>',
    '  <div id="passwordMatchError"></div>',
    '  <div id="passwordStrength"><div class="strength-fill"></div></div>',
    '  <div id="passwordStrengthText"></div>',
    '  <div id="confirmPasswordGroup"></div>',
    '  <button id="closePasswordModalBtn"></button>',
    '  <button id="cancelPasswordBtn"></button>',
    '  <button id="savePasswordBtn"></button>',
    '</div>',
    '<div id="passwordAuthModal">',
    '  <div id="passwordAuthModalTitle"></div>',
    '  <div id="passwordAuthModalDesc"></div>',
    '  <input id="masterPasswordAuthInput" />',
    '  <div id="passwordAuthError"></div>',
    '  <button id="closePasswordAuthModalBtn"></button>',
    '  <button id="cancelPasswordAuthBtn"></button>',
    '  <button id="submitPasswordAuthBtn"></button>',
    '</div>',
  ].join('\n');
}

function setupDefaultMockValues(): void {
  vi.mocked(calculatePasswordStrength).mockReturnValue({ score: 50, level: 'medium', text: 'Medium' });
  vi.mocked(validatePasswordRequirements).mockReturnValue(null);
  vi.mocked(validatePasswordMatch).mockReturnValue(null);
  vi.mocked(setMasterPassword).mockResolvedValue({ success: true });
  vi.mocked(verifyMasterPassword).mockResolvedValue({ success: true });
  vi.mocked(isMasterPasswordSet).mockResolvedValue(true);
}

describe('masterPassword-r2 — showPasswordModal change mode', () => {
  beforeEach(() => {
    setupDefaultMockValues();
  });

  it('shows confirmPasswordGroup in change mode', async () => {
    setupFullDOM();
    vi.resetModules();
    const { initMasterPasswordSettings } = await import('../masterPassword.js');

    // Simulate change flow: click change button which triggers auth then change modal
    initMasterPasswordSettings();
    // Click change password button to open auth modal
    document.getElementById('changeMasterPassword')!.click();
    // Auth with correct password
    const authInput = document.getElementById('masterPasswordAuthInput') as HTMLInputElement;
    authInput.value = 'current-pw';
    document.getElementById('submitPasswordAuthBtn')!.click();
    await flushPromises();

    const confirmGroup = document.getElementById('confirmPasswordGroup')!;
    expect(confirmGroup.classList.contains('hidden')).toBe(false);
  });
});

describe('masterPassword-r2 — closePasswordAuthModal (via close button)', () => {
  beforeEach(() => {
    setupDefaultMockValues();
    setupFullDOM();
  });

  it('hides auth modal and clears state', async () => {
    vi.resetModules();
    const mod = await import('../masterPassword.js');
    mod.initMasterPasswordSettings();
    mod.showPasswordAuthModal('export', vi.fn());

    document.getElementById('closePasswordAuthModalBtn')!.click();
    await new Promise(r => setTimeout(r, 10));
    const authModal = document.getElementById('passwordAuthModal')!;
    expect(authModal.classList.contains('show')).toBe(false);
    expect(authModal.style.display).toBe('none');
    expect(authModal.classList.contains('hidden')).toBe(true);
    expect(focusTrapManager.release).toHaveBeenCalledWith('trap-id');
  });

  it('clears auth input and error values on close', async () => {
    vi.resetModules();
    const mod = await import('../masterPassword.js');
    mod.initMasterPasswordSettings();
    mod.showPasswordAuthModal('export', vi.fn());

    const authInput = document.getElementById('masterPasswordAuthInput') as HTMLInputElement;
    const authError = document.getElementById('passwordAuthError') as HTMLElement;
    authInput.value = 'old';
    authError.textContent = 'error';

    document.getElementById('closePasswordAuthModalBtn')!.click();
    await new Promise(r => setTimeout(r, 10));
    expect(authInput.value).toBe('');
    expect(authError.textContent).toBe('');
  });

  it('cancel button also closes auth modal', async () => {
    vi.resetModules();
    const mod = await import('../masterPassword.js');
    mod.initMasterPasswordSettings();
    mod.showPasswordAuthModal('export', vi.fn());

    document.getElementById('cancelPasswordAuthBtn')!.click();
    await new Promise(r => setTimeout(r, 10));
    const authModal = document.getElementById('passwordAuthModal')!;
    expect(authModal.classList.contains('show')).toBe(false);
  });
});

describe('masterPassword-r2 — authenticatePassword error paths', () => {
  beforeEach(() => {
    setupDefaultMockValues();
  });

  it('shows error when verifyMasterPassword returns success=false with error', async () => {
    vi.mocked(verifyMasterPassword).mockResolvedValue({ success: false, error: 'Wrong password' });
    setupFullDOM();
    vi.resetModules();
    const { initMasterPasswordSettings, showPasswordAuthModal } = await import('../masterPassword.js');
    initMasterPasswordSettings();
    showPasswordAuthModal('export', vi.fn());

    const authInput = document.getElementById('masterPasswordAuthInput') as HTMLInputElement;
    authInput.value = 'wrong';
    document.getElementById('submitPasswordAuthBtn')!.click();
    await flushPromises();

    const errorEl = document.getElementById('passwordAuthError')!;
    expect(errorEl.textContent).toBe('i18n_passwordIncorrect');
    expect(errorEl.classList.contains('visible')).toBe(true);
  });

  it('shows generic error when verifyMasterPassword returns success=false with no error', async () => {
    vi.mocked(verifyMasterPassword).mockResolvedValue({ success: false });
    setupFullDOM();
    vi.resetModules();
    const { initMasterPasswordSettings, showPasswordAuthModal } = await import('../masterPassword.js');
    initMasterPasswordSettings();
    showPasswordAuthModal('export', vi.fn());

    const authInput = document.getElementById('masterPasswordAuthInput') as HTMLInputElement;
    authInput.value = 'wrong';
    document.getElementById('submitPasswordAuthBtn')!.click();
    await flushPromises();

    const errorEl = document.getElementById('passwordAuthError')!;
    expect(errorEl.textContent).toBe('i18n_passwordIncorrect');
  });

  it('does nothing when masterPasswordAuthInput is null in authenticatePassword', async () => {
    document.body.innerHTML = [
      '<div id="passwordAuthModal"></div>',
      '<button id="submitPasswordAuthBtn"></button>',
    ].join('\n');
    vi.resetModules();
    const { initMasterPasswordSettings, showPasswordAuthModal } = await import('../masterPassword.js');
    initMasterPasswordSettings();
    showPasswordAuthModal('export', vi.fn());
    document.getElementById('submitPasswordAuthBtn')!.click();
    await flushPromises();
    expect(verifyMasterPassword).not.toHaveBeenCalled();
  });
});

describe('masterPassword-r2 — Enter key handling on auth input', () => {
  beforeEach(() => {
    setupDefaultMockValues();
  });

  it('calls authenticatePassword on Enter keypress', async () => {
    setupFullDOM();
    vi.resetModules();
    const { initMasterPasswordSettings, showPasswordAuthModal } = await import('../masterPassword.js');
    initMasterPasswordSettings();
    showPasswordAuthModal('export', vi.fn());

    const authInput = document.getElementById('masterPasswordAuthInput') as HTMLInputElement;
    authInput.value = 'secret';
    authInput.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter' }));
    await flushPromises();
    expect(verifyMasterPassword).toHaveBeenCalledWith('secret', expect.any(Function));
  });

  it('ignores non-Enter keypress on auth input', async () => {
    setupFullDOM();
    vi.resetModules();
    const { initMasterPasswordSettings, showPasswordAuthModal } = await import('../masterPassword.js');
    initMasterPasswordSettings();
    showPasswordAuthModal('export', vi.fn());

    const authInput = document.getElementById('masterPasswordAuthInput') as HTMLInputElement;
    authInput.value = 'secret';
    authInput.dispatchEvent(new KeyboardEvent('keypress', { key: 'Tab' }));
    await flushPromises();
    expect(verifyMasterPassword).not.toHaveBeenCalled();
  });
});

describe('masterPassword-r2 — updatePasswordStrength with null elements', () => {
  beforeEach(() => {
    setupDefaultMockValues();
  });

  it('does not throw when strength bar and text elements are missing', async () => {
    document.body.innerHTML = '<input id="masterPasswordInput" />';
    vi.resetModules();
    const { initMasterPasswordSettings } = await import('../masterPassword.js');
    initMasterPasswordSettings();

    const input = document.getElementById('masterPasswordInput') as HTMLInputElement;
    input.value = 'test';
    expect(() => input.dispatchEvent(new Event('input'))).not.toThrow();
  });
});

describe('masterPassword-r2 — password strength text fallback', () => {
  beforeEach(() => {
    setupDefaultMockValues();
  });

  it('uses result.text when getMessage returns falsy for strength level', async () => {
    const mockGetMessage = vi.fn();
    // Override the i18n mock temporarily
    const i18nModule = await import('../../utils/i18n.js');
    vi.mocked(i18nModule.getMessage).mockReturnValue('' as any);

    vi.mocked(calculatePasswordStrength).mockReturnValue({ score: 90, level: 'strong', text: 'Strong' });

    setupFullDOM();
    vi.resetModules();
    const { initMasterPasswordSettings } = await import('../masterPassword.js');
    initMasterPasswordSettings();

    const input = document.getElementById('masterPasswordInput') as HTMLInputElement;
    input.value = 'StrongPassword1';
    input.dispatchEvent(new Event('input'));

    const text = document.getElementById('passwordStrengthText')!;
    expect(text.textContent).toBe('Strong');
  });
});

describe('masterPassword-r2 — change password: auth modal close on backdrop click', () => {
  beforeEach(() => {
    setupDefaultMockValues();
  });

  it('closes auth modal when clicking backdrop', async () => {
    setupFullDOM();
    vi.resetModules();
    const { initMasterPasswordSettings, showPasswordAuthModal } = await import('../masterPassword.js');
    initMasterPasswordSettings();
    showPasswordAuthModal('export', vi.fn());

    const authModal = document.getElementById('passwordAuthModal')!;
    authModal.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(authModal.classList.contains('hidden')).toBe(true);
    expect(authModal.style.display).toBe('none');
  });
});
