// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../popup/i18n.js', () => ({
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

function openModalViaCheckbox(): void {
  const checkbox = document.getElementById('masterPasswordEnabled') as HTMLInputElement;
  checkbox.checked = true;
  checkbox.dispatchEvent(new Event('change'));
}

describe('loadMasterPasswordSettings', () => {
  beforeEach(() => {
    setupDefaultMockValues();
  });

  it('should enable checkbox and show options when password is set', async () => {
    vi.mocked(isMasterPasswordSet).mockResolvedValue(true);
    document.body.innerHTML = [
      '<input type="checkbox" id="masterPasswordEnabled" />',
      '<div id="masterPasswordOptions"></div>',
    ].join('\n');
    vi.resetModules();
    const { loadMasterPasswordSettings } = await import('../masterPassword.js');

    await loadMasterPasswordSettings();

    const checkbox = document.getElementById('masterPasswordEnabled') as HTMLInputElement;
    const options = document.getElementById('masterPasswordOptions')!;
    expect(checkbox.checked).toBe(true);
    expect(options.classList.contains('hidden')).toBe(false);
  });

  it('should disable checkbox and hide options when password is not set', async () => {
    vi.mocked(isMasterPasswordSet).mockResolvedValue(false);
    document.body.innerHTML = [
      '<input type="checkbox" id="masterPasswordEnabled" />',
      '<div id="masterPasswordOptions"></div>',
    ].join('\n');
    vi.resetModules();
    const { loadMasterPasswordSettings } = await import('../masterPassword.js');

    await loadMasterPasswordSettings();

    const checkbox = document.getElementById('masterPasswordEnabled') as HTMLInputElement;
    const options = document.getElementById('masterPasswordOptions')!;
    expect(checkbox.checked).toBe(false);
    expect(options.classList.contains('hidden')).toBe(true);
  });
});

describe('showPasswordAuthModal', () => {
  beforeEach(() => {
    setupDefaultMockValues();
  });

  it('should show auth modal with proper display properties', async () => {
    setupFullDOM();
    vi.resetModules();
    const { showPasswordAuthModal } = await import('../masterPassword.js');
    const modal = document.getElementById('passwordAuthModal')!;

    showPasswordAuthModal('export', vi.fn());

    expect(modal.classList.contains('hidden')).toBe(false);
    expect(modal.style.display).toBe('flex');
    expect(modal.classList.contains('show')).toBe(true);
  });

  it('should clear previous input value and error when shown', async () => {
    setupFullDOM();
    vi.resetModules();
    const { showPasswordAuthModal } = await import('../masterPassword.js');
    const input = document.getElementById('masterPasswordAuthInput') as HTMLInputElement;
    const error = document.getElementById('passwordAuthError')!;

    input.value = 'old-password';
    error.textContent = 'previous error';

    showPasswordAuthModal('export', vi.fn());

    expect(input.value).toBe('');
    expect(error.textContent).toBe('');
  });

  it('should set a focus trap on the auth modal', async () => {
    setupFullDOM();
    vi.resetModules();
    const { showPasswordAuthModal } = await import('../masterPassword.js');
    const modal = document.getElementById('passwordAuthModal')!;

    showPasswordAuthModal('export', vi.fn());

    expect(focusTrapManager.trap).toHaveBeenCalledWith(modal, expect.any(Function));
  });

  it('should focus the auth input', async () => {
    setupFullDOM();
    vi.resetModules();
    const { showPasswordAuthModal } = await import('../masterPassword.js');
    const input = document.getElementById('masterPasswordAuthInput') as HTMLInputElement;
    const focusSpy = vi.spyOn(input, 'focus');

    showPasswordAuthModal('export', vi.fn());

    expect(focusSpy).toHaveBeenCalled();
  });

  it('should do nothing when passwordAuthModal element is null', async () => {
    document.body.innerHTML = '<div>no auth modal</div>';
    vi.resetModules();
    const { showPasswordAuthModal } = await import('../masterPassword.js');

    expect(() => showPasswordAuthModal('export', vi.fn())).not.toThrow();
  });
});

describe('closePasswordModal', () => {
  beforeEach(() => {
    setupDefaultMockValues();
  });

  it('should hide the modal by removing show, setting display none, adding hidden', async () => {
    setupFullDOM();
    vi.resetModules();
    const { closePasswordModal } = await import('../masterPassword.js');
    const modal = document.getElementById('passwordModal')!;
    modal.classList.add('show');
    modal.style.display = 'flex';

    closePasswordModal();

    expect(modal.classList.contains('show')).toBe(false);
    expect(modal.style.display).toBe('none');
    expect(modal.classList.contains('hidden')).toBe(true);
  });

  it('should release the focus trap', async () => {
    setupFullDOM();
    vi.resetModules();
    const { initMasterPasswordSettings, closePasswordModal } = await import('../masterPassword.js');
    initMasterPasswordSettings();
    openModalViaCheckbox();
    focusTrapManager.trap.mockClear();

    closePasswordModal();

    expect(focusTrapManager.release).toHaveBeenCalledWith('trap-id');
  });

  it('should clear input values and errors', async () => {
    setupFullDOM();
    vi.resetModules();
    const { closePasswordModal } = await import('../masterPassword.js');
    const pwInput = document.getElementById('masterPasswordInput') as HTMLInputElement;
    const confirmInput = document.getElementById('masterPasswordConfirm') as HTMLInputElement;
    const strengthError = document.getElementById('passwordStrengthError')!;
    const matchError = document.getElementById('passwordMatchError')!;

    pwInput.value = 'secret123';
    confirmInput.value = 'secret123';
    strengthError.textContent = 'too weak';
    matchError.textContent = 'no match';

    closePasswordModal();

    expect(pwInput.value).toBe('');
    expect(confirmInput.value).toBe('');
    expect(strengthError.textContent).toBe('');
    expect(matchError.textContent).toBe('');
  });

  it('should reset password strength display via updatePasswordStrength', async () => {
    setupFullDOM();
    vi.resetModules();
    const { closePasswordModal } = await import('../masterPassword.js');
    const bar = document.querySelector('#passwordStrength .strength-fill') as HTMLElement;
    bar.style.width = '80%';
    bar.className = 'strength-fill strong';

    closePasswordModal();

    expect(bar.style.width).toBe('0%');
    expect(bar.className).toBe('strength-fill');
  });

  it('should do nothing when passwordModal element is null', async () => {
    document.body.innerHTML = '<div>no modal</div>';
    vi.resetModules();
    const { closePasswordModal } = await import('../masterPassword.js');

    expect(() => closePasswordModal()).not.toThrow();
  });
});

describe('initMasterPasswordSettings - checkbox events', () => {
  beforeEach(() => {
    setupDefaultMockValues();
  });

  it('should show password modal when checkbox is checked', async () => {
    setupFullDOM();
    vi.resetModules();
    const { initMasterPasswordSettings } = await import('../masterPassword.js');

    initMasterPasswordSettings();
    openModalViaCheckbox();

    const modal = document.getElementById('passwordModal')!;
    expect(modal.classList.contains('hidden')).toBe(false);
    expect(modal.style.display).toBe('flex');
    expect(modal.classList.contains('show')).toBe(true);
  });

  it('should remove storage keys, hide options, and show success when checkbox is unchecked', async () => {
    setupFullDOM();
    vi.resetModules();
    const { initMasterPasswordSettings } = await import('../masterPassword.js');

    initMasterPasswordSettings();

    const checkbox = document.getElementById('masterPasswordEnabled') as HTMLInputElement;
    const options = document.getElementById('masterPasswordOptions')!;

    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));

    await flushPromises();

    expect(mockChromeRemove).toHaveBeenCalledWith([
      'master_password_enabled',
      'master_password_salt',
      'master_password_hash',
    ]);
    expect(options.classList.contains('hidden')).toBe(true);
    expect(showStatus).toHaveBeenCalledWith('status', 'i18n_passwordRemoved', 'success');
  });
});

describe('initMasterPasswordSettings - change password flow', () => {
  beforeEach(() => {
    setupDefaultMockValues();
  });

  it('should show auth modal when change password button is clicked', async () => {
    setupFullDOM();
    vi.resetModules();
    const { initMasterPasswordSettings } = await import('../masterPassword.js');

    initMasterPasswordSettings();

    document.getElementById('changeMasterPassword')!.click();

    const authModal = document.getElementById('passwordAuthModal')!;
    expect(authModal.classList.contains('hidden')).toBe(false);
    expect(authModal.style.display).toBe('flex');
  });

  it('should show change password modal after successful authentication', async () => {
    vi.mocked(verifyMasterPassword).mockResolvedValue({ success: true });

    setupFullDOM();
    vi.resetModules();
    const { initMasterPasswordSettings } = await import('../masterPassword.js');

    initMasterPasswordSettings();

    document.getElementById('changeMasterPassword')!.click();

    const authInput = document.getElementById('masterPasswordAuthInput') as HTMLInputElement;
    authInput.value = 'current-password';
    document.getElementById('submitPasswordAuthBtn')!.click();

    await flushPromises();

    const passwordModal = document.getElementById('passwordModal')!;
    expect(passwordModal.classList.contains('hidden')).toBe(false);
    expect(passwordModal.style.display).toBe('flex');

    const title = document.getElementById('passwordModalTitle')!;
    expect(title.textContent).toBe('i18n_changeMasterPassword');
  });
});

describe('initMasterPasswordSettings - password strength input', () => {
  beforeEach(() => {
    setupDefaultMockValues();
  });

  it('should call updatePasswordStrength when masterPasswordInput receives input', async () => {
    setupFullDOM();
    vi.resetModules();
    const { initMasterPasswordSettings } = await import('../masterPassword.js');

    initMasterPasswordSettings();

    const input = document.getElementById('masterPasswordInput') as HTMLInputElement;
    input.value = 'testPassword123';
    input.dispatchEvent(new Event('input'));

    expect(calculatePasswordStrength).toHaveBeenCalledWith('testPassword123');
  });

  it('should update the strength bar and text based on calculatePasswordStrength result', async () => {
    vi.mocked(calculatePasswordStrength).mockReturnValue({ score: 75, level: 'medium', text: 'Medium' });

    setupFullDOM();
    vi.resetModules();
    const { initMasterPasswordSettings } = await import('../masterPassword.js');

    initMasterPasswordSettings();

    const input = document.getElementById('masterPasswordInput') as HTMLInputElement;
    const bar = document.querySelector('#passwordStrength .strength-fill') as HTMLElement;
    const text = document.getElementById('passwordStrengthText')!;

    input.value = 'somePassword1';
    input.dispatchEvent(new Event('input'));

    expect(bar.style.width).toBe('75%');
    expect(bar.className).toBe('strength-fill medium');
    expect(text.textContent).toBe('i18n_passwordStrengthMedium');
  });
});

describe('initMasterPasswordSettings - modal button events', () => {
  beforeEach(() => {
    setupDefaultMockValues();
  });

  it('should close password modal when close button is clicked', async () => {
    setupFullDOM();
    vi.resetModules();
    const { initMasterPasswordSettings } = await import('../masterPassword.js');

    initMasterPasswordSettings();
    openModalViaCheckbox();

    const modal = document.getElementById('passwordModal')!;
    expect(modal.classList.contains('hidden')).toBe(false);

    document.getElementById('closePasswordModalBtn')!.click();

    expect(modal.classList.contains('hidden')).toBe(true);
    expect(modal.style.display).toBe('none');
  });

  it('should close password modal when cancel button is clicked', async () => {
    setupFullDOM();
    vi.resetModules();
    const { initMasterPasswordSettings } = await import('../masterPassword.js');

    initMasterPasswordSettings();
    openModalViaCheckbox();

    document.getElementById('cancelPasswordBtn')!.click();

    const modal = document.getElementById('passwordModal')!;
    expect(modal.classList.contains('hidden')).toBe(true);
    expect(modal.style.display).toBe('none');
  });

  it('should trigger savePassword when save button is clicked', async () => {
    setupFullDOM();
    vi.resetModules();
    const { initMasterPasswordSettings } = await import('../masterPassword.js');

    initMasterPasswordSettings();
    const input = document.getElementById('masterPasswordInput') as HTMLInputElement;
    const confirm = document.getElementById('masterPasswordConfirm') as HTMLInputElement;
    input.value = 'ValidP@ss1';
    confirm.value = 'ValidP@ss1';

    document.getElementById('savePasswordBtn')!.click();

    await flushPromises();

    expect(setMasterPassword).toHaveBeenCalled();
  });
});

describe('initMasterPasswordSettings - click outside to close', () => {
  beforeEach(() => {
    setupDefaultMockValues();
  });

  it('should close password modal when clicking on the modal backdrop', async () => {
    setupFullDOM();
    vi.resetModules();
    const { initMasterPasswordSettings } = await import('../masterPassword.js');

    initMasterPasswordSettings();
    openModalViaCheckbox();

    const modal = document.getElementById('passwordModal')!;

    modal.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(modal.classList.contains('hidden')).toBe(true);
    expect(modal.style.display).toBe('none');
  });

  it('should not close password modal when clicking on a child element', async () => {
    setupFullDOM();
    vi.resetModules();
    const { initMasterPasswordSettings } = await import('../masterPassword.js');

    initMasterPasswordSettings();
    openModalViaCheckbox();

    const modal = document.getElementById('passwordModal')!;
    expect(modal.style.display).toBe('flex');

    const title = document.getElementById('passwordModalTitle')!;
    title.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(modal.style.display).toBe('flex');
  });
});

describe('initMasterPasswordSettings - auth modal events', () => {
  beforeEach(() => {
    setupDefaultMockValues();
  });

  it('should close auth modal when close button is clicked', async () => {
    setupFullDOM();
    vi.resetModules();
    const { initMasterPasswordSettings, showPasswordAuthModal } = await import('../masterPassword.js');

    initMasterPasswordSettings();
    showPasswordAuthModal('export', vi.fn());

    document.getElementById('closePasswordAuthModalBtn')!.click();

    const authModal = document.getElementById('passwordAuthModal')!;
    expect(authModal.classList.contains('hidden')).toBe(true);
    expect(authModal.style.display).toBe('none');
  });

  it('should close auth modal when cancel button is clicked', async () => {
    setupFullDOM();
    vi.resetModules();
    const { initMasterPasswordSettings, showPasswordAuthModal } = await import('../masterPassword.js');

    initMasterPasswordSettings();
    showPasswordAuthModal('export', vi.fn());

    document.getElementById('cancelPasswordAuthBtn')!.click();

    const authModal = document.getElementById('passwordAuthModal')!;
    expect(authModal.classList.contains('hidden')).toBe(true);
    expect(authModal.style.display).toBe('none');
  });

  it('should trigger authenticatePassword when submit button is clicked', async () => {
    setupFullDOM();
    vi.resetModules();
    const { initMasterPasswordSettings, showPasswordAuthModal } = await import('../masterPassword.js');

    initMasterPasswordSettings();
    showPasswordAuthModal('export', vi.fn());

    const authInput = document.getElementById('masterPasswordAuthInput') as HTMLInputElement;
    authInput.value = 'mypassword';
    document.getElementById('submitPasswordAuthBtn')!.click();

    await flushPromises();

    expect(verifyMasterPassword).toHaveBeenCalledWith('mypassword', expect.any(Function));
  });

  it('should trigger authenticatePassword when Enter key is pressed on auth input', async () => {
    setupFullDOM();
    vi.resetModules();
    const { initMasterPasswordSettings, showPasswordAuthModal } = await import('../masterPassword.js');

    initMasterPasswordSettings();
    showPasswordAuthModal('export', vi.fn());

    const authInput = document.getElementById('masterPasswordAuthInput') as HTMLInputElement;
    authInput.value = 'mypassword';

    authInput.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter' }));

    await flushPromises();

    expect(verifyMasterPassword).toHaveBeenCalledWith('mypassword', expect.any(Function));
  });

  it('should close auth modal when clicking on the modal backdrop', async () => {
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

  it('should not close auth modal when clicking on a child element', async () => {
    setupFullDOM();
    vi.resetModules();
    const { initMasterPasswordSettings, showPasswordAuthModal } = await import('../masterPassword.js');

    initMasterPasswordSettings();
    showPasswordAuthModal('export', vi.fn());

    const authModal = document.getElementById('passwordAuthModal')!;
    expect(authModal.style.display).toBe('flex');

    const authTitle = document.getElementById('passwordAuthModalTitle')!;
    authTitle.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(authModal.style.display).toBe('flex');
  });
});

describe('savePassword flow', () => {
  beforeEach(() => {
    setupDefaultMockValues();
  });

  it('should show validation error when validatePasswordRequirements fails', async () => {
    vi.mocked(validatePasswordRequirements).mockReturnValue('Password too short');

    setupFullDOM();
    vi.resetModules();
    const { initMasterPasswordSettings } = await import('../masterPassword.js');

    initMasterPasswordSettings();

    const input = document.getElementById('masterPasswordInput') as HTMLInputElement;
    input.value = 'short';

    document.getElementById('savePasswordBtn')!.click();

    await flushPromises();

    const errorEl = document.getElementById('passwordStrengthError')!;
    expect(errorEl.textContent).toBe('i18n_passwordTooShort');
    expect(errorEl.classList.contains('visible')).toBe(true);
    expect(setMasterPassword).not.toHaveBeenCalled();
  });

  it('should show match error when passwords do not match in set mode', async () => {
    vi.mocked(validatePasswordMatch).mockReturnValue('Passwords do not match');

    setupFullDOM();
    vi.resetModules();
    const { initMasterPasswordSettings } = await import('../masterPassword.js');

    initMasterPasswordSettings();

    const input = document.getElementById('masterPasswordInput') as HTMLInputElement;
    const confirm = document.getElementById('masterPasswordConfirm') as HTMLInputElement;
    input.value = 'ValidP@ss1';
    confirm.value = 'DifferentP@ss1';

    document.getElementById('savePasswordBtn')!.click();

    await flushPromises();

    const matchError = document.getElementById('passwordMatchError')!;
    expect(matchError.textContent).toBe('i18n_passwordMismatch');
    expect(matchError.classList.contains('visible')).toBe(true);
    expect(setMasterPassword).not.toHaveBeenCalled();
  });

  it('should save password successfully and update UI', async () => {
    vi.mocked(setMasterPassword).mockResolvedValue({ success: true });

    setupFullDOM();
    vi.resetModules();
    const { initMasterPasswordSettings } = await import('../masterPassword.js');

    initMasterPasswordSettings();

    const input = document.getElementById('masterPasswordInput') as HTMLInputElement;
    const confirm = document.getElementById('masterPasswordConfirm') as HTMLInputElement;
    input.value = 'ValidP@ss1';
    confirm.value = 'ValidP@ss1';

    document.getElementById('savePasswordBtn')!.click();

    await flushPromises();

    expect(showStatus).toHaveBeenCalledWith('status', 'i18n_passwordSaved', 'success');

    const modal = document.getElementById('passwordModal')!;
    expect(modal.classList.contains('hidden')).toBe(true);
    expect(modal.style.display).toBe('none');

    const checkbox = document.getElementById('masterPasswordEnabled') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);

    const options = document.getElementById('masterPasswordOptions')!;
    expect(options.classList.contains('hidden')).toBe(false);
  });

  it('should show error status when setMasterPassword fails', async () => {
    vi.mocked(setMasterPassword).mockResolvedValue({ success: false, error: 'Storage error' });

    setupFullDOM();
    vi.resetModules();
    const { initMasterPasswordSettings } = await import('../masterPassword.js');

    initMasterPasswordSettings();

    const input = document.getElementById('masterPasswordInput') as HTMLInputElement;
    input.value = 'ValidP@ss1';

    document.getElementById('savePasswordBtn')!.click();

    await flushPromises();

    expect(showStatus).toHaveBeenCalledWith('status', 'Storage error', 'error');
  });

  it('should show generic error message when setMasterPassword fails with no error text', async () => {
    vi.mocked(setMasterPassword).mockResolvedValue({ success: false });

    setupFullDOM();
    vi.resetModules();
    const { initMasterPasswordSettings } = await import('../masterPassword.js');

    initMasterPasswordSettings();

    const input = document.getElementById('masterPasswordInput') as HTMLInputElement;
    input.value = 'ValidP@ss1';

    document.getElementById('savePasswordBtn')!.click();

    await flushPromises();

    expect(showStatus).toHaveBeenCalledWith('status', 'Failed to save password.', 'error');
  });

  it('should do nothing when masterPasswordInput element is null', async () => {
    document.body.innerHTML = [
      '<div id="passwordModal"></div>',
      '<input id="masterPasswordConfirm" />',
      '<button id="savePasswordBtn"></button>',
    ].join('\n');
    vi.resetModules();
    const { initMasterPasswordSettings } = await import('../masterPassword.js');

    initMasterPasswordSettings();

    document.getElementById('savePasswordBtn')!.click();

    await flushPromises();

    expect(setMasterPassword).not.toHaveBeenCalled();
  });
});

describe('authenticatePassword flow', () => {
  beforeEach(() => {
    setupDefaultMockValues();
  });

  it('should show error when password is empty', async () => {
    setupFullDOM();
    vi.resetModules();
    const { initMasterPasswordSettings, showPasswordAuthModal } = await import('../masterPassword.js');

    initMasterPasswordSettings();
    showPasswordAuthModal('export', vi.fn());

    document.getElementById('submitPasswordAuthBtn')!.click();

    await flushPromises();

    const errorEl = document.getElementById('passwordAuthError')!;
    expect(errorEl.textContent).toBe('i18n_passwordRequired');
    expect(errorEl.classList.contains('visible')).toBe(true);
    expect(verifyMasterPassword).not.toHaveBeenCalled();
  });

  it('should call verifyMasterPassword and close modal on success', async () => {
    vi.mocked(verifyMasterPassword).mockResolvedValue({ success: true });

    setupFullDOM();
    vi.resetModules();
    const { initMasterPasswordSettings, showPasswordAuthModal } = await import('../masterPassword.js');

    initMasterPasswordSettings();
    showPasswordAuthModal('export', vi.fn());

    const authInput = document.getElementById('masterPasswordAuthInput') as HTMLInputElement;
    authInput.value = 'correct-password';
    document.getElementById('submitPasswordAuthBtn')!.click();

    await flushPromises();

    expect(verifyMasterPassword).toHaveBeenCalledWith('correct-password', expect.any(Function));

    const authModal = document.getElementById('passwordAuthModal')!;
    expect(authModal.classList.contains('hidden')).toBe(true);
    expect(authModal.style.display).toBe('none');
  });

  it('should call the pending action on successful authentication', async () => {
    vi.mocked(verifyMasterPassword).mockResolvedValue({ success: true });

    setupFullDOM();
    vi.resetModules();
    const { initMasterPasswordSettings, showPasswordAuthModal } = await import('../masterPassword.js');

    initMasterPasswordSettings();
    const action = vi.fn();
    showPasswordAuthModal('export', action);

    const authInput = document.getElementById('masterPasswordAuthInput') as HTMLInputElement;
    authInput.value = 'correct-password';
    document.getElementById('submitPasswordAuthBtn')!.click();

    await flushPromises();

    expect(action).toHaveBeenCalledWith('correct-password');
  });

  it('should show error when verifyMasterPassword fails', async () => {
    vi.mocked(verifyMasterPassword).mockResolvedValue({ success: false, error: 'Incorrect password' });

    setupFullDOM();
    vi.resetModules();
    const { initMasterPasswordSettings, showPasswordAuthModal } = await import('../masterPassword.js');

    initMasterPasswordSettings();
    showPasswordAuthModal('export', vi.fn());

    const authInput = document.getElementById('masterPasswordAuthInput') as HTMLInputElement;
    authInput.value = 'wrong-password';
    document.getElementById('submitPasswordAuthBtn')!.click();

    await flushPromises();

    const errorEl = document.getElementById('passwordAuthError')!;
    expect(errorEl.textContent).toBe('i18n_passwordIncorrect');
    expect(errorEl.classList.contains('visible')).toBe(true);
  });

  it('should do nothing when masterPasswordAuthInput element is null', async () => {
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

describe('updatePasswordStrength behavior', () => {
  beforeEach(() => {
    setupDefaultMockValues();
  });

  it('should set 0% width and Weak text for empty password', async () => {
    setupFullDOM();
    vi.resetModules();
    const { initMasterPasswordSettings } = await import('../masterPassword.js');

    initMasterPasswordSettings();

    const input = document.getElementById('masterPasswordInput') as HTMLInputElement;
    input.value = '';
    input.dispatchEvent(new Event('input'));

    const bar = document.querySelector('#passwordStrength .strength-fill') as HTMLElement;
    const text = document.getElementById('passwordStrengthText')!;

    expect(bar.style.width).toBe('0%');
    expect(bar.className).toBe('strength-fill');
    expect(text.textContent).toBe('i18n_passwordStrengthWeak');
  });

  it('should use calculatePasswordStrength result for non-empty password', async () => {
    vi.mocked(calculatePasswordStrength).mockReturnValue({ score: 90, level: 'strong', text: 'Strong' });

    setupFullDOM();
    vi.resetModules();
    const { initMasterPasswordSettings } = await import('../masterPassword.js');

    initMasterPasswordSettings();

    const input = document.getElementById('masterPasswordInput') as HTMLInputElement;
    input.value = 'VeryStrongP@ssword1';
    input.dispatchEvent(new Event('input'));

    const bar = document.querySelector('#passwordStrength .strength-fill') as HTMLElement;
    const text = document.getElementById('passwordStrengthText')!;

    expect(bar.style.width).toBe('90%');
    expect(bar.className).toBe('strength-fill strong');
    expect(text.textContent).toBe('i18n_passwordStrengthStrong');
  });

  it('should fall back to result.text when getMessage returns falsy', async () => {
    vi.mocked(calculatePasswordStrength).mockReturnValue({ score: 100, level: 'strong', text: 'Strong' });

    setupFullDOM();
    vi.resetModules();
    const { initMasterPasswordSettings } = await import('../masterPassword.js');

    initMasterPasswordSettings();

    const input = document.getElementById('masterPasswordInput') as HTMLInputElement;
    input.value = 'SuperSecureP@ss1';
    input.dispatchEvent(new Event('input'));

    const text = document.getElementById('passwordStrengthText')!;
    expect(text.textContent).toBe('i18n_passwordStrengthStrong');
  });

  it('should do nothing when strength bar or text elements are null', async () => {
    document.body.innerHTML = [
      '<input type="checkbox" id="masterPasswordEnabled" />',
      '<input id="masterPasswordInput" />',
      '<button id="savePasswordBtn"></button>',
    ].join('\n');
    vi.resetModules();
    const { initMasterPasswordSettings } = await import('../masterPassword.js');

    initMasterPasswordSettings();

    const input = document.getElementById('masterPasswordInput') as HTMLInputElement;
    input.value = 'SomePassword';

    expect(() => {
      input.dispatchEvent(new Event('input'));
    }).not.toThrow();
  });
});

describe('showPasswordModal (via checkbox)', () => {
  beforeEach(() => {
    setupDefaultMockValues();
  });

  it('should set modal title to set mode when checkbox is checked', async () => {
    setupFullDOM();
    vi.resetModules();
    const { initMasterPasswordSettings } = await import('../masterPassword.js');

    initMasterPasswordSettings();
    openModalViaCheckbox();

    const title = document.getElementById('passwordModalTitle')!;
    expect(title.textContent).toBe('i18n_setMasterPassword');
    const desc = document.getElementById('passwordModalDesc')!;
    expect(desc.textContent).toBe('i18n_setMasterPasswordDesc');
  });

  it('should clear password inputs and errors when modal is shown', async () => {
    setupFullDOM();
    vi.resetModules();
    const { initMasterPasswordSettings } = await import('../masterPassword.js');

    initMasterPasswordSettings();

    const input = document.getElementById('masterPasswordInput') as HTMLInputElement;
    const confirm = document.getElementById('masterPasswordConfirm') as HTMLInputElement;
    input.value = 'leftover';
    confirm.value = 'leftover';

    openModalViaCheckbox();

    expect(input.value).toBe('');
    expect(confirm.value).toBe('');
  });

  it('should set focus trap on password modal when shown', async () => {
    setupFullDOM();
    vi.resetModules();
    const { initMasterPasswordSettings } = await import('../masterPassword.js');

    initMasterPasswordSettings();
    openModalViaCheckbox();

    const modal = document.getElementById('passwordModal')!;
    expect(focusTrapManager.trap).toHaveBeenCalledWith(modal, expect.any(Function));
  });

  it('should focus the password input when modal is shown', async () => {
    setupFullDOM();
    vi.resetModules();
    const { initMasterPasswordSettings } = await import('../masterPassword.js');

    initMasterPasswordSettings();

    const input = document.getElementById('masterPasswordInput') as HTMLInputElement;
    const focusSpy = vi.spyOn(input, 'focus');

    openModalViaCheckbox();

    expect(focusSpy).toHaveBeenCalled();
  });
});
