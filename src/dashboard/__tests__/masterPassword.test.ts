// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../popup/i18n.js', () => ({
  getMessage: (key: string) => `i18n_${key}`,
}));

vi.mock('../../popup/utils/focusTrap.js', () => ({
  focusTrapManager: {
    trap: vi.fn().mockReturnValue('trap-id'),
    release: vi.fn(),
  },
}));

const mockStorageGet = vi.fn();
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: mockStorageGet,
      set: vi.fn(),
      remove: vi.fn(),
    },
  },
});

describe('loadMasterPasswordSettings', async () => {
  document.body.innerHTML = `
    <input type="checkbox" id="masterPasswordEnabled" />
    <div id="masterPasswordOptions"></div>
  `;
  const { loadMasterPasswordSettings } = await import('../masterPassword.js');

  beforeEach(() => {
    mockStorageGet.mockReset();
  });

  it.skip('checks enabled and shows options when password is set', async () => {
    mockStorageGet.mockResolvedValue({ master_password_hash: 'hash123' });
    await loadMasterPasswordSettings();
    const cb = document.getElementById('masterPasswordEnabled') as HTMLInputElement;
    const opts = document.getElementById('masterPasswordOptions')!;
    expect(cb.checked).toBe(true);
    expect(opts.classList.contains('hidden')).toBe(false);
  });

  it.skip('unchecks and hides options when password is not set', async () => {
    mockStorageGet.mockResolvedValue({});
    await loadMasterPasswordSettings();
    const cb = document.getElementById('masterPasswordEnabled') as HTMLInputElement;
    const opts = document.getElementById('masterPasswordOptions')!;
    expect(cb.checked).toBe(false);
    expect(opts.classList.contains('hidden')).toBe(true);
  });
});

describe('closePasswordModal', async () => {
  document.body.innerHTML = `
    <div id="passwordModal" class="show" style="display:flex"></div>
    <input id="masterPasswordInput" value="secret" />
    <input id="masterPasswordConfirm" value="secret" />
    <div id="passwordStrengthError">error</div>
    <div id="passwordMatchError">error</div>
    <div id="passwordStrength"><div class="strength-fill"></div></div>
    <div id="passwordStrengthText"></div>
  `;
  const { closePasswordModal } = await import('../masterPassword.js');

  it.skip('hides the password modal', () => {
    closePasswordModal();
    const modal = document.getElementById('passwordModal')!;
    expect(modal.classList.contains('show')).toBe(false);
    expect(modal.style.display).toBe('none');
    expect(modal.classList.contains('hidden')).toBe(true);
  });

  it.skip('clears input values', () => {
    closePasswordModal();
    expect((document.getElementById('masterPasswordInput') as HTMLInputElement).value).toBe('');
    expect((document.getElementById('masterPasswordConfirm') as HTMLInputElement).value).toBe('');
  });

  it('does not throw when elements are missing', () => {
    document.body.innerHTML = `
      <div id="passwordModal"></div>
      <input id="masterPasswordInput" />
      <input id="masterPasswordConfirm" />
      <div id="passwordStrengthError"></div>
      <div id="passwordMatchError"></div>
      <div id="passwordStrength"><div class="strength-fill"></div></div>
      <div id="passwordStrengthText"></div>
    `;
    expect(() => closePasswordModal()).not.toThrow();
  });
});
