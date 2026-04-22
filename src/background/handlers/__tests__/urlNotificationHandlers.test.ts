import { describe, it, expect, vi } from 'vitest';
import { encodeUrlSafeBase64, decodeUrlFromNotificationId, createNotificationId, getUrlFromNotificationId } from '../urlNotificationHandlers.js';

vi.mock('../../utils/crypto.js', () => ({
  getNotificationHmacKey: vi.fn().mockResolvedValue('test-key'),
  generateHmacSignature: vi.fn().mockResolvedValue('signature123'),
  verifyHmacSignature: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../utils/logger.js', () => ({
  logError: vi.fn().mockResolvedValue(undefined),
  logWarn: vi.fn().mockResolvedValue(undefined),
  ErrorCode: { CRYPTO_HMAC_FAILURE: 'CRYPTO_HMAC_FAILURE' },
}));

describe('encodeUrlSafeBase64', () => {
  it('encodes valid URL', async () => {
    const encoded = await encodeUrlSafeBase64('https://example.com/path');
    expect(encoded).toContain('privacy-confirm-');
  });

  it('throws for empty URL', async () => {
    await expect(encodeUrlSafeBase64('')).rejects.toThrow('Invalid URL');
  });

  it('throws for non-string URL', async () => {
    await expect(encodeUrlSafeBase64(null as unknown as string)).rejects.toThrow('Invalid URL');
  });

  it('throws for URL too long', async () => {
    const longUrl = 'https://example.com/' + 'a'.repeat(3000);
    await expect(encodeUrlSafeBase64(longUrl)).rejects.toThrow('URL too long');
  });
});

describe('decodeUrlFromNotificationId', () => {
  it('decodes valid notification ID', async () => {
    const url = 'https://example.com/test';
    const encoded = await encodeUrlSafeBase64(url);
    const decoded = await decodeUrlFromNotificationId(encoded);
    expect(decoded).toBe(url);
  });

  it('throws for empty ID', async () => {
    await expect(decodeUrlFromNotificationId('')).rejects.toThrow('Invalid notification ID');
  });

  it('throws for invalid prefix', async () => {
    await expect(decodeUrlFromNotificationId('invalid-id')).rejects.toThrow('Invalid notification ID prefix');
  });

  it('throws for too long ID', async () => {
    await expect(decodeUrlFromNotificationId('privacy-confirm-' + 'a'.repeat(6000))).rejects.toThrow('Notification ID too long');
  });

  it('throws for invalid format', async () => {
    await expect(decodeUrlFromNotificationId('privacy-confirm-nosignature')).rejects.toThrow('Invalid notification ID format');
  });
});

describe('createNotificationId', () => {
  it('delegates to encodeUrlSafeBase64', async () => {
    const result = await createNotificationId('https://test.com');
    expect(result).toContain('privacy-confirm-');
  });
});

describe('getUrlFromNotificationId', () => {
  it('delegates to decodeUrlFromNotificationId', async () => {
    const url = 'https://test.com';
    const id = await createNotificationId(url);
    const decoded = await getUrlFromNotificationId(id);
    expect(decoded).toBe(url);
  });
});
