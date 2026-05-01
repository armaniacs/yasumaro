import { describe, it, expect, vi } from 'vitest';

// Ensure btoa/atob polyfill unconditionally for test environment
global.btoa = (str: string) => Buffer.from(str, 'binary').toString('base64');
global.atob = (b64: string) => Buffer.from(b64, 'base64').toString('binary');
console.log('Polyfill applied: btoa =', typeof global.btoa, 'atob =', typeof global.atob);

// Mock dependencies before importing modules under test
vi.mock('../../../utils/crypto.js', () => ({
  getNotificationHmacKey: vi.fn().mockImplementation(async () => { console.log('>> getNotificationHmacKey called'); return 'test-key'; }),
  generateHmacSignature: vi.fn().mockImplementation(async (data: string, key: any) => { console.log('>> generateHmacSignature called with', data); return 'signature123'; }),
  verifyHmacSignature: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../../utils/logger.js', () => ({
  logError: vi.fn().mockResolvedValue(undefined),
  logWarn: vi.fn().mockResolvedValue(undefined),
  ErrorCode: { CRYPTO_HMAC_FAILURE: 'CRYPTO_HMAC_FAILURE' },
}));

import { encodeUrlSafeBase64, decodeUrlFromNotificationId, createNotificationId, getUrlFromNotificationId } from '../urlNotificationHandlers.js';
import { ErrorCode, logWarn } from '../../../utils/logger.js';


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

   it('throws when URL exceeds encoded length limit', async () => {
     // For maxLength=256, maxUrlLength ~ (256 - 14 - 43) * 0.75 ≈ 149.25
     // Create a URL longer than that
     const longUrl = 'https://example.com/' + 'a'.repeat(200);
     await expect(encodeUrlSafeBase64(longUrl, 256)).rejects.toThrow('URL too long for notification ID');
   });

    it('throws when encoding fails due to crypto error', async () => {
      const crypto = await import('../../../utils/crypto.js');
      vi.mocked(crypto.getNotificationHmacKey).mockRejectedValueOnce(new Error('Crypto unavailable'));
      await expect(encodeUrlSafeBase64('https://example.com')).rejects.toThrow('encodeUrlSafeBase64: Failed to encode URL');
    });
});

describe('decodeUrlFromNotificationId', () => {
   it('decodes valid notification ID', async () => {
     const url = 'https://example.com/test';
     try {
       const encoded = await encodeUrlSafeBase64(url);
       const decoded = await decodeUrlFromNotificationId(encoded);
       expect(decoded).toBe(url);
     } catch (e: any) {
       console.error('encode/decode error:', e);
       throw e;
     }
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

    it('throws Invalid signature when verification fails', async () => {
      const crypto = await import('../../../utils/crypto.js');
      vi.mocked(crypto.verifyHmacSignature).mockResolvedValueOnce(false);
      const url = 'https://example.com/test';
      const encoded = await encodeUrlSafeBase64(url);
      await expect(decodeUrlFromNotificationId(encoded)).rejects.toThrow('Invalid signature');
      expect(logWarn).toHaveBeenCalledWith(
        'HMAC signature verification failed for notification',
        expect.objectContaining({ urlHash: expect.stringContaining('...') }),
        ErrorCode.CRYPTO_HMAC_FAILURE,
        'notification-helpers'
      );
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
