import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createReviewSummaryGenerator } from '../reviewSummaryGenerator.js';

describe('VULN-002: TOCTOU race in review summary generation', () => {
    let storageState: Record<string, unknown>;

    const mockRepo = {
        getAll: vi.fn(),
    };

    const mockAiService = {
        generateSummary: vi.fn(),
    };

    const mockSqliteClient = {
        query: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        storageState = {
            review_summary_enabled: true,
            review_summary_last_generated_week: '',
            review_summary_last_generated_month: '',
            local_markdown_export_path: '/tmp/export',
        };

        mockRepo.getAll.mockImplementation(() => Promise.resolve({ ...storageState }));

        globalThis.chrome = {
            storage: {
                local: {
                    set: vi.fn().mockImplementation((items: Record<string, unknown>) => {
                        Object.assign(storageState, items);
                        return Promise.resolve();
                    }),
                },
            },
            downloads: {
                download: vi.fn().mockResolvedValue(123),
            },
        } as unknown as typeof chrome;
    });

    it('serializes concurrent weekly summary requests so only one proceeds', async () => {
        mockSqliteClient.query.mockResolvedValue({
            success: true,
            data: { rows: [{ summary: 'test entry', url: 'https://example.com', domain: 'example.com', title: 'Test' }] },
        });

        // Slow AI generation to widen the TOCTOU window
        let aiCallCount = 0;
        mockAiService.generateSummary.mockImplementation(async () => {
            aiCallCount++;
            await new Promise((r) => setTimeout(r, 50));
            return { success: true, summary: `digest ${aiCallCount}` };
        });

        const generator = createReviewSummaryGenerator({
            aiService: mockAiService,
            sqliteClient: mockSqliteClient,
            repo: mockRepo,
        });

        // Fire two concurrent weekly summary requests for the same week
        const targetDate = new Date('2026-07-08');
        const [result1, result2] = await Promise.all([
            generator.generateWeeklySummary(targetDate),
            generator.generateWeeklySummary(targetDate),
        ]);

        // After fix: one succeeds, the other is deduplicated (returns false)
        // Before fix (vulnerable): both return true (both call AI and download)
        const trueCount = [result1, result2].filter(Boolean).length;
        expect(trueCount).toBe(1);
        expect(mockAiService.generateSummary).toHaveBeenCalledTimes(1);
    });

    it('serializes concurrent monthly summary requests so only one proceeds', async () => {
        mockSqliteClient.query.mockResolvedValue({
            success: true,
            data: { rows: [{ summary: 'test entry', url: 'https://example.com', domain: 'example.com', title: 'Test' }] },
        });

        let aiCallCount = 0;
        mockAiService.generateSummary.mockImplementation(async () => {
            aiCallCount++;
            await new Promise((r) => setTimeout(r, 50));
            return { success: true, summary: `digest ${aiCallCount}` };
        });

        const generator = createReviewSummaryGenerator({
            aiService: mockAiService,
            sqliteClient: mockSqliteClient,
            repo: mockRepo,
        });

        const targetDate = new Date('2026-07-15');
        const [result1, result2] = await Promise.all([
            generator.generateMonthlySummary(targetDate),
            generator.generateMonthlySummary(targetDate),
        ]);

        const trueCount = [result1, result2].filter(Boolean).length;
        expect(trueCount).toBe(1);
        expect(mockAiService.generateSummary).toHaveBeenCalledTimes(1);
    });
});
