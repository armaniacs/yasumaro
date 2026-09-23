/**
 * providerOriginConfirmation.ts
 * Dashboard-side seam for the provider baseUrl origin-authorization policy
 * (VULN-002 fix): before a settings write carries a provider base URL whose
 * origin is new (not pinned, not loopback, not yet confirmed), the user must
 * explicitly acknowledge that origin. Confirmations are device-local security
 * state — they are never exported and imports cannot smuggle them in.
 */

import { getMessage } from '../utils/i18n.js';
import { showConfirmDialog } from '../utils/ui/confirmDialog.js';
import { settingsRepository } from '../utils/storage/SettingsRepository.js';
import { StorageKeys, type Settings } from '../utils/storage/types.js';
import { PROVIDER_ALLOWLIST_ROWS, isProviderOriginAuthorized } from '../utils/storage/providerAllowlist.js';

export type ProviderOriginConfirmationResult = 'noop' | 'confirmed' | 'cancelled';

interface PendingOrigin {
    label: string;
    origin: string;
    baseUrlKey: string;
}

/**
 * Check the settings delta for provider base URLs that would send the
 * provider credential to a new non-local origin. Returns 'cancelled' when the
 * user declines; otherwise the delta is either untouched ('noop') or amended
 * with the recorded confirmations ('confirmed') and safe to persist.
 */
export async function confirmNewProviderBaseUrls(delta: Partial<Settings>): Promise<ProviderOriginConfirmationResult> {
    const saved = await settingsRepository.getAll();
    const confirmedMap: Record<string, string[]> = {
        ...((saved[StorageKeys.CONFIRMED_PROVIDER_ORIGINS] as Record<string, string[]> | undefined) ?? {}),
    };
    const pending: PendingOrigin[] = [];

    for (const row of PROVIDER_ALLOWLIST_ROWS) {
        if (!row.baseUrlKey || row.isLocal) continue;
        const next = (delta as Record<string, unknown>)[row.baseUrlKey];
        if (typeof next !== 'string' || next === '') continue;
        const current = (saved as Record<string, unknown>)[row.baseUrlKey];
        if (current === next) continue;
        const confirmed = isProviderOriginAuthorized(next, row, new Set(confirmedMap[row.baseUrlKey] ?? []));
        if (confirmed.authorized) continue;
        let origin: string;
        try {
            origin = new URL(next).origin;
        } catch {
            // Invalid URLs are rejected by their own validation path.
            continue;
        }
        pending.push({ label: row.label, origin, baseUrlKey: row.baseUrlKey });
    }

    if (pending.length === 0) return 'noop';

    const originList = pending.map((p) => `- ${p.label}: ${p.origin}`).join('\n');
    const confirmed = await showConfirmDialog({
        title: getMessage('providerOriginConfirmTitle') || 'Confirm provider endpoints',
        message: (getMessage('providerOriginConfirmMessage') || 'API keys and page content will be sent to these origins. Allow them?') + '\n' + originList,
        confirmLabel: getMessage('providerOriginConfirmAllow') || 'Allow',
        cancelLabel: getMessage('cancel') || 'Cancel',
    });
    if (!confirmed) return 'cancelled';

    for (const p of pending) {
        const existing = confirmedMap[p.baseUrlKey] ?? [];
        if (!existing.includes(p.origin)) {
            confirmedMap[p.baseUrlKey] = [...existing, p.origin];
        }
    }
    delta[StorageKeys.CONFIRMED_PROVIDER_ORIGINS] = confirmedMap;
    return 'confirmed';
}
