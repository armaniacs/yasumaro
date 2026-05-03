// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../popup/i18n.js', () => ({
  getMessage: vi.fn((key) => `i18n_${key}`),
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
  setMasterPassword: vi.fn().mockResolvedValue({ success: true }),
  verifyMasterPassword: vi.fn().mockResolvedValue({ success: true }),
  isMasterPasswordSet: vi.fn().mockResolvedValue(true),
  calculatePasswordStrength: vi.fn().mockReturnValue({
    score: 80,
    level: 'strong',
    text: 'Strong',
  }),
  validatePasswordRequirements: vi.fn().mockReturnValue(null),
  validatePasswordMatch: vi.fn().mockReturnValue(null),
}));

const mockChrome = {
  storage: {
    local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
  },
};

Object.defineProperty(global, 'chrome', {
  value: mockChrome,
  writable: true,
});

describe('masterPassword module exports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = `
      <input type="checkbox" id="masterPasswordEnabled" />
      <div id="masterPasswordOptions"></div>
      <button id="changeMasterPassword"></button>
      <div id="passwordModal" class="hidden"></div>
      <input id="masterPasswordInput" />
      <input id="masterPasswordConfirm" />
      <div id="passwordAuthModal" class="hidden"></div>
      <input id="masterPasswordAuthInput" />
      <button id="closePasswordModalBtn"></button>
      <button id="cancelPasswordBtn"></button>
      <button id="savePasswordBtn"></button>
      <button id="closePasswordAuthModalBtn"></button>
      <button id="cancelPasswordAuthBtn"></button>
      <button id="submitPasswordAuthBtn"></button>
      <div id="passwordStrength"><div class="strength-fill"></div></div>
      <div id="passwordStrengthText"></div>
      <div id="passwordStrengthError"></div>
      <div id="passwordMatchError"></div>
      <div id="confirmPasswordGroup" class="hidden"></div>
    `;
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('should export initMasterPasswordSettings function', async () => {
    const { initMasterPasswordSettings } = await import('../masterPassword.js');
    expect(typeof initMasterPasswordSettings).toBe('function');
  });

  it('should export loadMasterPasswordSettings function', async () => {
    const { loadMasterPasswordSettings } = await import('../masterPassword.js');
    expect(typeof loadMasterPasswordSettings).toBe('function');
  });

  it('should export showPasswordAuthModal function', async () => {
    const { showPasswordAuthModal } = await import('../masterPassword.js');
    expect(typeof showPasswordAuthModal).toBe('function');
  });

  it('should export closePasswordModal function', async () => {
    const { closePasswordModal } = await import('../masterPassword.js');
    expect(typeof closePasswordModal).toBe('function');
  });

  it('should run initMasterPasswordSettings without errors', async () => {
    const { initMasterPasswordSettings } = await import('../masterPassword.js');
    expect(() => initMasterPasswordSettings()).not.toThrow();
  });
});