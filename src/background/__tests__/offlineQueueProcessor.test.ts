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
            recordingLogic: { record, retryObsidianWriteOnly },
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
            recordingLogic: { record, retryObsidianWriteOnly },
        });

        await processQueue();

        expect(record).toHaveBeenCalledWith({
            title: 't',
            url: 'https://example.com',
            content: 'c',
            force: true,
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
            recordingLogic: { record, retryObsidianWriteOnly },
        });

        await processQueue();

        expect(retryObsidianWriteOnly).not.toHaveBeenCalled();
        expect(record).toHaveBeenCalledWith(expect.objectContaining({
            url: 'https://example.com',
            content: 'c',
            force: true,
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
            recordingLogic: { record, retryObsidianWriteOnly },
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
            recordingLogic: { record, retryObsidianWriteOnly },
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
            recordingLogic: { record, retryObsidianWriteOnly },
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
            recordingLogic: { record, retryObsidianWriteOnly },
        });

        await processQueue();

        expect(record).toHaveBeenCalled();
        expect(retryObsidianWriteOnly).not.toHaveBeenCalled();
    });
});
