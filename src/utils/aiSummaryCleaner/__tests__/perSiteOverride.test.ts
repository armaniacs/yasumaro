import { describe, it, expect } from 'vitest';
import { getCleansingConfigForDomain, normalizeDomain, upsertDomainOverride } from '../perSiteOverride.js';
import type { DomainCleansingOverride } from '../../storage/types.js';

describe('perSiteOverride', () => {
    const base = {
        aiSummaryCleansingDeep: false,
        aiSummaryCleansingAds: true,
        aiSummaryCleansingAlt: true,
        contentStripHardEnabled: true,
    } as unknown as Record<string, unknown>;

    it('returns base when no overrides', () => {
        const out = getCleansingConfigForDomain('example.com', base, []);
        expect(out).toBe(base);
    });

    it('returns base when domain not matched', () => {
        const overrides: DomainCleansingOverride[] = [
            { domain: 'example.com', overrides: { aiSummaryCleansingDeep: true } },
        ];
        const out = getCleansingConfigForDomain('other.com', base, overrides);
        expect(out).toBe(base);
    });

    it('merges override when domain matches exactly', () => {
        const overrides: DomainCleansingOverride[] = [
            { domain: 'example.com', overrides: { aiSummaryCleansingDeep: true } },
        ];
        const out = getCleansingConfigForDomain('example.com', base, overrides) as Record<string, unknown>;
        expect(out.aiSummaryCleansingDeep).toBe(true);
        expect(out.aiSummaryCleansingAds).toBe(true);
        expect(out).not.toBe(base);
    });

    it('is case-insensitive and trim-insensitive', () => {
        const overrides: DomainCleansingOverride[] = [
            { domain: 'Example.COM ', overrides: { aiSummaryCleansingDeep: true } },
        ];
        const out = getCleansingConfigForDomain(' example.com', base, overrides) as Record<string, unknown>;
        expect(out.aiSummaryCleansingDeep).toBe(true);
    });

    it('subdomain is separate (exact match only)', () => {
        const overrides: DomainCleansingOverride[] = [
            { domain: 'example.com', overrides: { aiSummaryCleansingDeep: true } },
        ];
        const out = getCleansingConfigForDomain('sub.example.com', base, overrides);
        expect(out).toBe(base);
    });

    it('multiple domains — picks correct one', () => {
        const overrides: DomainCleansingOverride[] = [
            { domain: 'a.com', overrides: { aiSummaryCleansingDeep: true } },
            { domain: 'b.com', overrides: { aiSummaryCleansingAds: false } },
        ];
        const outA = getCleansingConfigForDomain('a.com', base, overrides) as Record<string, unknown>;
        const outB = getCleansingConfigForDomain('b.com', base, overrides) as Record<string, unknown>;
        expect(outA.aiSummaryCleansingDeep).toBe(true);
        expect(outB.aiSummaryCleansingAds).toBe(false);
    });

    it('does not mutate base', () => {
        const overrides: DomainCleansingOverride[] = [
            { domain: 'example.com', overrides: { aiSummaryCleansingDeep: true } },
        ];
        const copy = { ...base };
        getCleansingConfigForDomain('example.com', base, overrides);
        expect(base).toEqual(copy);
    });

    it('empty domain returns base', () => {
        const overrides: DomainCleansingOverride[] = [
            { domain: 'example.com', overrides: { aiSummaryCleansingDeep: true } },
        ];
        expect(getCleansingConfigForDomain('', base, overrides)).toBe(base);
        expect(getCleansingConfigForDomain('   ', base, overrides)).toBe(base);
    });

    it('handles null/undefined overrides', () => {
        expect(getCleansingConfigForDomain('example.com', base, null as unknown as DomainCleansingOverride[])).toBe(base);
        expect(getCleansingConfigForDomain('example.com', base, undefined as unknown as DomainCleansingOverride[])).toBe(base);
    });

    it('handles empty override object -> returns base', () => {
        const overrides: DomainCleansingOverride[] = [
            { domain: 'example.com', overrides: {} },
        ];
        expect(getCleansingConfigForDomain('example.com', base, overrides)).toBe(base);
    });

    describe('normalizeDomain', () => {
        it('lowercases and trims', () => {
            expect(normalizeDomain('  Example.COM ')).toBe('example.com');
        });
    });

    describe('upsertDomainOverride', () => {
        it('inserts new domain', () => {
            const next = upsertDomainOverride([], 'example.com', { aiSummaryCleansingDeep: true });
            expect(next).toHaveLength(1);
            expect(next[0].domain).toBe('example.com');
        });

        it('updates existing domain', () => {
            const start: DomainCleansingOverride[] = [{ domain: 'example.com', overrides: { aiSummaryCleansingDeep: true } }];
            const next = upsertDomainOverride(start, 'example.com', { aiSummaryCleansingAds: false });
            expect(next).toHaveLength(1);
            expect(next[0].overrides).toMatchObject({ aiSummaryCleansingDeep: true, aiSummaryCleansingAds: false });
        });

        it('deletes when patch is null', () => {
            const start: DomainCleansingOverride[] = [{ domain: 'example.com', overrides: { aiSummaryCleansingDeep: true } }];
            const next = upsertDomainOverride(start, 'example.com', null);
            expect(next).toHaveLength(0);
        });

        it('deletes when patch is empty', () => {
            const start: DomainCleansingOverride[] = [{ domain: 'example.com', overrides: { aiSummaryCleansingDeep: true } }];
            const next = upsertDomainOverride(start, 'example.com', {});
            expect(next).toHaveLength(0);
        });

        it('normalizes domain on insert', () => {
            const next = upsertDomainOverride([], '  EXAMPLE.com ', { aiSummaryCleansingDeep: true });
            expect(next[0].domain).toBe('example.com');
        });
    });
});
