// @vitest-environment jsdom
/**
 * When a master password already exists (per storage, not per checkbox), the
 * dashboard must route "enable" actions to the change flow (old password
 * authentication) instead of opening the set modal.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitForMock } from '../../../testDir/waitPolicy.js';

vi.mock('../../utils/i18n.js', () => {
  const getMessage = vi.fn((key: string) => `i18n_${key}`);
  const getMessageOr = (key: string, fallback: string): string => getMessage(key) || fallback;
  const getMessageWithSubstitutions = (key: string, _subs: unknown, fallback: string): string =>
    getMessage(key) || fallback;
  return { getMessage, getMessageOr, getMessageWithSubstitutions };
});
vi.mock('../../utils/ui/settingsUiHelper.js', () => ({ showStatus: vi.fn() }));
vi.mock('../../utils/ui/focusTrap.js', () => ({
  focusTrapManager: { trap: vi.fn().mockReturnValue('trap-id'), release: vi.fn() },
}));
vi.mock('../../utils/masterPassword.js', () => ({
  verifyMasterPassword: vi.fn(),
  isMasterPasswordSet: vi.fn(),
  calculatePasswordStrength: vi.fn().mockReturnValue({ score: 50, level: 'medium', text: 'Medium' }),
}));
vi.mock('../../utils/masterPasswordUiCore.js', () => ({
  validateAndSetPasswordErrors: vi.fn().mockReturnValue(false),
  validateAndSetMatchErrors: vi.fn().mockReturnValue(false),
  buildGetStorageFn: vi.fn(),
  updatePasswordStrengthDisplay: vi.fn(),
}));
vi.mock('../../utils/rateLimiter.js', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ success: true }),
  recordFailedAttempt: vi.fn().mockResolvedValue(undefined),
  resetFailedAttempts: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../utils/storage/encryptionSession.js', () => ({
  setMasterPassword: vi.fn(),
  changeMasterPassword: vi.fn(),
  removeMasterPassword: vi.fn(),
  ReencryptionAbortedError: class ReencryptionAbortedError extends Error {
    fields: readonly string[] = [];
  },
  MasterPasswordAlreadySetError: class MasterPasswordAlreadySetError extends Error {},
}));

vi.stubGlobal('chrome', {
  storage: { local: { get: vi.fn().mockResolvedValue({}), set: vi.fn(), remove: vi.fn() } },
});

import { isMasterPasswordSet } from '../../utils/masterPassword.js';
import {
  setMasterPassword as setMasterPasswordService,
  MasterPasswordAlreadySetError,
} from '../../utils/storage/encryptionSession.js';
import { showStatus } from '../../utils/ui/settingsUiHelper.js';

function setupDOM(): void {
  document.body.innerHTML = `
    <input type="checkbox" id="masterPasswordEnabled" />
    <div id="masterPasswordOptions" class="hidden"></div>
    <button id="setMasterPasswordNowBtn"></button>
    <button id="changeMasterPassword"></button>
    <div id="passwordModal" class="hidden">
      <div id="passwordModalTitle"></div><div id="passwordModalDesc"></div>
      <input id="masterPasswordInput" /><input id="masterPasswordConfirm" />
      <div id="passwordStrengthError"></div><div id="passwordMatchError"></div>
      <div id="passwordStrength"><div class="strength-fill"></div></div>
      <div id="passwordStrengthText"></div><div id="confirmPasswordGroup"></div>
      <button id="closePasswordModalBtn"></button><button id="cancelPasswordBtn"></button>
      <button id="savePasswordBtn"></button>
    </div>
    <div id="passwordAuthModal" class="hidden">
      <input id="masterPasswordAuthInput" /><div id="passwordAuthError"></div>
      <button id="closePasswordAuthModalBtn"></button><button id="cancelPasswordAuthBtn"></button>
      <button id="submitPasswordAuthBtn"></button>
    </div>`;
}

const isShown = (id: string): boolean => !document.getElementById(id)!.classList.contains('hidden');

async function initController(): Promise<void> {
  vi.resetModules();
  const { initMasterPasswordSettings } = await import('../masterPassword.js');
  initMasterPasswordSettings();
}

function checkCheckbox(): void {
  const cb = document.getElementById('masterPasswordEnabled') as HTMLInputElement;
  cb.checked = true;
  cb.dispatchEvent(new Event('change'));
}

describe('dashboard set-mode guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDOM();
  });

  it('routes checkbox ON to the auth modal, not the set modal, when a password is already set', async () => {
    vi.mocked(isMasterPasswordSet).mockResolvedValue(true);
    await initController();

    checkCheckbox();

    await waitForMock(() => expect(isShown('passwordAuthModal')).toBe(true));
    expect(isShown('passwordModal')).toBe(false);
  });

  it('routes the "set now" button to the auth modal when a password is already set', async () => {
    vi.mocked(isMasterPasswordSet).mockResolvedValue(true);
    await initController();

    document.getElementById('setMasterPasswordNowBtn')!.click();

    await waitForMock(() => expect(isShown('passwordAuthModal')).toBe(true));
    expect(isShown('passwordModal')).toBe(false);
  });

  it('opens the set modal when no password is set (fresh install)', async () => {
    vi.mocked(isMasterPasswordSet).mockResolvedValue(false);
    await initController();

    checkCheckbox();

    await waitForMock(() => expect(isShown('passwordModal')).toBe(true));
    expect(isShown('passwordAuthModal')).toBe(false);
    expect(document.getElementById('passwordModalTitle')!.textContent).toBe('i18n_setMasterPassword');
  });

  it('never calls the set service when the set flow is diverted', async () => {
    vi.mocked(isMasterPasswordSet).mockResolvedValue(true);
    await initController();

    checkCheckbox();
    await waitForMock(() => expect(isShown('passwordAuthModal')).toBe(true));

    expect(setMasterPasswordService).not.toHaveBeenCalled();
  });

  it('shows the localized already-set message when the service refuses a set', async () => {
    vi.mocked(isMasterPasswordSet).mockResolvedValue(false);
    vi.mocked(setMasterPasswordService).mockRejectedValue(new MasterPasswordAlreadySetError());
    await initController();
    checkCheckbox();
    await waitForMock(() => expect(isShown('passwordModal')).toBe(true));

    document.getElementById('savePasswordBtn')!.click();

    await waitForMock(() =>
      expect(showStatus).toHaveBeenCalledWith('status', 'i18n_masterPasswordAlreadySet', 'error')
    );
  });
});
