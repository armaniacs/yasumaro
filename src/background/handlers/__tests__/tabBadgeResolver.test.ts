import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../utils/domainUtils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/domainUtils.js')>();
  return { ...actual, isDomainAllowed: vi.fn().mockResolvedValue(true) };
});

const { isDomainAllowed } = await import('../../../utils/domainUtils.js');
import { resolveTabBadge } from '../tabBadgeResolver.js';

describe('resolveTabBadge precedence table (PBI 2026-09-12-09)', () => {
  it('recorded wins on activate even when private', async () => {
    const state = await resolveTabBadge({
      privacyInfo: { isPrivate: true, timestamp: 0, headers: { hasCookie: false, hasAuth: false } },
      url: 'https://example.com',
      isRecorded: true,
      forActivation: true,
    });
    expect(state).toEqual({ kind: 'recorded' });
  });

  it('missing url clears without touching domain check', async () => {
    vi.mocked(isDomainAllowed).mockClear();
    const state = await resolveTabBadge({
      url: undefined,
      isRecorded: false,
      forActivation: true,
    });
    expect(state).toEqual({ kind: 'clear' });
    expect(isDomainAllowed).not.toHaveBeenCalled();
  });

  it('private beats excluded', async () => {
    vi.mocked(isDomainAllowed).mockResolvedValue(false);
    const state = await resolveTabBadge({
      privacyInfo: { isPrivate: true, timestamp: 0, headers: { hasCookie: false, hasAuth: false } },
      url: 'https://example.com',
      isRecorded: false,
      forActivation: true,
    });
    expect(state).toEqual({ kind: 'private' });
  });

  it('excluded beats recording tail', async () => {
    vi.mocked(isDomainAllowed).mockResolvedValue(false);
    const gate = vi.fn();
    const state = await resolveTabBadge({
      url: 'https://example.com',
      isRecorded: false,
      forActivation: true,
      isRecordingAllowed: gate,
    });
    expect(state).toEqual({ kind: 'excluded' });
    expect(gate).not.toHaveBeenCalled();
  });

  it('activate tail honors the recording gate lazily', async () => {
    vi.mocked(isDomainAllowed).mockResolvedValue(true);
    const gate = vi.fn().mockResolvedValue(true);
    expect(
      await resolveTabBadge({ url: 'https://example.com', isRecorded: false, forActivation: true, isRecordingAllowed: gate }),
    ).toEqual({ kind: 'recording' });
    gate.mockResolvedValue(false);
    expect(
      await resolveTabBadge({ url: 'https://example.com', isRecorded: false, forActivation: true, isRecordingAllowed: gate }),
    ).toEqual({ kind: 'clear' });
  });

  it('navigate tail always clears', async () => {
    vi.mocked(isDomainAllowed).mockResolvedValue(true);
    const gate = vi.fn();
    const state = await resolveTabBadge({
      url: 'https://example.com',
      isRecorded: false,
      forActivation: false,
      isRecordingAllowed: gate,
    });
    expect(state).toEqual({ kind: 'clear' });
    expect(gate).not.toHaveBeenCalled();
  });

  it('domain check failure fails open to non-excluded', async () => {
    vi.mocked(isDomainAllowed).mockRejectedValue(new Error('storage fail'));
    const gate = vi.fn().mockResolvedValue(false);
    const state = await resolveTabBadge({
      url: 'https://example.com',
      isRecorded: false,
      forActivation: true,
      isRecordingAllowed: gate,
    });
    expect(state).toEqual({ kind: 'clear' });
  });
});
