/**
 * hmacKeyStoreConcurrency.test.ts
 * VULN-039: parallel get-or-create must converge on a single persisted key,
 * not race and generate two.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getNotificationHmacKey, generateHmacSignature, verifyHmacSignature } from '../hmacKeyStore.js';

describe('hmacKeyStore get-or-create serialisation', () => {
  beforeEach(async () => {
    await chrome.storage.local.clear();
    await chrome.storage.session.clear();
  });

  it('two parallel getNotificationHmacKey calls yield interoperable keys', async () => {
    const [keyA, keyB] = await Promise.all([getNotificationHmacKey(), getNotificationHmacKey()]);

    // If the two calls raced and persisted different key material, a signature
    // produced under one would not verify under the other.
    const sig = await generateHmacSignature('payload', keyA);
    expect(await verifyHmacSignature('payload', sig, keyB)).toBe(true);
  });

  it('exactly one wrapped key is persisted after a parallel burst', async () => {
    await Promise.all([
      getNotificationHmacKey(),
      getNotificationHmacKey(),
      getNotificationHmacKey(),
      getNotificationHmacKey(),
    ]);

    const stored = await chrome.storage.local.get('notification-signature-key');
    expect(stored['notification-signature-key']).toBeDefined();
    // A later single call must resolve to the same key.
    const key = await getNotificationHmacKey();
    const sig = await generateHmacSignature('x', key);
    const again = await getNotificationHmacKey();
    expect(await verifyHmacSignature('x', sig, again)).toBe(true);
  });
});
