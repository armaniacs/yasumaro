import { describe, it, expect, vi, beforeEach } from 'vitest';
import { badgeDisplay, setBadge, type BadgeState } from '../badgePolicy.js';

const setBadgeText = vi.fn().mockResolvedValue(undefined);
const setBadgeBackgroundColor = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  setBadgeText.mockClear();
  setBadgeBackgroundColor.mockClear();
  (globalThis as { chrome?: unknown }).chrome = {
    action: { setBadgeText, setBadgeBackgroundColor },
  };
});

describe('badgeDisplay — the state table (PBI 2026-09-12-07)', () => {
  const table: Array<{ state: BadgeState; text: string; color: string | undefined }> = [
    { state: { kind: 'cleansed', count: 3 }, text: 'C3', color: '#10B981' },
    { state: { kind: 'recorded' }, text: '◎', color: '#3B82F6' },
    { state: { kind: 'private' }, text: '!', color: '#F97316' },
    { state: { kind: 'no-consent' }, text: '!', color: '#F97316' },
    { state: { kind: 'excluded' }, text: '∉', color: '#10B981' },
    { state: { kind: 'recording' }, text: '●', color: '#10B981' },
    { state: { kind: 'clear' }, text: '', color: undefined },
  ];

  it.each(table)('$state renders "$text"', ({ state, text, color }) => {
    const display = badgeDisplay(state);
    expect(display.text).toBe(text);
    expect(display.color).toBe(color);
  });
});

describe('setBadge — scoping discipline', () => {
  it('per-tab writes carry the tabId on both text and color', async () => {
    await setBadge({ kind: 'cleansed', count: 5 }, 42);

    expect(setBadgeText).toHaveBeenCalledWith(expect.objectContaining({ text: 'C5', tabId: 42 }));
    expect(setBadgeBackgroundColor).toHaveBeenCalledWith(expect.objectContaining({ tabId: 42 }));
  });

  it('global writes (no-consent) omit tabId', async () => {
    await setBadge({ kind: 'no-consent' });

    expect(setBadgeText).toHaveBeenCalledWith(expect.not.objectContaining({ tabId: expect.anything() }));
    expect(setBadgeBackgroundColor).toHaveBeenCalledWith(expect.not.objectContaining({ tabId: expect.anything() }));
  });

  it('clear writes only touch the badge text', async () => {
    await setBadge({ kind: 'clear' }, 7);

    expect(setBadgeText).toHaveBeenCalledWith(expect.objectContaining({ text: '', tabId: 7 }));
    expect(setBadgeBackgroundColor).not.toHaveBeenCalled();
  });
});
