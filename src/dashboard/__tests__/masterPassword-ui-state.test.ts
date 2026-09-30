// @vitest-environment jsdom
/**
 * The checkbox and the confirm field must reflect storage, not the optimistic
 * DOM state left behind by a failed save or a cancelled modal.
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

import { isMasterPasswordSet, verifyMasterPassword } from '../../utils/masterPassword.js';
import { setMasterPassword as setMasterPasswordService } from '../../utils/storage/encryptionSession.js';
import { showStatus } from '../../utils/ui/settingsUiHelper.js';

// Mirrors entrypoints/options/index.html initial classes: modals and options
// start hidden, the confirm group starts visible.
function setupDOM(): void {
  document.body.innerHTML = `
    <input type="checkbox" id="masterPasswordEnabled" />
    <div id="masterPasswordOptions" class="hidden"></div>
    <div id="masterPasswordWarning" class="hidden"></div>
    <button id="setMasterPasswordNowBtn"></button>
    <button id="changeMasterPassword"></button>
    <div id="passwordModal" class="modal-overlay hidden">
      <div id="passwordModalTitle"></div><div id="passwordModalDesc"></div>
      <input id="masterPasswordInput" />
      <div id="passwordStrengthError"></div>
      <div id="confirmPasswordGroup" class="form-group">
        <label for="masterPasswordConfirm">Confirm</label>
        <input id="masterPasswordConfirm" />
        <div id="passwordMatchError"></div>
      </div>
      <div id="passwordStrength"><div class="strength-fill"></div></div>
      <div id="passwordStrengthText"></div>
      <button id="closePasswordModalBtn"></button><button id="cancelPasswordBtn"></button>
      <button id="savePasswordBtn"></button>
    </div>
    <div id="passwordAuthModal" class="modal-overlay hidden">
      <input id="masterPasswordAuthInput" /><div id="passwordAuthError"></div>
      <button id="closePasswordAuthModalBtn"></button><button id="cancelPasswordAuthBtn"></button>
      <button id="submitPasswordAuthBtn"></button>
    </div>`;
}

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const isHidden = (id: string): boolean => el(id).classList.contains('hidden');

async function initController(): Promise<void> {
  vi.resetModules();
  const { initMasterPasswordSettings } = await import('../masterPassword.js');
  initMasterPasswordSettings();
}

function toggleCheckbox(checked: boolean): void {
  const cb = el<HTMLInputElement>('masterPasswordEnabled');
  cb.checked = checked;
  cb.dispatchEvent(new Event('change'));
}

describe('dashboard master password UI state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDOM();
  });

  it('restores the checkbox to OFF when a set save fails', async () => {
    vi.mocked(isMasterPasswordSet).mockResolvedValue(false);
    vi.mocked(setMasterPasswordService).mockRejectedValue(new Error('boom'));
    await initController();
    toggleCheckbox(true);
    await waitForMock(() => expect(isHidden('passwordModal')).toBe(false));

    el('savePasswordBtn').click();

    await waitForMock(() => expect(showStatus).toHaveBeenCalledWith('status', 'boom', 'error'));
    expect(el<HTMLInputElement>('masterPasswordEnabled').checked).toBe(false);
    expect(showStatus).not.toHaveBeenCalledWith('status', expect.any(String), 'success');
  });

  it('restores the checkbox to ON after cancelling the remove auth modal', async () => {
    vi.mocked(isMasterPasswordSet).mockResolvedValue(true);
    await initController();
    toggleCheckbox(false);
    await waitForMock(() => expect(isHidden('passwordAuthModal')).toBe(false));

    el('cancelPasswordAuthBtn').click();

    await waitForMock(() => expect(el<HTMLInputElement>('masterPasswordEnabled').checked).toBe(true));
    expect(isHidden('passwordAuthModal')).toBe(true);
  });

  it('restores the checkbox to OFF after cancelling the set modal', async () => {
    vi.mocked(isMasterPasswordSet).mockResolvedValue(false);
    await initController();
    toggleCheckbox(true);
    await waitForMock(() => expect(isHidden('passwordModal')).toBe(false));

    el('cancelPasswordBtn').click();

    await waitForMock(() => expect(el<HTMLInputElement>('masterPasswordEnabled').checked).toBe(false));
  });

  it('shows the confirm group in set mode and hides it (with its input) in change mode', async () => {
    vi.mocked(isMasterPasswordSet).mockResolvedValue(true);
    vi.mocked(verifyMasterPassword).mockResolvedValue({ success: true });
    await initController();
    const { closePasswordModal } = await import('../masterPassword.js');

    el('changeMasterPassword').click();
    el<HTMLInputElement>('masterPasswordAuthInput').value = 'old-pw';
    el('submitPasswordAuthBtn').click();
    await waitForMock(() => expect(isHidden('passwordModal')).toBe(false));

    expect(isHidden('confirmPasswordGroup')).toBe(true);
    expect(isHidden('masterPasswordConfirm')).toBe(false);

    closePasswordModal();
    vi.mocked(isMasterPasswordSet).mockResolvedValue(false);
    toggleCheckbox(true);
    await waitForMock(() => expect(isHidden('passwordModal')).toBe(false));

    expect(isHidden('confirmPasswordGroup')).toBe(false);
  });
});
