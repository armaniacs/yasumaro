// @vitest-environment jsdom
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
    '  <div id="passwordStrengthText"></div><div id="confirmPasswordGroup" class="hidden"></div>',
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

describe('masterPasswordUi - r2 missed branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    document.body.innerHTML = '';
  });

  describe('showPasswordModal change mode', () => {
    it('should show confirmPasswordGroup in change mode', async () => {
      setupDOM();
      const mp = await import('../../utils/masterPassword.js');
      const rl = await import('../../utils/rateLimiter.js');
      (rl.checkRateLimit as any).mockReset().mockResolvedValue({ success: true });
      (mp.verifyMasterPassword as any).mockReset().mockResolvedValue({ success: true });

      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      document.getElementById('changeMasterPassword')!.click();

      (document.getElementById('masterPasswordAuthInput') as HTMLInputElement).value = 'pass';
      document.getElementById('submitPasswordAuthBtn')!.click();

      await vi.waitFor(() => {
        const modal = document.getElementById('passwordModal') as HTMLElement;
        expect(modal.style.display).toBe('flex');
      }, WAIT);

      const confirmGroup = document.getElementById('confirmPasswordGroup') as HTMLElement;
      expect(confirmGroup.classList.contains('hidden')).toBe(false);
    });
  });

  describe('savePassword edge cases', () => {
    it('should do nothing when masterPasswordInput is missing', async () => {
      setupDOM();
      document.getElementById('masterPasswordInput')!.remove();

      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      expect(() => {
        document.getElementById('savePasswordBtn')!.click();
      }).not.toThrow();
    });

    it('should skip validatePasswordMatch in change mode', async () => {
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
        expect(document.getElementById('passwordModal')!.style.display).toBe('flex');
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

    it('should show error when setMasterPassword fails', async () => {
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
  });

  describe('updatePasswordStrength edge cases', () => {
    it('should reset to 0% for empty password', async () => {
      setupDOM();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      const input = document.getElementById('masterPasswordInput') as HTMLInputElement;
      input.value = '';
      input.dispatchEvent(new Event('input'));

      const bar = document.querySelector('#passwordStrength .strength-fill') as HTMLElement;
      expect(bar.style.width).toBe('0%');
      expect(bar.className).toBe('strength-fill');
    });

    it('should handle missing strength elements gracefully', async () => {
      const mp = await import('../../utils/masterPassword.js');
      (mp.calculatePasswordStrength as any).mockReturnValue({ score: 50, level: 'medium', text: 'Medium' });

      setupDOM();
      document.querySelector('#passwordStrength .strength-fill')!.remove();
      document.getElementById('passwordStrengthText')!.remove();

      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      const input = document.getElementById('masterPasswordInput') as HTMLInputElement;
      input.value = 'test';
      expect(() => input.dispatchEvent(new Event('input'))).not.toThrow();
    });
  });

  describe('closePasswordModal release trap', () => {
    it('should release focus trap when closing modal', async () => {
      const ft = (await import('../utils/focusTrap.js')).focusTrapManager;

      setupDOM();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      const cb = document.getElementById('masterPasswordEnabled') as HTMLInputElement;
      cb.checked = true;
      cb.dispatchEvent(new Event('change'));

      expect(ft.trap).toHaveBeenCalled();

      document.getElementById('closePasswordModalBtn')!.click();
      expect(ft.release).toHaveBeenCalledWith('trap-id');
    });
  });

  describe('closePasswordAuthModal', () => {
    it('should release focus trap and clear pending action', async () => {
      const ft = (await import('../utils/focusTrap.js')).focusTrapManager;

      setupDOM();
      const { initMasterPasswordUi, showPasswordAuthModal } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      const pendingAction = vi.fn();
      showPasswordAuthModal('export', pendingAction);

      expect(ft.trap).toHaveBeenCalled();

      document.getElementById('closePasswordAuthModalBtn')!.click();
      expect(ft.release).toHaveBeenCalled();
    });
  });

  describe('initMasterPasswordUi missing elements', () => {
    it('should handle missing changeMasterPassword button', async () => {
      setupDOM();
      document.getElementById('changeMasterPassword')!.remove();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      expect(() => initMasterPasswordUi()).not.toThrow();
    });

    it('should handle missing masterPasswordInput', async () => {
      setupDOM();
      document.getElementById('masterPasswordInput')!.remove();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      expect(() => initMasterPasswordUi()).not.toThrow();
    });

    it('should handle missing closePasswordModalBtn', async () => {
      setupDOM();
      document.getElementById('closePasswordModalBtn')!.remove();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      expect(() => initMasterPasswordUi()).not.toThrow();
    });

    it('should handle missing cancelPasswordBtn', async () => {
      setupDOM();
      document.getElementById('cancelPasswordBtn')!.remove();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      expect(() => initMasterPasswordUi()).not.toThrow();
    });

    it('should handle missing savePasswordBtn', async () => {
      setupDOM();
      document.getElementById('savePasswordBtn')!.remove();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      expect(() => initMasterPasswordUi()).not.toThrow();
    });

    it('should handle missing passwordModal', async () => {
      setupDOM();
      document.getElementById('passwordModal')!.remove();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      expect(() => initMasterPasswordUi()).not.toThrow();
    });

    it('should handle missing passwordAuthModal elements', async () => {
      setupDOM();
      document.getElementById('closePasswordAuthModalBtn')!.remove();
      document.getElementById('cancelPasswordAuthBtn')!.remove();
      document.getElementById('submitPasswordAuthBtn')!.remove();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      expect(() => initMasterPasswordUi()).not.toThrow();
    });

    it('should handle missing masterPasswordAuthInput', async () => {
      setupDOM();
      document.getElementById('masterPasswordAuthInput')!.remove();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      expect(() => initMasterPasswordUi()).not.toThrow();
    });

    it('should handle missing passwordAuthModal', async () => {
      setupDOM();
      document.getElementById('passwordAuthModal')!.remove();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      expect(() => initMasterPasswordUi()).not.toThrow();
    });
  });

  describe('loadMasterPasswordSettings edge cases', () => {
    it('should handle missing masterPasswordEnabled checkbox', async () => {
      const { loadMasterPasswordSettings } = await import('../masterPasswordUi.js');
      await expect(loadMasterPasswordSettings()).resolves.not.toThrow();
    });

    it('should hide options when password is not set', async () => {
      const isSet = (await import('../../utils/masterPassword.js')).isMasterPasswordSet;
      (isSet as any).mockResolvedValue(false);

      setupDOM();
      const { loadMasterPasswordSettings } = await import('../masterPasswordUi.js');
      await loadMasterPasswordSettings();

      const opts = document.getElementById('masterPasswordOptions') as HTMLElement;
      expect(opts.classList.contains('hidden')).toBe(true);
    });

    it('should show options when password is set', async () => {
      const isSet = (await import('../../utils/masterPassword.js')).isMasterPasswordSet;
      (isSet as any).mockResolvedValue(true);

      setupDOM();
      const { loadMasterPasswordSettings } = await import('../masterPasswordUi.js');
      await loadMasterPasswordSettings();

      const opts = document.getElementById('masterPasswordOptions') as HTMLElement;
      expect(opts.classList.contains('hidden')).toBe(false);
    });
  });

  describe('authenticatePassword edge cases', () => {
    it('should handle missing masterPasswordAuthInput', async () => {
      const input = document.getElementById('masterPasswordAuthInput');
      if (input) input.remove();

      setupDOM();
      const { initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      document.getElementById('submitPasswordAuthBtn')!.click();
      await new Promise((r) => setTimeout(r, 10));
    });

    it('should pass password to pending action on success', async () => {
      const mp = await import('../../utils/masterPassword.js');
      const rl = await import('../../utils/rateLimiter.js');
      (rl.checkRateLimit as any).mockReset().mockResolvedValue({ success: true });
      (mp.verifyMasterPassword as any).mockReset().mockResolvedValue({ success: true });

      setupDOM();
      const { showPasswordAuthModal, initMasterPasswordUi } = await import('../masterPasswordUi.js');
      initMasterPasswordUi();

      const pendingAction = vi.fn().mockResolvedValue(undefined);
      showPasswordAuthModal('export', pendingAction);

      (document.getElementById('masterPasswordAuthInput') as HTMLInputElement).value = 'thepassword';
      document.getElementById('submitPasswordAuthBtn')!.click();

      await vi.waitFor(() => {
        expect(pendingAction).toHaveBeenCalledWith('thepassword');
      }, WAIT);
    });
  });

  describe('password disabling confirm cancelled', () => {
    it('should keep checkbox checked when confirm is cancelled', async () => {
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

      expect(cb.checked).toBe(true);
      expect(chrome.storage.local.remove).not.toHaveBeenCalled();

      globalThis.confirm = origConfirm;
    });
  });
});
