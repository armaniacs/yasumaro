// @vitest-environment jsdom
/**
 * masterPasswordUi.test.ts
 * Tests for src/popup/masterPasswordUi.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../utils/storage.js', () => ({
  getSettings: vi.fn().mockResolvedValue({}),
  saveSettingsWithAllowedUrls: vi.fn().mockResolvedValue(undefined),
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
  checkRateLimit: vi.fn().mockResolvedValue({ success: true }),
  recordFailedAttempt: vi.fn(),
  resetFailedAttempts: vi.fn(),
}));

vi.mock('../settingsUiHelper.js', () => ({
  showStatus: vi.fn(),
}));

vi.mock('../i18n.js', () => ({
  getMessage: vi.fn((key: string) => `i18n_${key}`),
}));

vi.mock('../utils/focusTrap.js', () => ({
  focusTrapManager: {
    trap: vi.fn().mockReturnValue('trap-id'),
    release: vi.fn(),
  },
}));

const WAIT = { timeout: 2000, interval: 20 };

function setupDOM(): void {
  document.body.innerHTML = [
    '<input type="checkbox" id="masterPasswordEnabled" />',
    '<div id="masterPasswordOptions" class="hidden"></div>',
    '<button id="changeMasterPassword"></button>',
    '<div id="passwordModal">',
    '  <div id="passwordModalTitle"></div><div id="passwordModalDesc"></div>',
    '  <input id="masterPasswordInput" /><input id="masterPasswordConfirm" />',
    '  <div id="passwordStrengthError"></div><div id="passwordMatchError"></div>',
    '  <div id="passwordStrength"><div class="strength-fill"></div></div>',
    '  <div id="passwordStrengthText"></div><div id="confirmPasswordGroup"></div>',
    '  <button id="closePasswordModalBtn"></button>',
    '  <button id="cancelPasswordBtn"></button>',
    '  <button id="savePasswordBtn"></button>',
    '</div>',
    '<div id="passwordAuthModal">',
    '  <div id="passwordAuthModalTitle"></div><div id="passwordAuthModalDesc"></div>',
    '  <input id="masterPasswordAuthInput" /><div id="passwordAuthError"></div>',
    '  <button id="closePasswordAuthModalBtn"></button>',
    '  <button id="cancelPasswordAuthBtn"></button>',
    '  <button id="submitPasswordAuthBtn"></button>',
    '</div>',
  ].join('');
}

describe('masterPasswordUi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    document.body.innerHTML = '';
  });

  // =========================================================================
  // loadMasterPasswordSettings
  // =========================================================================
  describe('loadMasterPasswordSettings', () => {
    it('should check checkbox and show options when password is set', async () => {
      const isSet = (await import('../../utils/masterPassword.js')).isMasterPasswordSet;
      (isSet as any).mockResolvedValue(true);

      setupDOM();
      const { loadMasterPasswordSettings } = await import('../masterPasswordUi.js');
      await loadMasterPasswordSettings();

      const cb = document.getElementById('masterPasswordEnabled') as HTMLInputElement;
      const opts = document.getElementById('masterPasswordOptions') as HTMLElement;
      expect(cb.checked).toBe(true);
      expect(opts.classList.contains('hidden')).toBe(false);
    });

    it('should uncheck checkbox and hide options when password is not set', async () => {
      const isSet = (await import('../../utils/masterPassword.js')).isMasterPasswordSet;
      (isSet as any).mockResolvedValue(false);

      setupDOM();
      const { loadMasterPasswordSettings } = await import('../masterPasswordUi.js');
      await loadMasterPasswordSettings();

      const cb = document.getElementById('masterPasswordEnabled') as HTMLInputElement;
      const opts = document.getElementById('masterPasswordOptions') as HTMLElement;
      expect(cb.checked).toBe(false);
      expect(opts.classList.contains('hidden')).toBe(true);
    });

    it('should handle missing DOM elements gracefully', async () => {
      const isSet = (await import('../../utils/masterPassword.js')).isMasterPasswordSet;
      (isSet as any).mockResolvedValue(true);

      const { loadMasterPasswordSettings } = await import('../masterPasswordUi.js');
      await expect(loadMasterPasswordSettings()).resolves.not.toThrow();
    });
  });

  // =========================================================================
  // showPasswordAuthModal
  // =========================================================================
  describe('showPasswordAuthModal', () => {
    it('should show auth modal by removing hidden class and setting display flex', async () => {
      setupDOM();
      const { showPasswordAuthModal } = await import('../masterPasswordUi.js');

      const modal = document.getElementById('passwordAuthModal') as HTMLElement;
      modal.classList.add('hidden');
      modal.style.display = 'none';

      showPasswordAuthModal('export', vi.fn());

      expect(modal.classList.contains('hidden')).toBe(false);
      expect(modal.style.display).toBe('flex');
      expect(modal.classList.contains('show')).toBe(true);
    });

    it('should set focus trap on auth modal', async () => {
      const ft = (await import('../utils/focusTrap.js')).focusTrapManager;

      setupDOM();
      const { showPasswordAuthModal } = await import('../masterPasswordUi.js');

      const modal = document.getElementById('passwordAuthModal') as HTMLElement;
      showPasswordAuthModal('export', vi.fn());

      expect(ft.trap).toHaveBeenCalledWith(modal, expect.any(Function));
    });

    it('should focus the auth input', async () => {
      setupDOM();
      const { showPasswordAuthModal } = await import('../masterPasswordUi.js');

      const input = document.getElementById('masterPasswordAuthInput') as HTMLInputElement;
      const spy = vi.spyOn(input, 'focus');

      showPasswordAuthModal('export', vi.fn());

      expect(spy).toHaveBeenCalled();
    });

    it('should clear previous input value and error', async () => {
      setupDOM();
      const { showPasswordAuthModal } = await import('../masterPasswordUi.js');

      const input = document.getElementById('masterPasswordAuthInput') as HTMLInputElement;
      const err = document.getElementById('passwordAuthError') as HTMLElement;
      input.value = 'secret';
      err.textContent = 'error';

      showPasswordAuthModal('export', vi.fn());

      expect(input.value).toBe('');
      expect(err.textContent).toBe('');
    });

    it('should do nothing when auth modal element is missing', async () => {
      const { showPasswordAuthModal } = await import('../masterPasswordUi.js');
      expect(() => showPasswordAuthModal('export', vi.fn())).not.toThrow();
    });
  });

  // =========================================================================
  // initMasterPasswordUi — event listeners
  // =========================================================================
  describe('initMasterPasswordUi', () => {
    it('should attach change listener on enable checkbox', async () => {
      setupDOM();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      const cb = document.getElementById('masterPasswordEnabled') as HTMLInputElement;
      expect(cb).toBeTruthy();
    });

    it('should show set password modal when checkbox is checked', async () => {
      setupDOM();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      const cb = document.getElementById('masterPasswordEnabled') as HTMLInputElement;
      const modal = document.getElementById('passwordModal') as HTMLElement;

      cb.checked = true;
      cb.dispatchEvent(new Event('change'));

      expect(modal.classList.contains('hidden')).toBe(false);
      expect(modal.style.display).toBe('flex');
    });

    it('should requeue disabling and show auth modal when checkbox is unchecked', async () => {
      setupDOM();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      const cb = document.getElementById('masterPasswordEnabled') as HTMLInputElement;
      cb.checked = false;
      cb.dispatchEvent(new Event('change'));

      expect(cb.checked).toBe(true);

      const authModal = document.getElementById('passwordAuthModal') as HTMLElement;
      expect(authModal.classList.contains('hidden')).toBe(false);
    });

    it('should change password button show auth modal', async () => {
      setupDOM();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      document.getElementById('changeMasterPassword')!.click();

      const authModal = document.getElementById('passwordAuthModal') as HTMLElement;
      expect(authModal.classList.contains('hidden')).toBe(false);
    });

    it('should update password strength on input event', async () => {
      const mp = await import('../../utils/masterPassword.js');
      (mp.calculatePasswordStrength as any).mockReturnValue({ score: 60, level: 'medium', text: 'Medium' });

      setupDOM();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      const input = document.getElementById('masterPasswordInput') as HTMLInputElement;
      input.value = 'test123';
      input.dispatchEvent(new Event('input'));

      expect(mp.calculatePasswordStrength).toHaveBeenCalledWith('test123');
    });

    it('should close password modal on close button click', async () => {
      setupDOM();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      const modal = document.getElementById('passwordModal') as HTMLElement;
      modal.classList.remove('hidden');
      modal.style.display = 'flex';

      document.getElementById('closePasswordModalBtn')!.click();

      expect(modal.style.display).toBe('none');
      expect(modal.classList.contains('hidden')).toBe(true);
    });

    it('should close password modal on cancel button click', async () => {
      setupDOM();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      const modal = document.getElementById('passwordModal') as HTMLElement;
      modal.classList.remove('hidden');
      modal.style.display = 'flex';

      document.getElementById('cancelPasswordBtn')!.click();

      expect(modal.style.display).toBe('none');
    });

    it('should call savePassword on save button click', async () => {
      const mp = await import('../../utils/masterPassword.js');
      (mp.validatePasswordRequirements as any).mockReturnValue(null);
      (mp.setMasterPassword as any).mockResolvedValue({ success: true });

      setupDOM();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      (document.getElementById('masterPasswordInput') as HTMLInputElement).value = 'strong';
      document.getElementById('savePasswordBtn')!.click();

      await vi.waitFor(() => {
        expect(mp.validatePasswordRequirements).toHaveBeenCalledWith('strong');
      }, WAIT);
    });

    it('should close password modal when clicking outside', async () => {
      setupDOM();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      const modal = document.getElementById('passwordModal') as HTMLElement;
      modal.classList.remove('hidden');
      modal.style.display = 'flex';
      modal.classList.add('show');

      modal.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(modal.style.display).toBe('none');
      expect(modal.classList.contains('hidden')).toBe(true);
    });

    it('should not close password modal when clicking inside content', async () => {
      setupDOM();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      const modal = document.getElementById('passwordModal') as HTMLElement;
      const title = document.getElementById('passwordModalTitle') as HTMLElement;
      modal.classList.remove('hidden');
      modal.style.display = 'flex';
      modal.classList.add('show');

      title.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(modal.style.display).toBe('flex');
    });

    it('should close auth modal on close button click', async () => {
      setupDOM();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      const modal = document.getElementById('passwordAuthModal') as HTMLElement;
      modal.classList.remove('hidden');
      modal.style.display = 'flex';

      document.getElementById('closePasswordAuthModalBtn')!.click();

      expect(modal.style.display).toBe('none');
      expect(modal.classList.contains('hidden')).toBe(true);
    });

    it('should close auth modal on cancel button click', async () => {
      setupDOM();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      const modal = document.getElementById('passwordAuthModal') as HTMLElement;
      modal.classList.remove('hidden');
      modal.style.display = 'flex';

      document.getElementById('cancelPasswordAuthBtn')!.click();

      expect(modal.style.display).toBe('none');
    });

    it('should call authenticatePassword on submit button click', async () => {
      const mp = await import('../../utils/masterPassword.js');
      const rl = await import('../../utils/rateLimiter.js');
      (rl.checkRateLimit as any).mockReset();
      (rl.checkRateLimit as any).mockResolvedValue({ success: true });
      (mp.verifyMasterPassword as any).mockReset().mockResolvedValue({ success: true });

      setupDOM();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      (document.getElementById('masterPasswordAuthInput') as HTMLInputElement).value = 'valid';
      document.getElementById('submitPasswordAuthBtn')!.click();

      await vi.waitFor(() => {
        expect(mp.verifyMasterPassword).toHaveBeenCalledWith('valid', expect.any(Function));
      }, WAIT);
    });

    it('should call authenticatePassword on Enter key in auth input', async () => {
      const mp = await import('../../utils/masterPassword.js');
      const rl = await import('../../utils/rateLimiter.js');
      (rl.checkRateLimit as any).mockReset().mockResolvedValue({ success: true });
      (mp.verifyMasterPassword as any).mockReset().mockResolvedValue({ success: true });

      setupDOM();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      (document.getElementById('masterPasswordAuthInput') as HTMLInputElement).value = 'enterpass';
      document.getElementById('masterPasswordAuthInput')!.dispatchEvent(
        new KeyboardEvent('keypress', { key: 'Enter', bubbles: true }),
      );

      await vi.waitFor(() => {
        expect(mp.verifyMasterPassword).toHaveBeenCalledWith('enterpass', expect.any(Function));
      }, WAIT);
    });

    it('should not call authenticatePassword on non-Enter key in auth input', async () => {
      const mp = await import('../../utils/masterPassword.js');

      setupDOM();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      (document.getElementById('masterPasswordAuthInput') as HTMLInputElement).value = 'test';
      document.getElementById('masterPasswordAuthInput')!.dispatchEvent(
        new KeyboardEvent('keypress', { key: 'Tab', bubbles: true }),
      );

      await new Promise((r) => setTimeout(r, 30));
      expect(mp.verifyMasterPassword).not.toHaveBeenCalled();
    });

    it('should close auth modal when clicking outside', async () => {
      setupDOM();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      const modal = document.getElementById('passwordAuthModal') as HTMLElement;
      modal.classList.remove('hidden');
      modal.style.display = 'flex';
      modal.classList.add('show');

      modal.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(modal.style.display).toBe('none');
    });

    it('should not close auth modal when clicking inside content', async () => {
      setupDOM();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      const modal = document.getElementById('passwordAuthModal') as HTMLElement;
      const title = document.getElementById('passwordAuthModalTitle') as HTMLElement;
      modal.classList.remove('hidden');
      modal.style.display = 'flex';

      title.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(modal.style.display).toBe('flex');
    });

    it('should handle missing checkbox element gracefully', async () => {
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      expect(() => initMasterPasswordUi()).not.toThrow();
    });

    it('should handle missing modal elements gracefully', async () => {
      document.body.innerHTML =
        '<input type="checkbox" id="masterPasswordEnabled" /><div id="masterPasswordOptions"></div>';
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      expect(() => initMasterPasswordUi()).not.toThrow();
    });
  });

  // =========================================================================
  // savePassword (via save button)
  // =========================================================================
  describe('savePassword', () => {
    it('should show requirement validation error when password is too short', async () => {
      const mp = await import('../../utils/masterPassword.js');
      (mp.validatePasswordRequirements as any).mockReturnValue('Too short');

      setupDOM();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      (document.getElementById('masterPasswordInput') as HTMLInputElement).value = 'short';
      document.getElementById('savePasswordBtn')!.click();

      await vi.waitFor(() => {
        const el = document.getElementById('passwordStrengthError') as HTMLElement;
        expect(el.textContent).toBeTruthy();
      }, WAIT);

      expect(
        (document.getElementById('passwordStrengthError') as HTMLElement).classList.contains('visible'),
      ).toBe(true);
    });

    it('should show match error when passwords do not match', async () => {
      const mp = await import('../../utils/masterPassword.js');
      (mp.validatePasswordRequirements as any).mockReturnValue(null);
      (mp.validatePasswordMatch as any).mockReturnValue('Passwords do not match');

      setupDOM();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      (document.getElementById('masterPasswordInput') as HTMLInputElement).value = 'password123';
      document.getElementById('savePasswordBtn')!.click();

      await vi.waitFor(() => {
        const el = document.getElementById('passwordMatchError') as HTMLElement;
        expect(el.textContent).toBeTruthy();
      }, WAIT);

      expect(
        (document.getElementById('passwordMatchError') as HTMLElement).classList.contains('visible'),
      ).toBe(true);
    });

    it('should call setMasterPassword on successful validation', async () => {
      const mp = await import('../../utils/masterPassword.js');
      (mp.validatePasswordRequirements as any).mockReturnValue(null);
      (mp.validatePasswordMatch as any).mockReturnValue(null);
      (mp.setMasterPassword as any).mockResolvedValue({ success: true });

      setupDOM();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      (document.getElementById('masterPasswordInput') as HTMLInputElement).value = 'strong';
      document.getElementById('savePasswordBtn')!.click();

      await vi.waitFor(() => {
        expect(mp.setMasterPassword).toHaveBeenCalledWith('strong', expect.any(Function));
      }, WAIT);
    });

    it('should show success status and enable checkbox on successful save', async () => {
      const mp = await import('../../utils/masterPassword.js');
      const sh = await import('../settingsUiHelper.js');
      (mp.validatePasswordRequirements as any).mockReturnValue(null);
      (mp.validatePasswordMatch as any).mockReturnValue(null);
      (mp.setMasterPassword as any).mockResolvedValue({ success: true });

      setupDOM();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      (document.getElementById('masterPasswordInput') as HTMLInputElement).value = 'good';
      document.getElementById('savePasswordBtn')!.click();

      await vi.waitFor(() => {
        expect(sh.showStatus).toHaveBeenCalledWith('status', expect.any(String), 'success');
      }, WAIT);

      expect(
        (document.getElementById('masterPasswordEnabled') as HTMLInputElement).checked,
      ).toBe(true);
    });

    it('should show error status when save fails', async () => {
      const mp = await import('../../utils/masterPassword.js');
      const sh = await import('../settingsUiHelper.js');
      (mp.validatePasswordRequirements as any).mockReturnValue(null);
      (mp.validatePasswordMatch as any).mockReturnValue(null);
      (mp.setMasterPassword as any).mockResolvedValue({ success: false, error: 'Save failed' });

      setupDOM();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      (document.getElementById('masterPasswordInput') as HTMLInputElement).value = 'good';
      document.getElementById('savePasswordBtn')!.click();

      await vi.waitFor(() => {
        expect(sh.showStatus).toHaveBeenCalledWith('status', 'Save failed', 'error');
      }, WAIT);
    });

    it('should close modal and show options on successful save', async () => {
      const mp = await import('../../utils/masterPassword.js');
      (mp.validatePasswordRequirements as any).mockReturnValue(null);
      (mp.validatePasswordMatch as any).mockReturnValue(null);
      (mp.setMasterPassword as any).mockResolvedValue({ success: true });

      setupDOM();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      const modal = document.getElementById('passwordModal') as HTMLElement;
      modal.classList.remove('hidden');
      modal.style.display = 'flex';

      (document.getElementById('masterPasswordInput') as HTMLInputElement).value = 'good';
      document.getElementById('savePasswordBtn')!.click();

      await vi.waitFor(() => {
        expect(modal.style.display).toBe('none');
      }, WAIT);

      expect(
        (document.getElementById('masterPasswordOptions') as HTMLElement).classList.contains('hidden'),
      ).toBe(false);
    });
  });

  // =========================================================================
  // authenticatePassword (via submit button)
  // =========================================================================
  describe('authenticatePassword', () => {
    it('should show error when password is empty', async () => {
      setupDOM();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      document.getElementById('submitPasswordAuthBtn')!.click();

      await vi.waitFor(() => {
        const el = document.getElementById('passwordAuthError') as HTMLElement;
        expect(el.textContent).toBeTruthy();
      }, WAIT);

      expect(
        (document.getElementById('passwordAuthError') as HTMLElement).classList.contains('visible'),
      ).toBe(true);
    });

    it('should show rate limit error when rate limited', async () => {
      const rl = await import('../../utils/rateLimiter.js');
      (rl.checkRateLimit as any).mockReset().mockResolvedValue({
        success: false,
        error: 'Too many attempts. Try again later.',
      });

      setupDOM();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      (document.getElementById('masterPasswordAuthInput') as HTMLInputElement).value = 'password';
      document.getElementById('submitPasswordAuthBtn')!.click();

      await vi.waitFor(() => {
        const el = document.getElementById('passwordAuthError') as HTMLElement;
        expect(el.textContent).toBeTruthy();
      }, WAIT);

      expect(
        (document.getElementById('passwordAuthError') as HTMLElement).classList.contains('visible'),
      ).toBe(true);
    });

    it('should call resetFailedAttempts and close modal on successful auth', async () => {
      const mp = await import('../../utils/masterPassword.js');
      const rl = await import('../../utils/rateLimiter.js');
      (rl.checkRateLimit as any).mockReset().mockResolvedValue({ success: true });
      (mp.verifyMasterPassword as any).mockReset().mockResolvedValue({ success: true });

      setupDOM();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      const modal = document.getElementById('passwordAuthModal') as HTMLElement;
      modal.classList.remove('hidden');
      modal.style.display = 'flex';

      (document.getElementById('masterPasswordAuthInput') as HTMLInputElement).value = 'correct';
      document.getElementById('submitPasswordAuthBtn')!.click();

      await vi.waitFor(() => {
        expect(rl.resetFailedAttempts).toHaveBeenCalled();
      }, WAIT);

      expect(modal.style.display).toBe('none');
      expect(modal.classList.contains('hidden')).toBe(true);
    });

    it('should call pending action after successful auth', async () => {
      const mp = await import('../../utils/masterPassword.js');
      const rl = await import('../../utils/rateLimiter.js');
      (rl.checkRateLimit as any).mockReset().mockResolvedValue({ success: true });
      (mp.verifyMasterPassword as any).mockReset().mockResolvedValue({ success: true });

      setupDOM();
      const { showPasswordAuthModal, initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      const pendingAction = vi.fn().mockResolvedValue(undefined);
      showPasswordAuthModal('export', pendingAction);

      (document.getElementById('masterPasswordAuthInput') as HTMLInputElement).value = 'mypassword';
      document.getElementById('submitPasswordAuthBtn')!.click();

      await vi.waitFor(() => {
        expect(pendingAction).toHaveBeenCalledWith('mypassword');
      }, WAIT);
    });

    it('should record failed attempt and show error on wrong password', async () => {
      const mp = await import('../../utils/masterPassword.js');
      const rl = await import('../../utils/rateLimiter.js');
      (rl.checkRateLimit as any).mockReset().mockResolvedValue({ success: true });
      (mp.verifyMasterPassword as any).mockReset().mockResolvedValue({
        success: false,
        error: 'Incorrect password.',
      });

      setupDOM();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      (document.getElementById('masterPasswordAuthInput') as HTMLInputElement).value = 'wrong';
      document.getElementById('submitPasswordAuthBtn')!.click();

      await vi.waitFor(() => {
        expect(rl.recordFailedAttempt).toHaveBeenCalled();
      }, WAIT);

      const errEl = document.getElementById('passwordAuthError') as HTMLElement;
      expect(errEl.textContent).toBeTruthy();
      expect(errEl.classList.contains('visible')).toBe(true);
    });

    it('should handle auth with fallback error message', async () => {
      const mp = await import('../../utils/masterPassword.js');
      const rl = await import('../../utils/rateLimiter.js');
      (rl.checkRateLimit as any).mockReset().mockResolvedValue({ success: true });
      (mp.verifyMasterPassword as any).mockReset().mockResolvedValue({ success: false });

      setupDOM();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      (document.getElementById('masterPasswordAuthInput') as HTMLInputElement).value = 'bad';
      document.getElementById('submitPasswordAuthBtn')!.click();

      await vi.waitFor(() => {
        const el = document.getElementById('passwordAuthError') as HTMLElement;
        expect(el.textContent).toBeTruthy();
      }, WAIT);
    });
  });

  // =========================================================================
  // updatePasswordStrength (via input event)
  // =========================================================================
  describe('updatePasswordStrength', () => {
    it('should show Weak text for empty password', async () => {
      setupDOM();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      (document.getElementById('masterPasswordInput') as HTMLInputElement).value = '';
      document.getElementById('masterPasswordInput')!.dispatchEvent(new Event('input'));

      expect(
        (document.querySelector('#passwordStrength .strength-fill') as HTMLElement).style.width,
      ).toBe('0%');
      expect(
        (document.getElementById('passwordStrengthText') as HTMLElement).textContent,
      ).toBeTruthy();
    });

    it('should calculate and display strength for non-empty password', async () => {
      const mp = await import('../../utils/masterPassword.js');
      (mp.calculatePasswordStrength as any).mockReturnValue({ score: 75, level: 'strong', text: 'Strong' });

      setupDOM();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      (document.getElementById('masterPasswordInput') as HTMLInputElement).value = 'StrongP@ss1';
      document.getElementById('masterPasswordInput')!.dispatchEvent(new Event('input'));

      const bar = document.querySelector('#passwordStrength .strength-fill') as HTMLElement;
      expect(bar.style.width).toBe('75%');
      expect(bar.classList.contains('strong')).toBe(true);
    });

    it('should handle missing strength elements gracefully', async () => {
      document.body.innerHTML =
        '<input type="checkbox" id="masterPasswordEnabled" /><input id="masterPasswordInput" />';
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      (document.getElementById('masterPasswordInput') as HTMLInputElement).value = 'test';
      expect(() =>
        document.getElementById('masterPasswordInput')!.dispatchEvent(new Event('input')),
      ).not.toThrow();
    });
  });

  // =========================================================================
  // Password disabling flow
  // =========================================================================
  describe('password disabling flow', () => {
    it('should show auth modal when disabling', async () => {
      setupDOM();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      const cb = document.getElementById('masterPasswordEnabled') as HTMLInputElement;
      cb.checked = false;
      cb.dispatchEvent(new Event('change'));

      expect(
        (document.getElementById('passwordAuthModal') as HTMLElement).classList.contains('hidden'),
      ).toBe(false);
      expect(cb.checked).toBe(true);
    });

    it('should remove storage keys on confirmed disable', async () => {
      const mp = await import('../../utils/masterPassword.js');
      const rl = await import('../../utils/rateLimiter.js');
      (rl.checkRateLimit as any).mockReset().mockResolvedValue({ success: true });
      (mp.verifyMasterPassword as any).mockReset().mockResolvedValue({ success: true });

      const origConfirm = globalThis.confirm;
      globalThis.confirm = vi.fn().mockReturnValue(true);

      setupDOM();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      const cb = document.getElementById('masterPasswordEnabled') as HTMLInputElement;
      cb.checked = false;
      cb.dispatchEvent(new Event('change'));

      (document.getElementById('masterPasswordAuthInput') as HTMLInputElement).value = 'mypassword';
      document.getElementById('submitPasswordAuthBtn')!.click();

      await vi.waitFor(() => {
        expect(globalThis.confirm).toHaveBeenCalled();
      }, WAIT);

      expect(chrome.storage.local.remove).toHaveBeenCalledWith([
        'master_password_enabled',
        'master_password_salt',
        'master_password_hash',
      ]);

      globalThis.confirm = origConfirm;
    });

    it('should clear API keys on confirmed disable', async () => {
      const st = await import('../../utils/storage.js');
      const mp = await import('../../utils/masterPassword.js');
      const rl = await import('../../utils/rateLimiter.js');
      (rl.checkRateLimit as any).mockReset().mockResolvedValue({ success: true });
      (mp.verifyMasterPassword as any).mockReset().mockResolvedValue({ success: true });
      (st.getSettings as any).mockReset().mockResolvedValue({
        obsidian_api_key: 'obs-key',
        gemini_api_key: 'gem-key',
        openai_api_key: 'openai-key',
        openai_2_api_key: 'openai2-key',
        provider_api_key: 'provider-key',
        some_other: 'should-stay',
      });

      const origConfirm = globalThis.confirm;
      globalThis.confirm = vi.fn().mockReturnValue(true);

      setupDOM();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      const cb = document.getElementById('masterPasswordEnabled') as HTMLInputElement;
      cb.checked = false;
      cb.dispatchEvent(new Event('change'));

      (document.getElementById('masterPasswordAuthInput') as HTMLInputElement).value = 'pass';
      document.getElementById('submitPasswordAuthBtn')!.click();

      await vi.waitFor(() => {
        expect(st.saveSettingsWithAllowedUrls).toHaveBeenCalled();
      }, WAIT);

      const saved = (st.saveSettingsWithAllowedUrls as any).mock.calls[0][0];
      expect(saved.obsidian_api_key).toBe('');
      expect(saved.gemini_api_key).toBe('');
      expect(saved.openai_api_key).toBe('');
      expect(saved.openai_2_api_key).toBe('');
      expect(saved.provider_api_key).toBe('');
      expect(saved.some_other).toBe('should-stay');

      globalThis.confirm = origConfirm;
    });

    it('should show success status after disable', async () => {
      const mp = await import('../../utils/masterPassword.js');
      const rl = await import('../../utils/rateLimiter.js');
      const sh = await import('../settingsUiHelper.js');
      (rl.checkRateLimit as any).mockReset().mockResolvedValue({ success: true });
      (mp.verifyMasterPassword as any).mockReset().mockResolvedValue({ success: true });

      const origConfirm = globalThis.confirm;
      globalThis.confirm = vi.fn().mockReturnValue(true);

      setupDOM();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      const cb = document.getElementById('masterPasswordEnabled') as HTMLInputElement;
      cb.checked = false;
      cb.dispatchEvent(new Event('change'));

      (document.getElementById('masterPasswordAuthInput') as HTMLInputElement).value = 'pass';
      document.getElementById('submitPasswordAuthBtn')!.click();

      await vi.waitFor(() => {
        expect(sh.showStatus).toHaveBeenCalledWith('status', expect.any(String), 'success');
      }, WAIT);

      globalThis.confirm = origConfirm;
    });

    it('should not proceed with disable when confirm is cancelled', async () => {
      const mp = await import('../../utils/masterPassword.js');
      const rl = await import('../../utils/rateLimiter.js');
      (rl.checkRateLimit as any).mockReset().mockResolvedValue({ success: true });
      (mp.verifyMasterPassword as any).mockReset().mockResolvedValue({ success: true });

      const origConfirm = globalThis.confirm;
      globalThis.confirm = vi.fn().mockReturnValue(false);

      setupDOM();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      const cb = document.getElementById('masterPasswordEnabled') as HTMLInputElement;
      cb.checked = false;
      cb.dispatchEvent(new Event('change'));

      (document.getElementById('masterPasswordAuthInput') as HTMLInputElement).value = 'pass';
      document.getElementById('submitPasswordAuthBtn')!.click();

      await new Promise((r) => setTimeout(r, 50));

      expect(chrome.storage.local.remove).not.toHaveBeenCalled();
      expect(cb.checked).toBe(true);

      globalThis.confirm = origConfirm;
    });
  });

  // =========================================================================
  // Change password flow
  // =========================================================================
  describe('change password flow', () => {
    it('should go through auth then show change password modal', async () => {
      const mp = await import('../../utils/masterPassword.js');
      const rl = await import('../../utils/rateLimiter.js');
      (rl.checkRateLimit as any).mockReset().mockResolvedValue({ success: true });
      (mp.verifyMasterPassword as any).mockReset().mockResolvedValue({ success: true });

      setupDOM();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      document.getElementById('changeMasterPassword')!.click();

      expect(
        (document.getElementById('passwordAuthModal') as HTMLElement).classList.contains('hidden'),
      ).toBe(false);

      (document.getElementById('masterPasswordAuthInput') as HTMLInputElement).value = 'current';
      document.getElementById('submitPasswordAuthBtn')!.click();

      await vi.waitFor(() => {
        const m = document.getElementById('passwordModal') as HTMLElement;
        expect(m.style.display).toBe('flex');
      }, WAIT);

      expect(
        (document.getElementById('passwordModal') as HTMLElement).classList.contains('hidden'),
      ).toBe(false);
      expect(
        (document.getElementById('confirmPasswordGroup') as HTMLElement).classList.contains('hidden'),
      ).toBe(false);
    });

    it('should not call validatePasswordMatch in change mode', async () => {
      const mp = await import('../../utils/masterPassword.js');
      const rl = await import('../../utils/rateLimiter.js');
      (rl.checkRateLimit as any).mockReset().mockResolvedValue({ success: true });
      (mp.verifyMasterPassword as any).mockReset().mockResolvedValue({ success: true });

      setupDOM();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      document.getElementById('changeMasterPassword')!.click();

      (document.getElementById('masterPasswordAuthInput') as HTMLInputElement).value = 'current';
      document.getElementById('submitPasswordAuthBtn')!.click();

      await vi.waitFor(() => {
        const m = document.getElementById('passwordModal') as HTMLElement;
        expect(m.style.display).toBe('flex');
      }, WAIT);

      (mp.validatePasswordRequirements as any).mockReturnValue(null);
      (mp.setMasterPassword as any).mockResolvedValue({ success: true });

      (document.getElementById('masterPasswordInput') as HTMLInputElement).value = 'newpass';
      document.getElementById('savePasswordBtn')!.click();

      await vi.waitFor(() => {
        expect(mp.setMasterPassword).toHaveBeenCalled();
      }, WAIT);

      expect(mp.validatePasswordMatch).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Focus trap management
  // =========================================================================
  describe('focus trap management', () => {
    it('should set focus trap when showing password modal', async () => {
      const ft = (await import('../utils/focusTrap.js')).focusTrapManager;

      setupDOM();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      const cb = document.getElementById('masterPasswordEnabled') as HTMLInputElement;
      cb.checked = true;
      cb.dispatchEvent(new Event('change'));

      const modal = document.getElementById('passwordModal') as HTMLElement;
      expect(ft.trap).toHaveBeenCalledWith(modal, expect.any(Function));
    });

    it('should release focus trap on password modal close', async () => {
      const ft = (await import('../utils/focusTrap.js')).focusTrapManager;

      setupDOM();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      (document.getElementById('masterPasswordEnabled') as HTMLInputElement).checked = true;
      document.getElementById('masterPasswordEnabled')!.dispatchEvent(new Event('change'));

      document.getElementById('closePasswordModalBtn')!.click();

      expect(ft.release).toHaveBeenCalledWith('trap-id');
    });

    it('should release focus trap on auth modal close', async () => {
      const ft = (await import('../utils/focusTrap.js')).focusTrapManager;

      setupDOM();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      const cb = document.getElementById('masterPasswordEnabled') as HTMLInputElement;
      cb.checked = false;
      cb.dispatchEvent(new Event('change'));

      document.getElementById('closePasswordAuthModalBtn')!.click();

      expect(ft.release).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Edge cases
  // =========================================================================
  describe('edge cases', () => {
    it('should handle auth input missing element', async () => {
      document.body.innerHTML = [
        '<div id="passwordAuthModal">',
        '  <div id="passwordAuthError"></div>',
        '  <button id="submitPasswordAuthBtn"></button>',
        '</div>',
      ].join('');
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      expect(() =>
        document.getElementById('submitPasswordAuthBtn')!.click(),
      ).not.toThrow();
    });

    it('should handle password input missing element', async () => {
      document.body.innerHTML = [
        '<div id="passwordModal">',
        '  <div id="passwordStrengthError"></div>',
        '  <button id="savePasswordBtn"></button>',
        '</div>',
      ].join('');
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      expect(() =>
        document.getElementById('savePasswordBtn')!.click(),
      ).not.toThrow();
    });

    it('should show modal title and description for set mode', async () => {
      setupDOM();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      (document.getElementById('masterPasswordEnabled') as HTMLInputElement).checked = true;
      document.getElementById('masterPasswordEnabled')!.dispatchEvent(new Event('change'));

      expect(
        (document.getElementById('passwordModalTitle') as HTMLElement).textContent,
      ).toBeTruthy();
      expect(
        (document.getElementById('passwordModalDesc') as HTMLElement).textContent,
      ).toBeTruthy();
    });

    it('should clear input values when closing password modal', async () => {
      setupDOM();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      const modal = document.getElementById('passwordModal') as HTMLElement;
      modal.classList.remove('hidden');
      modal.style.display = 'flex';

      const inp = document.getElementById('masterPasswordInput') as HTMLInputElement;
      const conf = document.getElementById('masterPasswordConfirm') as HTMLInputElement;
      inp.value = 'clear-me';
      conf.value = 'clear-me-too';

      document.getElementById('closePasswordModalBtn')!.click();

      expect(inp.value).toBe('');
      expect(conf.value).toBe('');
    });

    it('should clear auth input when closing auth modal', async () => {
      setupDOM();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      const modal = document.getElementById('passwordAuthModal') as HTMLElement;
      modal.classList.remove('hidden');
      modal.style.display = 'flex';

      const inp = document.getElementById('masterPasswordAuthInput') as HTMLInputElement;
      inp.value = 'auth-value';

      document.getElementById('closePasswordAuthModalBtn')!.click();

      expect(inp.value).toBe('');
    });

    it('should reset modal mode to set on re-show after change', async () => {
      const mp = await import('../../utils/masterPassword.js');
      const rl = await import('../../utils/rateLimiter.js');
      (rl.checkRateLimit as any).mockReset().mockResolvedValue({ success: true });
      (mp.verifyMasterPassword as any).mockReset().mockResolvedValue({ success: true });

      setupDOM();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      document.getElementById('changeMasterPassword')!.click();

      (document.getElementById('masterPasswordAuthInput') as HTMLInputElement).value = 'pass';
      document.getElementById('submitPasswordAuthBtn')!.click();
      await vi.waitFor(() => {
        const m = document.getElementById('passwordModal') as HTMLElement;
        expect(m.style.display).toBe('flex');
      }, WAIT);

      document.getElementById('closePasswordModalBtn')!.click();

      (document.getElementById('masterPasswordEnabled') as HTMLInputElement).checked = true;
      document.getElementById('masterPasswordEnabled')!.dispatchEvent(new Event('change'));

      expect(
        (document.getElementById('confirmPasswordGroup') as HTMLElement).classList.contains('hidden'),
      ).toBe(false);
    });

    it('should handle multiple rapid auth submissions gracefully', async () => {
      const mp = await import('../../utils/masterPassword.js');
      const rl = await import('../../utils/rateLimiter.js');
      (rl.checkRateLimit as any).mockReset().mockResolvedValue({ success: true });
      (mp.verifyMasterPassword as any).mockReset().mockResolvedValue({ success: true });

      setupDOM();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      (document.getElementById('masterPasswordAuthInput') as HTMLInputElement).value = 'password';
      const btn = document.getElementById('submitPasswordAuthBtn')!;
      btn.click();
      btn.click();

      await vi.waitFor(() => {
        expect(mp.verifyMasterPassword).toHaveBeenCalledTimes(2);
      }, WAIT);
    });
  });
});
