// @vitest-environment wasm-quickjs-dom
/**
 * Parity pin for PBI 2026-11-11-03 (log-path-unify): the diagnostics
 * collection failure travels the structured-logger seam (logError) with the
 * same `[BugReport] ... failed after Nms` wording the old console.error
 * carried — and error internals never reach the outbound issue body.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logError } from '../../../../utils/logger/api.js';
import { ErrorCode } from '../../../../utils/logger/types.js';
import { createIssueReportModalController } from '../issueReportLink.js';
import type { DiagnosticsSnapshot } from '../DiagnosticsCollector.js';

vi.mock('../../../../utils/logger/api.js', () => ({
    logError: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../utils/logger/core.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../../utils/logger/core.js')>()),
    getLogs: vi.fn().mockResolvedValue([]),
}));

async function flushMicrotasks(): Promise<void> {
    for (let i = 0; i < 10; i++) await Promise.resolve();
}

function buildDom(): {
    reportBtn: HTMLButtonElement;
    previewModal: HTMLDialogElement;
    previewContent: HTMLTextAreaElement;
    cancelBtn: HTMLButtonElement;
    closeBtn: HTMLButtonElement;
    openBtn: HTMLButtonElement;
} {
    document.body.innerHTML = `
    <button id="reportBugBtn"></button>
    <dialog id="bugReportPreviewModal">
      <textarea id="bugReportPreviewContent"></textarea>
      <button id="bugReportCancelBtn"></button>
      <button id="bugReportPreviewCloseBtn"></button>
      <button id="bugReportOpenBtn"></button>
    </dialog>
  `;
    const modal = document.getElementById('bugReportPreviewModal') as HTMLDialogElement;
    modal.showModal = function (this: HTMLDialogElement) {
        this.open = true;
    };
    modal.close = function (this: HTMLDialogElement) {
        this.open = false;
    };
    return {
        reportBtn: document.getElementById('reportBugBtn') as HTMLButtonElement,
        previewModal: modal,
        previewContent: document.getElementById(
            'bugReportPreviewContent'
        ) as HTMLTextAreaElement,
        cancelBtn: document.getElementById('bugReportCancelBtn') as HTMLButtonElement,
        closeBtn: document.getElementById('bugReportPreviewCloseBtn') as HTMLButtonElement,
        openBtn: document.getElementById('bugReportOpenBtn') as HTMLButtonElement,
    };
}

describe('issueReportLink collection failure seam (PBI 2026-11-11-03)', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        vi.mocked(logError).mockClear();
        (globalThis as unknown as { chrome: unknown }).chrome = {
            tabs: { create: vi.fn() },
            i18n: { getMessage: () => '' },
        };
    });

    it('routes the collection failure via logError with the [BugReport] wording', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            const dom = buildDom();
            const controller = createIssueReportModalController(
                {
                    previewModal: dom.previewModal,
                    previewContent: dom.previewContent,
                    cancelBtn: dom.cancelBtn,
                    closeBtn: dom.closeBtn,
                    openBtn: dom.openBtn,
                },
                () => Promise.reject(new Error('boom')),
                { collectionTimeoutMs: 15_000 }
            );
            controller.attachTrigger(dom.reportBtn);

            dom.reportBtn.click();
            await flushMicrotasks();

            expect(logError).toHaveBeenCalledTimes(1);
            const [message, details, errorCode, source] = vi.mocked(logError).mock.calls[0]!;
            expect(String(message)).toMatch(
                /^\[BugReport\] diagnostics collection failed after \d+ms:$/
            );
            expect(details).toEqual({ error: 'boom' });
            expect(errorCode).toBe(ErrorCode.UNKNOWN_ERROR);
            expect(source).toBe('issueReportLink');
            expect(consoleSpy).not.toHaveBeenCalled();

            // The user-facing preview carries the safe fallback text, never the internals.
            expect(dom.previewContent.value).toContain('Failed to prepare');
            expect(dom.previewContent.value).not.toContain('boom');
            expect(dom.openBtn.disabled).toBe(true);
        } finally {
            consoleSpy.mockRestore();
        }
    });

    it('pins the success path still fills the sanitized report (wording unchanged)', async () => {
        const dom = buildDom();
        const snapshot = {
            storage: { bytesUsedKb: '0', savedUrls: '0' },
            sqlite: { initialized: true, path: '', fallback: false, fts5: true },
            deficiencies: [],
            builtInAi: null,
            obsidian: { protocol: 'https', port: '27124', apiKey: '', dailyPath: '' },
            aiProviders: [],
            aiProviderDetails: [],
            extInfo: { version: '0.0.0', name: 'test' },
            divergence: { dashboardDetectsOpfs: true, offscreenUsesFallback: false },
            settingsLoadFailed: false,
            debugMode: false,
        } as DiagnosticsSnapshot;
        const controller = createIssueReportModalController(
            {
                previewModal: dom.previewModal,
                previewContent: dom.previewContent,
                cancelBtn: dom.cancelBtn,
                closeBtn: dom.closeBtn,
                openBtn: dom.openBtn,
            },
            () => Promise.resolve(snapshot)
        );
        controller.attachTrigger(dom.reportBtn);

        dom.reportBtn.click();
        await flushMicrotasks();

        expect(logError).not.toHaveBeenCalled();
        expect(dom.previewContent.value).toContain('0.0.0');
        expect(dom.openBtn.disabled).toBe(false);
    });
});
