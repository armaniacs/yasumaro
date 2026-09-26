// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../utils/i18n.js', () => {
  const getMessage = vi.fn((key) => `i18n_${key}`);
  const getMessageOr = (key: string, fallback: string, subs?: unknown): string =>
  ((subs === undefined ? (getMessage as (...a: any[]) => unknown)(key) : (getMessage as (...a: any[]) => unknown)(key, subs)) || fallback) as string;
  const getMessageWithSubstitutions = (
  key: string,
  subs: Record<string, string | number>,
  fallback: string,
      ): string =>
      ((getMessage as (...a: any[]) => unknown)(key, subs) ||
  fallback.replace(/\{(\w+)\}/g, (_m: string, n: string) =>
    subs[n] !== undefined ? String(subs[n]) : `{${n}}`)) as string;
  return {
  getMessage: getMessage, getMessageOr, getMessageWithSubstitutions
}; });

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