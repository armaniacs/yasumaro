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
