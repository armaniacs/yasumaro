// @vitest-environment wasm-quickjs-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/i18n.js', async () => {
  const { mockGetMessage: i18nMock } = await import('../../../testDir/i18nMock.js');
  const getMessage = vi.fn((key: string) => `i18n_${key}`);
  return i18nMock(getMessage);
});

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
  calculatePasswordStrength: vi.fn(),
  validatePasswordRequirements: vi.fn(),
  validatePasswordMatch: vi.fn(),
  PasswordStrength: { WEAK: 'weak', MEDIUM: 'medium', STRONG: 'strong' },
}));

vi.mock('../../utils/storage/encryptionSession.js', () => ({
  setMasterPassword: vi.fn(),
  changeMasterPassword: vi.fn(),
  removeMasterPassword: vi.fn(),
  recoverForgotMasterPassword: vi.fn(),
  verifyMasterPasswordWithRehash: vi.fn(),
  isMasterPasswordEnabled: vi.fn(),
  ReencryptionAbortedError: class ReencryptionAbortedError extends Error {
    fields: readonly string[];
    constructor(fields: readonly string[]) {
      super(`ReencryptionAbortedError: ${fields.length} field(s)`);
      this.name = 'ReencryptionAbortedError';
      this.fields = fields;
    }
  },
  MasterPasswordAlreadySetError: class MasterPasswordAlreadySetError extends Error {},
  PendingRotationMismatchError: class PendingRotationMismatchError extends Error {},
  RotationInProgressError: class RotationInProgressError extends Error {},
}));

vi.mock('../../utils/masterPasswordUiCore.js', () => ({
  validateAndSetPasswordErrors: vi.fn().mockReturnValue(false),
  validateAndSetMatchErrors: vi.fn().mockReturnValue(false),
  updatePasswordStrengthDisplay: vi.fn(),
}));

vi.mock('../../utils/rateLimiter.js', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ success: true }),
  recordFailedAttempt: vi.fn().mockResolvedValue(undefined),
  resetFailedAttempts: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../utils/ui/confirmDialog.js', () => ({
  showConfirmDialog: vi.fn(),
  showAlertDialog: vi.fn(),
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

import { showStatus } from '../../utils/ui/settingsUiHelper.js';
import {
  recoverForgotMasterPassword as recoverService,
  isMasterPasswordEnabled,
} from '../../utils/storage/encryptionSession.js';
import { showConfirmDialog } from '../../utils/ui/confirmDialog.js';
import { MasterPasswordController } from '../masterPassword.js';
import { drainMacrotask, waitForMock } from '../../../testDir/waitPolicy.js';

function setupForgotDOM(): void {
  document.body.innerHTML = [
    '<input type="checkbox" id="masterPasswordEnabled" />',
    '<div id="masterPasswordOptions"></div>',
    '<div id="masterPasswordWarning"></div>',
    '<button id="setMasterPasswordNowBtn"></button>',
    '<button id="changeMasterPassword"></button>',
    '<button id="forgotMasterPasswordBtn"></button>',
    '<div id="passwordModal">',
    '  <input id="masterPasswordInput" />',
    '  <input id="masterPasswordConfirm" />',
    '  <div id="passwordStrengthError"></div>',
    '  <div id="passwordMatchError"></div>',
    '  <button id="closePasswordModalBtn"></button>',
    '  <button id="cancelPasswordBtn"></button>',
    '  <button id="savePasswordBtn"></button>',
    '</div>',
    '<div id="passwordAuthModal" class="hidden">',
    '  <input id="masterPasswordAuthInput" />',
    '  <div id="passwordAuthError"></div>',
    '  <div id="passwordAuthProgress"></div>',
    '  <button id="closePasswordAuthModalBtn"></button>',
    '  <button id="cancelPasswordAuthBtn"></button>',
    '  <button id="submitPasswordAuthBtn"></button>',
    '</div>',
  ].join('\n');
}

beforeEach(() => {
  vi.clearAllMocks();
  setupForgotDOM();
  vi.mocked(isMasterPasswordEnabled).mockResolvedValue(true);
});

describe('masterPassword forgot recovery (Outside-In)', () => {
  it('does not delete on two clicks alone without explicit confirmation', async () => {
    const controller = new MasterPasswordController();
    controller.initEventListeners();
    vi.mocked(recoverService).mockResolvedValue(undefined);
    vi.mocked(showConfirmDialog).mockResolvedValue(false);
    (document.getElementById('masterPasswordEnabled') as HTMLInputElement).checked = true;

    const btn = document.getElementById('forgotMasterPasswordBtn') as HTMLButtonElement;
    btn.click();
    await drainMacrotask();
    // First click only arms: no deletion and no dialog yet.
    expect(recoverService).not.toHaveBeenCalled();
    expect(showConfirmDialog).not.toHaveBeenCalled();

    btn.click();
    await waitForMock(() => expect(showConfirmDialog).toHaveBeenCalledTimes(1));
    await drainMacrotask();

    // Explicit confirmation declined: no deletion.
    expect(recoverService).not.toHaveBeenCalled();
  });

  it('completes recovery and guides API key re-entry only after explicit confirmation', async () => {
    const controller = new MasterPasswordController();
    controller.initEventListeners();
    vi.mocked(recoverService).mockResolvedValue(undefined);
    vi.mocked(showConfirmDialog).mockResolvedValue(true);
    (document.getElementById('masterPasswordEnabled') as HTMLInputElement).checked = true;

    const btn = document.getElementById('forgotMasterPasswordBtn') as HTMLButtonElement;
    btn.click();
    await drainMacrotask();
    expect(recoverService).not.toHaveBeenCalled();

    btn.click();
    await waitForMock(() => expect(recoverService).toHaveBeenCalledTimes(1));

    expect(showConfirmDialog).toHaveBeenCalledWith(
      expect.objectContaining({ dangerous: true }),
    );
    expect(showStatus).toHaveBeenCalledWith(
      'status',
      expect.stringMatching(/再入力|re-enter|reenter/i),
      'success',
    );
    const enabled = document.getElementById('masterPasswordEnabled') as HTMLInputElement;
    expect(enabled.checked).toBe(false);
  });

  it('failure: armed state resets without deletion when settings reload', async () => {
    const controller = new MasterPasswordController();
    controller.initEventListeners();
    vi.mocked(isMasterPasswordEnabled).mockResolvedValue(true);
    vi.mocked(showConfirmDialog).mockResolvedValue(true);

    const btn = document.getElementById('forgotMasterPasswordBtn') as HTMLButtonElement;
    btn.click();
    await drainMacrotask();
    await controller.loadSettings();
    btn.click();
    await drainMacrotask();

    // Reload disarmed the first click, so this click only re-arms.
    expect(showConfirmDialog).not.toHaveBeenCalled();
    expect(recoverService).not.toHaveBeenCalled();
  });

  it('normal remove path still opens the password auth modal (old password required)', async () => {
    const controller = new MasterPasswordController();
    controller.initEventListeners();
    vi.mocked(isMasterPasswordEnabled).mockResolvedValue(true);

    const enabled = document.getElementById('masterPasswordEnabled') as HTMLInputElement;
    enabled.checked = true;
    enabled.dispatchEvent(new Event('change', { bubbles: true }));
    await drainMacrotask();

    // Checkbox-off routes to the auth modal, never to the forgot path.
    expect(recoverService).not.toHaveBeenCalled();
    expect(showConfirmDialog).not.toHaveBeenCalled();
    const authModal = document.getElementById('passwordAuthModal') as HTMLElement;
    expect(authModal.classList.contains('hidden')).toBe(false);
  });
});
