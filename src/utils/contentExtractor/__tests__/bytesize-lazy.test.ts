// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { extractMainContent } from '../index.js';
import { cleanseAISummaryContent } from '../../aiSummaryCleaner/index.js';

const FIXTURE = `
    <header><nav>Site navigation links here</nav></header>
    <article>
        <h1>Lazy Byte Measurement</h1>
        <p>${'Article body content for lazy byte measurement verification. '.repeat(10)}</p>
        <p>${'Second paragraph with enough text to avoid fallback. '.repeat(10)}</p>
    </article>
    <footer>Footer content outside the candidate</footer>
`;

function setupFixture(): void {
    document.body.innerHTML = FIXTURE;
}

beforeEach(() => {
    setupFixture();
    vi.restoreAllMocks();
});

afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});

describe('bytesize-lazy: returnInfo=false skips diagnostic measurement', () => {
    it('never encodes the body textContent string (pageBytes skipped)', () => {
        const encodeSpy = vi.spyOn(TextEncoder.prototype, 'encode');
        const bodyText = document.body.textContent || '';
        expect(bodyText.length).toBeGreaterThan(0);

        const result = extractMainContent(10000, { returnInfo: false });

        expect(typeof result).toBe('string');
        const encodedArgs = encodeSpy.mock.calls.map((call) => call[0] as unknown);
        expect(encodedArgs).not.toContain(bodyText);
    });

    it('performs no diagnostic encodes on the default path (only fallback-critical _contentBytes)', () => {
        const encodeSpy = vi.spyOn(TextEncoder.prototype, 'encode');

        extractMainContent(10000, { returnInfo: false });

        // Fallback-critical _contentBytes (extracted string) is the only encode allowed.
        expect(encodeSpy).toHaveBeenCalledTimes(1);
    });

    it('does not read document.body.textContent for pageBytes when returnInfo=false', () => {
        const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
        expect(descriptor?.get).toBeDefined();
        const originalGet = descriptor!.get!;
        const seenThis: unknown[] = [];
        const getSpy = vi.spyOn(Node.prototype as unknown as Record<string, unknown>, 'textContent', 'get');
        getSpy.mockImplementation(function (this: unknown) {
            seenThis.push(this);
            return originalGet.call(this);
        });

        extractMainContent(10000, { returnInfo: false });

        expect(seenThis).not.toContain(document.body);
        getSpy.mockRestore();
    });

    it('returnInfo=false with aiSummary enabled encodes only fallback-critical strings', () => {
        const encodeSpy = vi.spyOn(TextEncoder.prototype, 'encode');
        const bodyText = document.body.textContent || '';

        const result = extractMainContent(
            10000,
            { returnInfo: false },
            { aiSummaryCleanseEnabled: true, altEnabled: true }
        );

        expect(typeof result).toBe('string');
        const encodedArgs = encodeSpy.mock.calls.map((call) => call[0] as unknown);
        // pageBytes (full body read) must not be encoded.
        expect(encodedArgs).not.toContain(bodyText);
        // Fallback-critical: pre-AI bytes + _contentBytes.
        expect(encodeSpy).toHaveBeenCalledTimes(2);
    });
});

describe('bytesize-lazy: returnInfo=true matches the legacy computation', () => {
    it('pageBytes/candidateBytes/originalBytes/cleansedBytes equal the Blob-based oracle', () => {
        setupFixture();
        const bodyText = document.body.textContent || '';
        const candidateText = document.querySelector('article')!.textContent || '';
        const expectedPage = new Blob([bodyText]).size;
        const expectedCandidate = new Blob([candidateText]).size;

        const result = extractMainContent(10000, { returnInfo: true }) as Record<string, unknown>;

        expect(result.pageBytes).toBe(expectedPage);
        expect(result.candidateBytes).toBe(expectedCandidate);
        // No cleansing: original and cleansed reuse the candidate measurement.
        expect(result.originalBytes).toBe(expectedCandidate);
        expect(result.cleansedBytes).toBe(expectedCandidate);
    });

    it('cleansedBytes reflects cleansing and funnel is fully populated', () => {
        document.body.innerHTML = `<article><p>${'Byte funnel content. '.repeat(20)}</p><script>alert('remove me')</script></article>`;
        const bodyText = document.body.textContent || '';

        const result = extractMainContent(
            10000,
            { cleanseEnabled: true, hardStripEnabled: true, returnInfo: true }
        ) as Record<string, unknown>;

        expect(result.pageBytes).toBe(new Blob([bodyText]).size);
        expect(result.cleansedBytes).toBeLessThanOrEqual(result.originalBytes as number);
        const funnel = result.funnel as { pageBytes: number; candidateBytes: number; cleansedBytes: number };
        expect(funnel).toBeDefined();
        expect(funnel.pageBytes).toBe(result.pageBytes);
        expect(funnel.candidateBytes).toBe(result.candidateBytes);
        expect(funnel.cleansedBytes).toBe(result.cleansedBytes);
    });

    it('aiSummaryOriginalBytes is carried from cleansedBytes (no extra encode)', () => {
        setupFixture();
        const result = extractMainContent(
            10000,
            { cleanseEnabled: false, returnInfo: true },
            { aiSummaryCleanseEnabled: true, altEnabled: true }
        ) as Record<string, unknown>;

        expect(result.aiSummaryOriginalBytes).toBe(result.cleansedBytes);
    });
});

describe('bytesize-lazy: no duplicate encode of the same string in one pass', () => {
    it('encodes each distinct string at most once (no cleansing)', () => {
        const encodeSpy = vi.spyOn(TextEncoder.prototype, 'encode');

        extractMainContent(10000, { returnInfo: true });

        const args = encodeSpy.mock.calls.map((call) => String(call[0]));
        expect(new Set(args).size).toBe(args.length);
    });

    it('encodes each distinct string at most once (cleanse + aiSummary enabled)', () => {
        // Fixture with actually-removed nodes so every stage string differs:
        // hardStrip removes <script>, ads rule removes the promo div text.
        document.body.innerHTML = `
            <header><nav>Site navigation links here</nav></header>
            <article>
                <h1>Lazy Byte Measurement</h1>
                <p>${'Article body content for lazy byte measurement verification. '.repeat(10)}</p>
                <p>${'Second paragraph with enough text to avoid fallback. '.repeat(10)}</p>
                <script>alert('remove me')</script>
                <div class="advertisement">Promotional text removed by the ads rule.</div>
            </article>
            <footer>Footer content outside the candidate</footer>
        `;
        const encodeSpy = vi.spyOn(TextEncoder.prototype, 'encode');

        const result = extractMainContent(
            10000,
            { cleanseEnabled: true, hardStripEnabled: true, returnInfo: true },
            { aiSummaryCleanseEnabled: true, altEnabled: true, adsEnabled: true }
        ) as Record<string, unknown>;

        expect(result.fallbackTriggered).toBe(false);
        const args = encodeSpy.mock.calls.map((call) => String(call[0]));
        expect(new Set(args).size).toBe(args.length);
    });
});

describe('bytesize-lazy: aiSummaryCleaner measureBytes flag', () => {
    function makeElement(): Element {
        const root = document.createElement('div');
        root.innerHTML = `<p>${'Cleaner byte flag content. '.repeat(10)}</p><div class="ad-container">Ad</div>`;
        return root;
    }

    it('does not construct Blob when measureBytes is false', () => {
        const OriginalBlob = globalThis.Blob;
        const blobSpy = vi.spyOn(globalThis, 'Blob');
        blobSpy.mockImplementation(function (...args: ConstructorParameters<typeof Blob>) {
            return new OriginalBlob(...args);
        });

        const result = cleanseAISummaryContent(makeElement(), {
            adsEnabled: true,
            bodyProtectionEnabled: false,
            measureBytes: false,
        });

        expect(blobSpy).not.toHaveBeenCalled();
        expect(result.bytesBefore).toBe(0);
        expect(result.bytesAfter).toBe(0);
    });

    it('measures by default (backward compatibility for direct callers)', () => {
        const result = cleanseAISummaryContent(makeElement(), {
            adsEnabled: true,
            bodyProtectionEnabled: false,
        });

        expect(result.bytesBefore).toBeGreaterThan(0);
        expect(result.bytesAfter).toBeGreaterThan(0);
    });

    it('constructs Blob twice and reports real sizes when measureBytes is true', () => {
        const OriginalBlob = globalThis.Blob;
        const blobSpy = vi.spyOn(globalThis, 'Blob');
        blobSpy.mockImplementation(function (...args: ConstructorParameters<typeof Blob>) {
            return new OriginalBlob(...args);
        });

        const result = cleanseAISummaryContent(makeElement(), {
            adsEnabled: true,
            bodyProtectionEnabled: false,
            measureBytes: true,
        });

        expect(blobSpy).toHaveBeenCalledTimes(2);
        expect(result.bytesBefore).toBeGreaterThan(0);
        expect(result.bytesAfter).toBeGreaterThan(0);
    });
});
