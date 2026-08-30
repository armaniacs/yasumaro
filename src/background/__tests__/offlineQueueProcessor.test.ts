import { describe, it, expect, vi } from 'vitest';
import { createOfflineQueueProcessor } from '../offlineQueueProcessor.js';

describe('createOfflineQueueProcessor', () => {
    it('retries obsidian_sync jobs via retryObsidianWriteOnly when summary is present', async () => {
        const retryObsidianWriteOnly = vi.fn().mockResolvedValue(true);
        const record = vi.fn().mockResolvedValue({ success: true, skipped: false });
        const retryAll = vi.fn(async (handler: (job: unknown) => Promise<boolean>) => {
            await handler({
                type: 'obsidian_sync',
                payload: { title: 't', url: 'https://example.com', content: 'c', summary: 's' },
            });
        });

        const processQueue = createOfflineQueueProcessor({
            offlineNetworkQueue: { retryAll },
            recordingPipeline: { record, retryObsidianWriteOnly },
        });

        await processQueue();

        expect(retryObsidianWriteOnly).toHaveBeenCalledWith({ title: 't', url: 'https://example.com', summary: 's', tags: undefined });
        expect(record).not.toHaveBeenCalled();
    });

    it('falls back to full record() pipeline for ai_summary jobs', async () => {
        const record = vi.fn().mockResolvedValue({ success: true, skipped: false });
        const retryObsidianWriteOnly = vi.fn();
        const retryAll = vi.fn(async (handler: (job: unknown) => Promise<boolean>) => {
            await handler({
                type: 'ai_summary',
                payload: { title: 't', url: 'https://example.com', content: 'c' },
            });
        });

        const processQueue = createOfflineQueueProcessor({
            offlineNetworkQueue: { retryAll },
            recordingPipeline: { record, retryObsidianWriteOnly },
        });

        await processQueue();

        expect(record).toHaveBeenCalledWith({
            title: 't',
            url: 'https://example.com',
            content: 'c',
            force: false,
            skipDuplicateCheck: true,
            recordType: 'manual',
        });
        expect(retryObsidianWriteOnly).not.toHaveBeenCalled();
    });

    it('falls back to full record() for obsidian_sync jobs queued without a summary', async () => {
        const record = vi.fn().mockResolvedValue({ success: true, skipped: false });
        const retryObsidianWriteOnly = vi.fn();
        const retryAll = vi.fn(async (handler: (job: unknown) => Promise<boolean>) => {
            await handler({
                type: 'obsidian_sync',
                payload: { title: 't', url: 'https://example.com', content: 'c' },
            });
        });

        const processQueue = createOfflineQueueProcessor({
            offlineNetworkQueue: { retryAll },
            recordingPipeline: { record, retryObsidianWriteOnly },
        });

        await processQueue();

        expect(retryObsidianWriteOnly).not.toHaveBeenCalled();
        expect(record).toHaveBeenCalledWith(expect.objectContaining({
            url: 'https://example.com',
            content: 'c',
            force: false,
        }));
    });

    it('drops maskedCount on the obsidian_sync retry path', async () => {
        // The Obsidian-only retry regenerates Markdown from summary/tags alone;
        // maskedCount rides along in the queued payload but is not replayed, and
        // the SQLite/metadata steps are not re-run for this path.
        const retryObsidianWriteOnly = vi.fn().mockResolvedValue(true);
        const record = vi.fn();
        const retryAll = vi.fn(async (handler: (job: unknown) => Promise<boolean>) => {
            await handler({
                type: 'obsidian_sync',
                payload: {
                    title: 't',
                    url: 'https://example.com',
                    content: 'c',
                    summary: 's',
                    maskedCount: 7,
                    tags: ['a'],
                },
            });
        });

        const processQueue = createOfflineQueueProcessor({
            offlineNetworkQueue: { retryAll },
            recordingPipeline: { record, retryObsidianWriteOnly },
        });

        await processQueue();

        expect(retryObsidianWriteOnly).toHaveBeenCalledWith({
            title: 't',
            url: 'https://example.com',
            summary: 's',
            tags: ['a'],
        });
        expect(retryObsidianWriteOnly.mock.calls[0][0]).not.toHaveProperty('maskedCount');
    });

    it('does not re-run the full pipeline or its SQLite and metadata steps for obsidian_sync', async () => {
        const retryObsidianWriteOnly = vi.fn().mockResolvedValue(true);
        const record = vi.fn();
        const retryAll = vi.fn(async (handler: (job: unknown) => Promise<boolean>) => {
            await handler({
                type: 'obsidian_sync',
                payload: {
                    title: 't',
                    url: 'https://example.com',
                    content: 'c',
                    summary: 's',
                    maskedCount: 7,
                    tags: ['a'],
                },
            });
        });

        const processQueue = createOfflineQueueProcessor({
            offlineNetworkQueue: { retryAll },
            recordingPipeline: { record, retryObsidianWriteOnly },
        });

        await processQueue();

        expect(retryObsidianWriteOnly).toHaveBeenCalledTimes(1);
        expect(record).not.toHaveBeenCalled();
        // SQLite persistence and saved metadata are owned by record(); keeping
        // it untouched is the observable contract that those steps do not run.
    });

    it('returns false when retryObsidianWriteOnly throws', async () => {
        const retryObsidianWriteOnly = vi.fn().mockRejectedValue(new Error('obsidian error'));
        const record = vi.fn();
        const retryAll = vi.fn(async (handler: (job: unknown) => Promise<boolean>) => {
            const result = await handler({
                type: 'obsidian_sync',
                payload: { title: 't', url: 'https://example.com', content: 'c', summary: 's' },
            });
            expect(result).toBe(false);
        });

        const processQueue = createOfflineQueueProcessor({
            offlineNetworkQueue: { retryAll },
            recordingPipeline: { record, retryObsidianWriteOnly },
        });

        await processQueue();

        expect(retryObsidianWriteOnly).toHaveBeenCalled();
        expect(record).not.toHaveBeenCalled();
    });

    it('returns false when record() throws', async () => {
        const record = vi.fn().mockRejectedValue(new Error('record error'));
        const retryObsidianWriteOnly = vi.fn();
        const retryAll = vi.fn(async (handler: (job: unknown) => Promise<boolean>) => {
            const result = await handler({
                type: 'ai_summary',
                payload: { title: 't', url: 'https://example.com', content: 'c' },
            });
            expect(result).toBe(false);
        });

        const processQueue = createOfflineQueueProcessor({
            offlineNetworkQueue: { retryAll },
            recordingPipeline: { record, retryObsidianWriteOnly },
        });

        await processQueue();

        expect(record).toHaveBeenCalled();
        expect(retryObsidianWriteOnly).not.toHaveBeenCalled();
    });

    describe('trust boundary (VULN-011/06a) - gate re-evaluation on replay', () => {
        it('replays with force:false and skipDuplicateCheck:true (gates re-evaluated, duplicate still skipped)', async () => {
            const record = vi.fn().mockResolvedValue({ success: true, skipped: false });
            const retryObsidianWriteOnly = vi.fn();
            const retryAll = vi.fn(async (handler: (job: unknown) => Promise<boolean>) => {
                await handler({
                    type: 'ai_summary',
                    payload: { title: 't', url: 'https://example.com', content: 'c' },
                });
            });
            const processQueue = createOfflineQueueProcessor({
                offlineNetworkQueue: { retryAll },
                recordingPipeline: { record, retryObsidianWriteOnly },
            });
            await processQueue();
            expect(record).toHaveBeenCalledWith(expect.objectContaining({
                force: false,
                skipDuplicateCheck: true,
                recordType: 'manual',
            }));
            // skipDuplicateCheck:true is retained so normal retries are not trapped by duplicate
            expect(record.mock.calls[0][0]).toHaveProperty('skipDuplicateCheck', true);
            expect(record.mock.calls[0][0]).toHaveProperty('force', false);
        });

        it('blocked URL (DOMAIN_BLOCKED) is not marked successful — domain gate re-evaluated', async () => {
            const record = vi.fn().mockResolvedValue({ success: false, error: 'DOMAIN_BLOCKED' });
            const retryObsidianWriteOnly = vi.fn();
            const retryAll = vi.fn(async (handler: (job: unknown) => Promise<boolean>) => {
                const result = await handler({
                    type: 'ai_summary',
                    payload: { title: 'blocked', url: 'https://blocked.example/page', content: 'c' },
                });
                // Pipeline returns success:false for DOMAIN_BLOCKED when force:false; offline handler must return false
                expect(result).toBe(false);
                expect(record).toHaveBeenCalledWith(expect.objectContaining({
                    url: 'https://blocked.example/page',
                    force: false,
                }));
            });
            const processQueue = createOfflineQueueProcessor({
                offlineNetworkQueue: { retryAll },
                recordingPipeline: { record, retryObsidianWriteOnly },
            });
            await processQueue();
            expect(record).toHaveBeenCalledTimes(1);
        });

        it('private page blocked (PRIVATE_PAGE_DETECTED) is not marked successful — privacy gate re-evaluated', async () => {
            const record = vi.fn().mockResolvedValue({ success: false, error: 'PRIVATE_PAGE_DETECTED' });
            const retryObsidianWriteOnly = vi.fn();
            const retryAll = vi.fn(async (handler: (job: unknown) => Promise<boolean>) => {
                const result = await handler({
                    type: 'ai_summary',
                    payload: { title: 'private', url: 'https://private.example/secret', content: 'c' },
                });
                expect(result).toBe(false);
                expect(record).toHaveBeenCalledWith(expect.objectContaining({
                    url: 'https://private.example/secret',
                    force: false,
                }));
            });
            const processQueue = createOfflineQueueProcessor({
                offlineNetworkQueue: { retryAll },
                recordingPipeline: { record, retryObsidianWriteOnly },
            });
            await processQueue();
            expect(record).toHaveBeenCalledTimes(1);
        });

        it('duplicate skipped result returns false so queue can account for it (not falsely marked success)', async () => {
            const record = vi.fn().mockResolvedValue({ success: true, skipped: true });
            const retryObsidianWriteOnly = vi.fn();
            const retryAll = vi.fn(async (handler: (job: unknown) => Promise<boolean>) => {
                const result = await handler({
                    type: 'ai_summary',
                    payload: { title: 'dup', url: 'https://example.com/dup', content: 'c' },
                });
                expect(result).toBe(false);
            });
            const processQueue = createOfflineQueueProcessor({
                offlineNetworkQueue: { retryAll },
                recordingPipeline: { record, retryObsidianWriteOnly },
            });
            await processQueue();
            expect(record).toHaveBeenCalled();
        });

        it('successful non-blocked replay returns true', async () => {
            const record = vi.fn().mockResolvedValue({ success: true, skipped: false });
            const retryObsidianWriteOnly = vi.fn();
            const retryAll = vi.fn(async (handler: (job: unknown) => Promise<boolean>) => {
                const result = await handler({
                    type: 'ai_summary',
                    payload: { title: 'ok', url: 'https://allowed.example/page', content: 'c' },
                });
                expect(result).toBe(true);
            });
            const processQueue = createOfflineQueueProcessor({
                offlineNetworkQueue: { retryAll },
                recordingPipeline: { record, retryObsidianWriteOnly },
            });
            await processQueue();
            expect(record).toHaveBeenCalledWith(expect.objectContaining({ force: false }));
        });
    });
});
