// @vitest-environment jsdom
/**
 * dashboardIssueReportQueue.test.ts
 *
 * Regression pin for the branch review finding: a "Report a Bug" entry point
 * wired while the shared modal controller has not been created yet
 * (diagnostics panel as the ?tab= deep-link initial panel — mount runs before
 * the async page init and never re-runs) must be queued and wired as soon as
 * the controller exists, not silently skipped by an optional chain.
 *
 * The queue now lives in panels/diagnostic/issueReportEntry.ts (PBI
 * 2026-09-15-06) — registerReportBugButton + initIssueReportEntry.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const attachSpy = vi.fn();

vi.mock('../panels/diagnostic/issueReportLink.js', () => ({
    createIssueReportModalController: vi.fn(() => ({ attachTrigger: attachSpy })),
}));
vi.mock('../trancoConsent.js', () => ({
    initTrancoConsentPanel: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../panels/diagnostic/DiagnosticsCollector.js', () => ({
    diagnosticsCollector: { collect: vi.fn().mockResolvedValue({}) },
}));

vi.stubGlobal('chrome', {
    i18n: {
        getMessage: vi.fn((key: string) => key),
        getUILanguage: vi.fn(() => 'en'),
    },
    runtime: {
        sendMessage: vi.fn().mockResolvedValue({}),
    },
    storage: {
        local: {
            get: vi.fn().mockResolvedValue({}),
            set: vi.fn().mockResolvedValue(undefined),
        },
    },
});

describe('attachIssueReportTrigger queue', () => {
    beforeEach(() => {
        vi.resetModules();
        attachSpy.mockClear();
        document.body.innerHTML = `
            <dialog id="bugReportPreviewModal"></dialog>
            <textarea id="bugReportPreviewContent"></textarea>
            <button id="bugReportCancelBtn"></button>
            <button id="bugReportPreviewCloseBtn"></button>
            <button id="bugReportOpenBtn"></button>
            <button id="sidebarReportBugBtn"></button>
        `;
    });

    it('wires a trigger queued before the controller exists as soon as it is created', async () => {
        const { registerReportBugButton, initIssueReportEntry } = await import(
            '../panels/diagnostic/issueReportEntry.js'
        );
        const earlyBtn = document.createElement('button');

        // Panel mount ran before the page-level init created the controller.
        registerReportBugButton(earlyBtn);
        expect(attachSpy).not.toHaveBeenCalled();

        initIssueReportEntry();

        // Sidebar button (direct) + the queued early button (flushed).
        expect(attachSpy).toHaveBeenCalledTimes(2);
        expect(attachSpy).toHaveBeenCalledWith(earlyBtn);
    });

    it('wires a trigger attached after the controller exists immediately', async () => {
        const { registerReportBugButton, initIssueReportEntry } = await import(
            '../panels/diagnostic/issueReportEntry.js'
        );
        initIssueReportEntry();
        expect(attachSpy).toHaveBeenCalledTimes(1);

        const lateBtn = document.createElement('button');
        registerReportBugButton(lateBtn);
        expect(attachSpy).toHaveBeenCalledTimes(2);
        expect(attachSpy).toHaveBeenLastCalledWith(lateBtn);
    });
});
