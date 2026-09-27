import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createOfflineQueueProcessor } from '../offlineQueueProcessor.js';
import type { OfflineJob } from '../offlineNetworkQueue.js';

const CLAIMS_KEY = 'recording_recovery_claims';

/** Seeds a fresh claim through the setup-provided chrome.storage mock. */
async function seedClaim(url: string, owner: string): Promise<void> {
    const claims = { [url]: { url, owner, claimedAt: Date.now() } };
    await global.chrome.storage.local.set({ [CLAIMS_KEY]: claims });
}

/** Two-arg retryAll mock that feeds one job to the handler, like the real queue. */
function retryAllFeeding(
    job: Partial<OfflineJob>,
    handlerResult: boolean,
    dropsAfterHandler: boolean,
): { retryAll: ReturnType<typeof vi.fn>; onDropped: ReturnType<typeof vi.fn> } {
    const onDropped = vi.fn().mockResolvedValue(undefined);
    const retryAll = vi.fn(async (
        handler: (job: OfflineJob) => Promise<boolean>,
        reportDropped?: (job: OfflineJob, reason: string) => Promise<void> | void,
    ) => {
        const result = await handler(job as OfflineJob);
        if (dropsAfterHandler && !result && reportDropped) {
            await reportDropped(job as OfflineJob, 'max-retries');
        }
    });
    return { retryAll, onDropped };
}

describe('createOfflineQueueProcessor', () => {
    beforeEach(async () => {
        // chrome.storage.local is the vitest.setup mock; clear the claims key
        // so one test's recovery claims never leak into the next.
        await global.chrome.storage.local.remove(CLAIMS_KEY);
        vi.clearAllMocks();
    });

    it('retries obsidian_sync jobs via retryObsidianWrite when summary is present', async () => {
        const retryObsidianWrite = vi.fn().mockResolvedValue(true);
        const record = vi.fn().mockResolvedValue({ success: true, skipped: false });
        const retryAll = vi.fn(async (handler: (job: unknown) => Promise<boolean>) => {
            await handler({
                type: 'obsidian_sync',
                payload: { title: 't', url: 'https://example.com', content: 'c', summary: 's' },
            });
        });

        const processQueue = createOfflineQueueProcessor({
            offlineNetworkQueue: { retryAll },
            recordingPipeline: { record, retryObsidianWrite },
        });

        await processQueue();

        expect(retryObsidianWrite).toHaveBeenCalledWith({ title: 't', url: 'https://example.com', summary: 's', tags: undefined });
        expect(record).not.toHaveBeenCalled();
    });

    it('falls back to full record() pipeline for ai_summary jobs', async () => {
        const record = vi.fn().mockResolvedValue({ success: true, skipped: false });
        const retryObsidianWrite = vi.fn();
        const retryAll = vi.fn(async (handler: (job: unknown) => Promise<boolean>) => {
            await handler({
                type: 'ai_summary',
                payload: { title: 't', url: 'https://example.com', content: 'c' },
            });
        });

        const processQueue = createOfflineQueueProcessor({
            offlineNetworkQueue: { retryAll },
            recordingPipeline: { record, retryObsidianWrite },
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
        expect(retryObsidianWrite).not.toHaveBeenCalled();
    });

    it('falls back to full record() for obsidian_sync jobs queued without a summary', async () => {
        const record = vi.fn().mockResolvedValue({ success: true, skipped: false });
        const retryObsidianWrite = vi.fn();
        const retryAll = vi.fn(async (handler: (job: unknown) => Promise<boolean>) => {
            await handler({
                type: 'obsidian_sync',
                payload: { title: 't', url: 'https://example.com', content: 'c' },
            });
        });

        const processQueue = createOfflineQueueProcessor({
            offlineNetworkQueue: { retryAll },
            recordingPipeline: { record, retryObsidianWrite },
        });

        await processQueue();

        expect(retryObsidianWrite).not.toHaveBeenCalled();
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
        const retryObsidianWrite = vi.fn().mockResolvedValue(true);
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
            recordingPipeline: { record, retryObsidianWrite },
        });

        await processQueue();

        expect(retryObsidianWrite).toHaveBeenCalledWith({
            title: 't',
            url: 'https://example.com',
            summary: 's',
            tags: ['a'],
        });
        expect(retryObsidianWrite.mock.calls[0]?.[0]).not.toHaveProperty('maskedCount');
    });

    it('does not re-run the full pipeline or its SQLite and metadata steps for obsidian_sync', async () => {
        const retryObsidianWrite = vi.fn().mockResolvedValue(true);
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
            recordingPipeline: { record, retryObsidianWrite },
        });

        await processQueue();

        expect(retryObsidianWrite).toHaveBeenCalledTimes(1);
        expect(record).not.toHaveBeenCalled();
        // SQLite persistence and saved metadata are owned by record(); keeping
        // it untouched is the observable contract that those steps do not run.
    });

    it('returns false when retryObsidianWrite throws', async () => {
        const retryObsidianWrite = vi.fn().mockRejectedValue(new Error('obsidian error'));
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
            recordingPipeline: { record, retryObsidianWrite },
        });

        await processQueue();

        expect(retryObsidianWrite).toHaveBeenCalled();
        expect(record).not.toHaveBeenCalled();
    });

    it('returns false when record() throws', async () => {
        const record = vi.fn().mockRejectedValue(new Error('record error'));
        const retryObsidianWrite = vi.fn();
        const retryAll = vi.fn(async (handler: (job: unknown) => Promise<boolean>) => {
            const result = await handler({
                type: 'ai_summary',
                payload: { title: 't', url: 'https://example.com', content: 'c' },
            });
            expect(result).toBe(false);
        });

        const processQueue = createOfflineQueueProcessor({
            offlineNetworkQueue: { retryAll },
            recordingPipeline: { record, retryObsidianWrite },
        });

        await processQueue();

        expect(record).toHaveBeenCalled();
        expect(retryObsidianWrite).not.toHaveBeenCalled();
    });

    describe('trust boundary (VULN-011/06a) - gate re-evaluation on replay', () => {
        it('replays with force:false and skipDuplicateCheck:true (gates re-evaluated, duplicate still skipped)', async () => {
            const record = vi.fn().mockResolvedValue({ success: true, skipped: false });
            const retryObsidianWrite = vi.fn();
            const retryAll = vi.fn(async (handler: (job: unknown) => Promise<boolean>) => {
                await handler({
                    type: 'ai_summary',
                    payload: { title: 't', url: 'https://example.com', content: 'c' },
                });
            });
            const processQueue = createOfflineQueueProcessor({
                offlineNetworkQueue: { retryAll },
                recordingPipeline: { record, retryObsidianWrite },
            });
            await processQueue();
            expect(record).toHaveBeenCalledWith(expect.objectContaining({
                force: false,
                skipDuplicateCheck: true,
                recordType: 'manual',
            }));
            // skipDuplicateCheck:true is retained so normal retries are not trapped by duplicate
            expect(record.mock.calls[0]?.[0]).toHaveProperty('skipDuplicateCheck', true);
            expect(record.mock.calls[0]?.[0]).toHaveProperty('force', false);
        });

        it('blocked URL (DOMAIN_BLOCKED) is not marked successful — domain gate re-evaluated', async () => {
            const record = vi.fn().mockResolvedValue({ success: false, error: 'DOMAIN_BLOCKED' });
            const retryObsidianWrite = vi.fn();
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
                recordingPipeline: { record, retryObsidianWrite },
            });
            await processQueue();
            expect(record).toHaveBeenCalledTimes(1);
        });

        it('private page blocked (PRIVATE_PAGE_DETECTED) is not marked successful — privacy gate re-evaluated', async () => {
            const record = vi.fn().mockResolvedValue({ success: false, error: 'PRIVATE_PAGE_DETECTED' });
            const retryObsidianWrite = vi.fn();
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
                recordingPipeline: { record, retryObsidianWrite },
            });
            await processQueue();
            expect(record).toHaveBeenCalledTimes(1);
        });

        it('duplicate skipped result returns false so queue can account for it (not falsely marked success)', async () => {
            const record = vi.fn().mockResolvedValue({ success: true, skipped: true });
            const retryObsidianWrite = vi.fn();
            const retryAll = vi.fn(async (handler: (job: unknown) => Promise<boolean>) => {
                const result = await handler({
                    type: 'ai_summary',
                    payload: { title: 'dup', url: 'https://example.com/dup', content: 'c' },
                });
                expect(result).toBe(false);
            });
            const processQueue = createOfflineQueueProcessor({
                offlineNetworkQueue: { retryAll },
                recordingPipeline: { record, retryObsidianWrite },
            });
            await processQueue();
            expect(record).toHaveBeenCalled();
        });

        it('successful non-blocked replay returns true', async () => {
            const record = vi.fn().mockResolvedValue({ success: true, skipped: false });
            const retryObsidianWrite = vi.fn();
            const retryAll = vi.fn(async (handler: (job: unknown) => Promise<boolean>) => {
                const result = await handler({
                    type: 'ai_summary',
                    payload: { title: 'ok', url: 'https://allowed.example/page', content: 'c' },
                });
                expect(result).toBe(true);
            });
            const processQueue = createOfflineQueueProcessor({
                offlineNetworkQueue: { retryAll },
                recordingPipeline: { record, retryObsidianWrite },
            });
            await processQueue();
            expect(record).toHaveBeenCalledWith(expect.objectContaining({ force: false }));
        });
    });

    describe('recovery owner arbitration (PBI 2026-09-25-12)', () => {
        it('hands a terminal-failure job over to the terminal-failure handler', async () => {
            const handOver = vi.fn().mockResolvedValue(undefined);
            const record = vi.fn().mockResolvedValue({ success: false });
            const { retryAll } = retryAllFeeding(
                { type: 'ai_summary', payload: { title: 't', url: 'https://example.com/terminal', content: 'c' } },
                false,
                true,
            );
            const processQueue = createOfflineQueueProcessor({
                offlineNetworkQueue: { retryAll },
                recordingPipeline: { record, retryObsidianWrite: vi.fn() },
                terminalFailureHandler: { handOver },
            });

            await processQueue();

            expect(handOver).toHaveBeenCalledTimes(1);
            expect(handOver).toHaveBeenCalledWith(expect.objectContaining({ type: 'ai_summary' }));
        });

        it('skips processing when the durable claim is held by another owner', async () => {
            const record = vi.fn().mockResolvedValue({ success: true, skipped: false });
            const retryObsidianWrite = vi.fn();
            const { retryAll, onDropped } = retryAllFeeding(
                { type: 'ai_summary', payload: { title: 't', url: 'https://example.com/claimed', content: 'c' } },
                true,
                false,
            );
            const processQueue = createOfflineQueueProcessor({
                offlineNetworkQueue: { retryAll },
                recordingPipeline: { record, retryObsidianWrite },
            });

            await seedClaim('https://example.com/claimed', 'manual');
            await processQueue();

            expect(record).not.toHaveBeenCalled();
            expect(retryObsidianWrite).not.toHaveBeenCalled();
            expect(onDropped).not.toHaveBeenCalled();
        });

        it('releases the durable claim after the job finishes', async () => {
            const record = vi.fn().mockResolvedValue({ success: true, skipped: false });
            const retryObsidianWrite = vi.fn();
            const { retryAll } = retryAllFeeding(
                { type: 'ai_summary', payload: { title: 't', url: 'https://example.com/release', content: 'c' } },
                true,
                false,
            );
            const processQueue = createOfflineQueueProcessor({
                offlineNetworkQueue: { retryAll },
                recordingPipeline: { record, retryObsidianWrite },
            });

            await processQueue();

            expect(record).toHaveBeenCalledTimes(1);
            const stored = await global.chrome.storage.local.get(CLAIMS_KEY);
            expect(stored[CLAIMS_KEY]?.['https://example.com/release']).toBeUndefined();
        });

        it('releases the durable claim even when the pipeline throws', async () => {
            const record = vi.fn().mockRejectedValue(new Error('boom'));
            const retryObsidianWrite = vi.fn();
            const { retryAll } = retryAllFeeding(
                { type: 'ai_summary', payload: { title: 't', url: 'https://example.com/throwing', content: 'c' } },
                false,
                true,
            );
            const processQueue = createOfflineQueueProcessor({
                offlineNetworkQueue: { retryAll },
                recordingPipeline: { record, retryObsidianWrite },
            });

            await processQueue();

            const stored = await global.chrome.storage.local.get(CLAIMS_KEY);
            expect(stored[CLAIMS_KEY]?.['https://example.com/throwing']).toBeUndefined();
        });
    });
});
