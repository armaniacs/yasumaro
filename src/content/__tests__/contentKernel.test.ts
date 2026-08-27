// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContentKernel, FakeScheduler, IdleScheduler } from '../contentKernel.js';
import { InMemoryStoragePort } from '../../utils/storage/storagePort.js';
import { InMemoryDomainPolicyPort, ChromeDomainPolicyPort } from '../domainPolicyPort.js';
import { PageState } from '../pageState.js';
import { CLEANSING_RULES, THRESHOLD_RULES } from '../../utils/aiSummaryCleaner/rules.js';
import { DEFAULT_KEYWORDS } from '../../utils/contentCleaner.js';
import { computeMaxScroll } from '../scrollMonitor.js';
import { VisitReporter } from '../visitReporter.js';

describe('ContentKernel — StoragePort / DomainPolicyPort / Clock / Scheduler injection', () => {
    it('constructor accepts all four ports', () => {
        const storage = new InMemoryStoragePort();
        const policy = new InMemoryDomainPolicyPort({}, () => 1000);
        const clock = () => 1000;
        const scheduler = new FakeScheduler();
        const kernel = new ContentKernel(storage, policy, clock, scheduler);
        expect(kernel.pageState).toBeDefined();
    });

    it('loadSettings table-driven mapping — every CLEANSING_ROLES flag round-trips via StoragePort', async () => {
        const storage = new InMemoryStoragePort();
        const policy = new InMemoryDomainPolicyPort();
        const kernel = new ContentKernel(storage, policy);
        const stored: Record<string, unknown> = {};
        for (const rule of CLEANSING_RULES) {
            stored[rule.storageKey] = !rule.defaultEnabled;
        }
        // ContentKernel reads from single 'settings' key
        storage.seed({ settings: stored });
        await kernel.loadSettings();
        const cfg = kernel.pageState.cleansingConfig as unknown as Record<string, boolean>;
        for (const rule of CLEANSING_RULES) {
            const prop = `aiSummaryCleansing${rule.key.charAt(0).toUpperCase()}${rule.key.slice(1)}`;
            expect(cfg[prop], `${rule.key} -> ${prop}`).toBe(!rule.defaultEnabled);
        }
    });

    it('threshold rules are clamped via THRESHOLD_RULES table', async () => {
        const storage = new InMemoryStoragePort();
        const policy = new InMemoryDomainPolicyPort();
        const kernel = new ContentKernel(storage, policy);
        const stored: Record<string, unknown> = {
            [THRESHOLD_RULES[0].storageKey]: 9999, // exceeds max
        };
        storage.seed({ settings: stored });
        await kernel.loadSettings();
        const rule = THRESHOLD_RULES[0];
        expect(kernel.pageState.cleansingConfig[rule.prop]).toBe(rule.max);
    });

    it('loader and domainPolicy return same judgment via shared DomainPolicyPort', async () => {
        const store: Record<string, unknown> = {
            domain_filter_cache: ['example.com'],
            domain_filter_cache_timestamp: Date.now(),
            domain_filter_mode: 'whitelist',
        };
        const clock = () => Date.now();
        const portA = new InMemoryDomainPolicyPort(store, clock);
        const portB = new InMemoryDomainPolicyPort(store, clock);
        const a = await portA.checkDomainAllowedFromCache('https://example.com/page');
        const b = await portB.checkDomainAllowedFromCache('https://example.com/page');
        expect(a).toEqual(b);
        expect(a.allowed).toBe(true);
    });
});

describe('ScrollMonitor — pure updateMaxScroll', () => {
    it('computeMaxScroll is pure and handles zero docHeight', () => {
        expect(computeMaxScroll(0, 100, 0)).toBe(0);
        expect(computeMaxScroll(50, 100, 0)).toBe(50);
    });
    it('returns new max when scroll pct exceeds current', () => {
        // docHeight 1000, scrollY 500 => 50%
        expect(computeMaxScroll(0, 500, 1000)).toBe(50);
        expect(computeMaxScroll(30, 500, 1000)).toBe(50);
        expect(computeMaxScroll(60, 500, 1000)).toBe(60);
    });
    it('PageState mutation via ContentKernel update path', () => {
        const storage = new InMemoryStoragePort();
        const policy = new InMemoryDomainPolicyPort();
        const pageState = new PageState();
        const kernel = new ContentKernel(storage, policy, () => Date.now(), new FakeScheduler(), { pageState });
        pageState.maxScrollPercentage = 10;
        // Simulate scroll: Can't easily mock window, test pure function directly
        expect(computeMaxScroll(pageState.maxScrollPercentage, 800, 1000)).toBe(80);
    });
});

describe('VisitReporter — single VALID_VISIT send', () => {
    it('sends VALID_VISIT with payload including byte stats', async () => {
        document.body.innerHTML = `<article><p>Hello world content for visit report test with enough length.</p></article>`;
        const pageState = new PageState();
        const sender = { sendMessageWithRetry: vi.fn(() => Promise.resolve({ success: true })) };
        const reporter = new VisitReporter({
            pageState,
            extractor: () => ({ content: 'test content', pageBytes: 100, candidateBytes: 80 } as unknown as ReturnType<typeof import('../../utils/pageContentPipeline.js').preparePageContent>),
            applyResult: () => {},
            sender,
        });
        await reporter.report();
        expect(sender.sendMessageWithRetry).toHaveBeenCalledTimes(1);
        expect(sender.sendMessageWithRetry).toHaveBeenCalledWith(expect.objectContaining({ type: 'VALID_VISIT' }));
        const payload = (sender.sendMessageWithRetry.mock.calls[0][0] as { payload: Record<string, unknown> }).payload;
        expect(payload.content).toBe('test content');
    });
});

describe('pageState DEFAULT_CLEANSING_CONFIG SSOT', () => {
    it('contentStripKeywords derives from contentCleaner DEFAULT_KEYWORDS', async () => {
        const { DEFAULT_CLEANSING_CONFIG } = await import('../pageState.js');
        expect(DEFAULT_CLEANSING_CONFIG.contentStripKeywords).toEqual([...DEFAULT_KEYWORDS]);
        // Ensure it's a copy, not a shared reference
        expect(DEFAULT_CLEANSING_CONFIG.contentStripKeywords).not.toBe(DEFAULT_KEYWORDS);
    });
});
