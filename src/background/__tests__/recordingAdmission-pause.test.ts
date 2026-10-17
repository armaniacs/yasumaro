import { describe, expect, it } from 'vitest';
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
});
