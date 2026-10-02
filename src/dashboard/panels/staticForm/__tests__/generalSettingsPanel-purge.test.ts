// @vitest-environment jsdom
/**
 * The two purge buttons are wired to async handlers from this panel, so a
 * rejected gateway call used to leave the status span blank and the rejection
 * unhandled. The handlers now own the failure text; the click wrapper is the
 * outer boundary for anything the handler itself does not anticipate.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installTestSecretKek } from '../../../../utils/crypto/__tests__/secretKekHelper.js';
import { waitForMock } from '../../../../../testDir/waitPolicy.js';

vi.mock('../../../dashboardSqliteService.js', async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return { ...orig, purgeOldRecordsNow: vi.fn(), purgeContentNow: vi.fn() };
});

import { createGeneralSettingsPanel } from '../generalSettingsPanel.js';
import * as sqliteService from '../../../dashboardSqliteService.js';

const PURGE_MARKUP = `
  <div id="panel-general">
    <button id="purgeNowBtn"></button>
    <span id="purgeNowStatus"></span>
    <button id="contentPurgeNowBtn"></button>
    <span id="contentPurgeNowStatus"></span>
  </div>`;

async function mountPanel(): Promise<void> {
  const panel = createGeneralSettingsPanel();
  await panel.mount(document.getElementById('panel-general')!);
}

beforeEach(async () => {
  await installTestSecretKek();
  document.body.innerHTML = PURGE_MARKUP;
  vi.mocked(sqliteService.purgeOldRecordsNow).mockReset();
  vi.mocked(sqliteService.purgeContentNow).mockReset();
});

describe('generalSettingsPanel — purge error boundary', () => {
  it('renders a rejected record purge and re-enables the button', async () => {
    vi.mocked(sqliteService.purgeOldRecordsNow).mockRejectedValue(new Error('gateway down'));

    await mountPanel();
    const btn = document.getElementById('purgeNowBtn') as HTMLButtonElement;
    const status = document.getElementById('purgeNowStatus')!;
    btn.click();

    await waitForMock(() => expect(status.textContent).toBe('gateway down'));
    expect(btn.disabled).toBe(false);
  });

  it('renders a rejected content purge and re-enables the button', async () => {
    vi.mocked(sqliteService.purgeContentNow).mockRejectedValue(new Error('gateway down'));

    await mountPanel();
    const btn = document.getElementById('contentPurgeNowBtn') as HTMLButtonElement;
    const status = document.getElementById('contentPurgeNowStatus')!;
    btn.click();

    await waitForMock(() => expect(status.textContent).toBe('gateway down'));
    expect(btn.disabled).toBe(false);
  });

  it('logs instead of rejecting when a throw escapes the handler itself', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(sqliteService.purgeOldRecordsNow).mockResolvedValue({ data: { purged: 1, skipped: false } } as never);

    await mountPanel();
    const btn = document.getElementById('purgeNowBtn') as HTMLButtonElement;
    const status = document.getElementById('purgeNowStatus')!;
    // Throws from the pre-try status clear, so the handler's own catch cannot
    // see it — only the click wrapper can.
    Object.defineProperty(status, 'textContent', {
      configurable: true,
      get: () => '',
      set: () => { throw new Error('render failed'); },
    });

    btn.click();

    await waitForMock(() =>
      expect(errorSpy).toHaveBeenCalledWith('General settings: purge failed', expect.any(Error)),
    );
    errorSpy.mockRestore();
  });
});
