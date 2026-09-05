// @vitest-environment jsdom
/**
 * contentKernel.cleansing.test.ts — PBI-12: CONTENT_CLEANSING_EXECUTED 通知の kernel 移行
 * utils/contentExtractor は chrome-free に戻り、通知は注入済み MessageSender seam
 * 経由で contentKernel.extractPageContent が fire-and-forget で送る。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContentKernel } from '../contentKernel.js';
import { InMemoryStoragePort } from '../../utils/storage/storagePort.js';
import { InMemoryDomainPolicyPort } from '../domainPolicyPort.js';
import type { MessageSender } from '../visitReporter.js';
import type { CleansingConfig } from '../pageState.js';

function makeKernel(sendImpl: (message: { type: string; payload?: unknown }) => Promise<{ success: boolean }>) {
    const storage = new InMemoryStoragePort();
    const policy = new InMemoryDomainPolicyPort();
    const sendMessageWithRetry = vi.fn(sendImpl);
    const sender: MessageSender = { sendMessageWithRetry };
    const kernel = new ContentKernel(storage, policy, () => Date.now(), undefined, { sender });
    return { kernel, sendMessageWithRetry };
}

/** AI要約・whitelist・dedup・keyword を切った決定的な Content Cleansing 設定 */
function hardStripOnly(kernel: ContentKernel): CleansingConfig {
    return {
        ...kernel.pageState.cleansingConfig,
        contentStripHardEnabled: true,
        contentStripKeywordEnabled: false,
        contentStripKeywords: [],
        aiSummaryCleansingEnabled: false,
        whitelistExtractionEnabled: false,
        contentDedupEnabled: false,
    };
}

const flushSends = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
    document.body.innerHTML = '';
});

describe('ContentKernel — CONTENT_CLEANSING_EXECUTED via injected sender', () => {
    it('クレンジング実行時に sender へ 1 回通知する', async () => {
        const { kernel, sendMessageWithRetry } = makeKernel(async () => ({ success: true }));
        document.body.innerHTML = `
            <article>
                <p>${'Content for kernel badge test. '.repeat(10)}</p>
                <script>alert('remove me')</script>
            </article>
        `;

        const result = kernel.extractPageContent(hardStripOnly(kernel));
        await flushSends();

        expect(result.cleansingExecuted).toBe(true);
        expect(sendMessageWithRetry).toHaveBeenCalledTimes(1);
        expect(sendMessageWithRetry).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'CONTENT_CLEANSING_EXECUTED' }),
        );
    });

    it('recount-only ページでは通知しない（recount が totalRemoved を埋めても）', async () => {
        const { kernel, sendMessageWithRetry } = makeKernel(async () => ({ success: true }));
        document.body.innerHTML = `
            <article>
                <p>${'Clean content with no strip targets inside the candidate. '.repeat(10)}</p>
            </article>
            <script>alert('outside the candidate')</script>
        `;

        const result = kernel.extractPageContent(hardStripOnly(kernel));
        await flushSends();

        // 診断 recount が body 全体を数えて totalRemoved を埋めるが、識別子は立たない
        expect(result.cleansingExecuted).toBeUndefined();
        expect(result.totalRemoved).toBeGreaterThan(0);
        expect(sendMessageWithRetry).not.toHaveBeenCalled();
    });

    it('クレンジング無効時は通知しない', async () => {
        const { kernel, sendMessageWithRetry } = makeKernel(async () => ({ success: true }));
        document.body.innerHTML = `
            <article>
                <p>${'Content for disabled cleansing test. '.repeat(10)}</p>
                <script>alert('remove me')</script>
            </article>
        `;

        const disabled: CleansingConfig = {
            ...hardStripOnly(kernel),
            contentStripHardEnabled: false,
        };
        const result = kernel.extractPageContent(disabled);
        await flushSends();

        expect(result.cleansingExecuted).toBeUndefined();
        expect(sendMessageWithRetry).not.toHaveBeenCalled();
    });

    it('sender が throw しても抽出フローは失敗しない', async () => {
        const { kernel, sendMessageWithRetry } = makeKernel(async () => {
            throw new Error('Port closed');
        });
        document.body.innerHTML = `
            <article>
                <p>${'Content for sender failure test. '.repeat(10)}</p>
                <script>alert('remove me')</script>
            </article>
        `;

        let result;
        expect(() => {
            result = kernel.extractPageContent(hardStripOnly(kernel));
        }).not.toThrow();
        await flushSends();

        expect(result!.content.length).toBeGreaterThan(0);
        expect(sendMessageWithRetry).toHaveBeenCalledTimes(1);
    });
});
