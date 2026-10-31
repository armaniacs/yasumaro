/**
 * selectionCapture.ts (PBI 2026-10-31-03)
 * GET_SELECTION message handler — the content script's only selection route.
 *
 * The popup asks the active tab's content script for the current selection
 * when the user records this page (今すぐ記録 button). The handler is
 * chrome-free: the sender check uses an injected runtimeId and the selection
 * reader arrives via deps, so unit tests call handleGetSelectionMessage
 * directly without chrome mocks. The reader is injected because the handler
 * itself never touches window.getSelection() — production wiring binds the
 * live DOM read (extractor.ts), tests bind fakes.
 *
 * The raw selection travels verbatim: normalization (one-line sanitize +
 * 10,000-char cap) is applied by the consumer side via
 * utils/selectionText.normalizeSelectionText, so the same helper serves both
 * capture paths (popup message and the keyboard path's executeScript func)
 * without a content-script copy.
 */

export interface GetSelectionMessage {
    type: string;
}

export interface GetSelectionSender {
    id?: string;
}

export interface SelectionResponse {
    /** Raw window.getSelection().toString() — '' when nothing is selected. */
    selection: string;
}

export interface SelectionCaptureDeps {
    runtimeId: string | undefined;
    /** Injected selection reader (live DOM read in production, fake in tests). */
    readSelection: () => string;
}

/** The one message type this handler answers. */
export const GET_SELECTION_MESSAGE_TYPE = 'GET_SELECTION';

export function handleGetSelectionMessage(
    message: unknown,
    sender: GetSelectionSender,
    sendResponse: (response?: unknown) => void,
    deps: SelectionCaptureDeps,
): void {
    if (typeof message !== 'object' || message === null || !('type' in message)) return;
    const msg = message as GetSelectionMessage;
    if (msg.type !== GET_SELECTION_MESSAGE_TYPE) return;
    // Extension-origin only — the same guard the GET_CONTENT handler applies.
    if (sender.id !== deps.runtimeId) return;
    sendResponse({ selection: deps.readSelection() });
}
