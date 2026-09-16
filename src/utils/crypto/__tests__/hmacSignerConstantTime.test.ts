/**
 * hmacSignerConstantTime.test.ts
 *
 * Pins that HmacSigner.verify routes its comparison through
 * `constantTimeCompare` rather than `===`.
 *
 * Kept in its own file because it mocks primitives.js, which the sibling
 * hmacSigner.test.ts deliberately does not — that suite compares real output
 * against independently computed legacy values, and a mocked primitives would
 * destroy the comparison.
 *
 * Why assert on the call rather than on timing: a timing measurement is
 * flaky under CI load and proves little at this size. What can be pinned
 * deterministically is that the constant-time helper is on the path at all —
 * which is exactly what a `===` regression would remove. Mutation testing
 * confirmed the gap: swapping `constantTimeCompare` for `===` left every
 * other test in the suite green.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Crypto } from '@peculiar/webcrypto';

Object.defineProperty(globalThis, 'crypto', { value: new Crypto(), configurable: true });

vi.mock('../primitives.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../primitives.js')>();
    return {
        ...actual,
        // Spy only; the real comparison still runs, so verify keeps its
        // actual accept/reject behaviour.
        constantTimeCompare: vi.fn(actual.constantTimeCompare),
    };
});

import { hmacSignerForSecret } from '../hmacSigner.js';
import { constantTimeCompare } from '../primitives.js';

const SECRET = 'constant-time-secret';

describe('HmacSigner.verify comparison path', () => {
    beforeEach(() => {
        vi.mocked(constantTimeCompare).mockClear();
    });

    it('compares through constantTimeCompare, not ===', async () => {
        const signer = hmacSignerForSecret(async () => SECRET, 'base64');
        const data = 'payload under verification';
        const signature = await signer.sign(data);

        expect(await signer.verify(data, signature)).toBe(true);
        expect(constantTimeCompare).toHaveBeenCalledTimes(1);
        expect(constantTimeCompare).toHaveBeenCalledWith(signature, signature);
    });

    it('still uses it when the signature is wrong', async () => {
        // The rejecting path is the one an attacker times, so it must not
        // short-circuit either.
        const signer = hmacSignerForSecret(async () => SECRET, 'base64');
        const correct = await signer.sign('payload');

        expect(await signer.verify('payload', 'AAAA' + correct.slice(4))).toBe(false);
        expect(constantTimeCompare).toHaveBeenCalledTimes(1);
    });

    it('still uses it when the signature length differs', async () => {
        // A length check that returns early before the comparison would be a
        // timing leak of its own; the helper folds length into its result.
        const signer = hmacSignerForSecret(async () => SECRET, 'base64');

        expect(await signer.verify('payload', 'short')).toBe(false);
        expect(constantTimeCompare).toHaveBeenCalledTimes(1);
    });

    it('rejects an empty signature without reaching the comparison', async () => {
        // The one documented short-circuit: an empty string carries no
        // secret to leak, and skipping avoids a pointless signing round.
        const signer = hmacSignerForSecret(async () => SECRET, 'base64');

        expect(await signer.verify('payload', '')).toBe(false);
        expect(constantTimeCompare).not.toHaveBeenCalled();
    });
});
