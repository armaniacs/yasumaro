import { describe, it, expect, vi } from 'vitest';
import { isCredentialConfigured } from '../settingsConfiguredCheck.js';
import { StorageKeys } from '../../../utils/storage/types.js';

describe('isCredentialConfigured', () => {
  it('returns true when the value meets the minimum length', async () => {
    const reader = { getMany: vi.fn().mockResolvedValue({ [StorageKeys.GITHUB_PAT]: 'abc' }), getAll: vi.fn() };

    expect(await isCredentialConfigured(reader, StorageKeys.GITHUB_PAT, 1)).toBe(true);
  });

  it('returns false when the value is shorter than the minimum length', async () => {
    const reader = { getMany: vi.fn().mockResolvedValue({ [StorageKeys.OBSIDIAN_API_KEY]: 'short' }), getAll: vi.fn() };

    expect(await isCredentialConfigured(reader, StorageKeys.OBSIDIAN_API_KEY, 16)).toBe(false);
  });

  it('returns true at the exact boundary length', async () => {
    const reader = { getMany: vi.fn().mockResolvedValue({ [StorageKeys.OBSIDIAN_API_KEY]: 'a'.repeat(16) }), getAll: vi.fn() };

    expect(await isCredentialConfigured(reader, StorageKeys.OBSIDIAN_API_KEY, 16)).toBe(true);
  });

  it('returns false when the value is missing', async () => {
    const reader = { getMany: vi.fn().mockResolvedValue({}), getAll: vi.fn() };

    expect(await isCredentialConfigured(reader, StorageKeys.GITHUB_PAT, 1)).toBe(false);
  });

  it('returns false when the value is not a string (e.g. still encrypted)', async () => {
    const reader = { getMany: vi.fn().mockResolvedValue({ [StorageKeys.GITHUB_PAT]: { iv: 'x', data: 'y' } }), getAll: vi.fn() };

    expect(await isCredentialConfigured(reader, StorageKeys.GITHUB_PAT, 1)).toBe(false);
  });

  it('returns false and does not throw when the reader rejects', async () => {
    const reader = { getMany: vi.fn().mockRejectedValue(new Error('storage error')), getAll: vi.fn() };

    expect(await isCredentialConfigured(reader, StorageKeys.GITHUB_PAT, 1)).toBe(false);
  });

  it('defaults minLength to 1 (empty string is not configured)', async () => {
    const reader = { getMany: vi.fn().mockResolvedValue({ [StorageKeys.GITHUB_PAT]: '' }), getAll: vi.fn() };

    expect(await isCredentialConfigured(reader, StorageKeys.GITHUB_PAT)).toBe(false);
  });
});
