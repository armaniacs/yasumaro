/**
 * webhookExportCrypto.ts
 *
 * Webhook destination URL protection (PBI 2026-11-24-15, C-1).
 *
 * The URL may carry a token in its query or path, so it is stored with the
 * same protection as API keys: AES-GCM via the existing `encryptApiKey`
 * seam, AAD-bound to WEBHOOK_EXPORT_URL_FIELD. Decryption failure is the
 * caller's to treat as fail-closed (the settings loader returns the
 * disabled default, so the sender never egresses).
 *
 * Key management reuses the app-wide encryption session
 * (`getOrCreateEncryptionKey`), so master-password rotations keep working.
 */

import type { EncryptedData } from '../../utils/crypto/types.js';
import { decryptApiKey, encryptApiKey, isEncrypted } from '../../utils/crypto/index.js';
import { getOrCreateEncryptionKey } from '../../utils/storage/encryptionSession.js';

/** AAD binding for the webhook destination URL envelope. */
export const WEBHOOK_EXPORT_URL_FIELD = 'webhook_export_url';

/** Injectable crypto seam for the webhook settings store. */
export interface WebhookUrlCrypto {
  encryptUrl(plain: string): Promise<EncryptedData>;
  decryptUrl(stored: EncryptedData | string): Promise<string>;
}

/** Production seam: API-key-grade encryption bound to the URL field. */
export function createDefaultWebhookUrlCrypto(
  keyProvider: () => Promise<CryptoKey> = getOrCreateEncryptionKey,
): WebhookUrlCrypto {
  return {
    async encryptUrl(plain: string): Promise<EncryptedData> {
      const key: CryptoKey = await keyProvider();
      return encryptApiKey(plain, key, WEBHOOK_EXPORT_URL_FIELD);
    },
    async decryptUrl(stored: EncryptedData | string): Promise<string> {
      if (typeof stored === 'string') {
        return stored;
      }
      const key: CryptoKey = await keyProvider();
      return decryptApiKey(stored, key, WEBHOOK_EXPORT_URL_FIELD);
    },
  };
}

/** True when the stored URL value is an encrypted envelope. */
export function isEncryptedUrlValue(value: EncryptedData | string): value is EncryptedData {
  return isEncrypted(value);
}
