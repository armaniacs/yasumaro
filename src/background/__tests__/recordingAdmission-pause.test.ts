import { describe, expect, it, vi } from 'vitest';
import { RecordingAdmission } from '../recordingAdmission.js';

describe('admission while paused', () => {
  it('rejects valid-visit with recording_paused but admits manual', async () => {
    await chrome.storage.local.set({ recording_paused_until: Date.now() + 30 * 60_000 });
    const admission = new RecordingAdmission({
      isRecordingAllowed: async () => true,
      getSettings: async () => ({}) as never,
      rateLimiter: { check: async () => ({ allowed: true }) } as never,
    });
    const sender = { tab: { id: 1, url: 'https://example.com/' } } as chrome.runtime.MessageSender;
    const paused = await admission.admit('valid-visit', sender);
    expect(paused).toEqual({ rejected: { success: false, reason: 'recording_paused' } });
    expect(await admission.admit('manual', sender)).toHaveProperty('settings');
  });

  it('fails open when pause storage errors (never throws out of the union)', async () => {
    const getMock = chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>;
    getMock.mockRejectedValueOnce(new Error('storage unavailable'));
    const admission = new RecordingAdmission({
      isRecordingAllowed: async () => true,
      getSettings: async () => ({}) as never,
      rateLimiter: { check: async () => ({ allowed: true }) } as never,
    });
    // Distinct registrable domain from the test above: the per-URL flood
    // guard (5s window) would otherwise return rate_limited here.
    const sender = { tab: { id: 2, url: 'https://other-example.com/' } } as chrome.runtime.MessageSender;
    await expect(admission.admit('valid-visit', sender)).resolves.toEqual({ settings: {} });
  });
});
