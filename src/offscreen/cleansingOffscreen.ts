/**
 * cleansingOffscreen.ts — Offscreen Document でのクレンジング委譲
 *
 * Content Script のメインスレッド占有を削減するための PoC。
 * DOMParser で html 文字列をパースし、cleanseAISummaryContent を実行して
 * cleansed HTML を返す純粋な処理を提供する。
 */

import { cleanseAISummaryContent } from '../utils/aiSummaryCleaner/index.js';
import { errorMessage } from '../utils/errorUtils.js';
import type { AiSummaryCleanseOptions, AiSummaryCleanseResult } from '../utils/aiSummaryCleaner/types.js';

export const CLEANSING_OFFSCREEN_TYPE = 'CLEANSING_OFFSCREEN' as const;

/**
 * Error prefix marking a size-limit rejection. Delegates (content scripts)
 * must NOT fall back to a local parse for these failures — the whole point of
 * the cap is to prevent the heavy parse anywhere, so returning the original
 * HTML is safer than re-parsing on the main thread.
 */
export const TOO_LARGE_ERROR_PREFIX = 'TOO_LARGE:' as const;

/**
 * Maximum accepted payload size in bytes.
 * Oversized input would block the Offscreen document's DOMParser for a long
 * time, so reject early instead of attempting to parse.
 */
export const MAX_CLEANSING_HTML_BYTES = 512 * 1024;

export interface CleansingOffscreenPayload {
    html: string;
    options?: AiSummaryCleanseOptions;
}

export interface CleansingOffscreenSuccess {
    success: true;
    html: string;
    totalRemoved: number;
    bytesBefore: number;
    bytesAfter: number;
    removed: AiSummaryCleanseResult['removed'];
}

export interface CleansingOffscreenFailure {
    success: false;
    error: string;
}

export type CleansingOffscreenResponse = CleansingOffscreenSuccess | CleansingOffscreenFailure;

/**
 * html 文字列をパースしてクレンジングを実行し、結果と cleansed HTML を返す。
 *
 * メッセージ経由の文字列を扱うため、DOMParser で隔離された Document を
 * 使う（パース先はスクリプト実行・リソース読み込みが起きない不活性な
 * Document）。jsdom では global の DOMParser が無いケースがあるため、
 * document.defaultView からの取得も行う。
 */
export function cleanseHtmlOffscreen(
    html: string,
    options?: AiSummaryCleanseOptions,
): { html: string; result: AiSummaryCleanseResult } {
    // DOMParser acquisition: global first, then the live document's view.
    // Parsed documents are inert (scripts never execute, subresources never
    // load), so the parse is isolated from the live page in every case.
    const Parser =
        (globalThis as unknown as { DOMParser?: typeof DOMParser }).DOMParser ??
        (typeof document !== 'undefined'
            ? (document.defaultView as unknown as { DOMParser?: typeof DOMParser } | null)?.DOMParser
            : undefined);
    if (!Parser) {
        throw new Error('No DOM available for cleansing');
    }
    const parser = new Parser();
    const doc = parser.parseFromString(html, 'text/html');
    const rootEl = doc.body as unknown as Element;

    // rootEl is a throwaway parsed tree; cleanseAISummaryContent mutates it
    // in place so the cleansed HTML can be serialized back below.
    const result = cleanseAISummaryContent(rootEl, options ?? {});

    return { html: (doc.body as unknown as Element).innerHTML, result };
}

/**
 * Offscreen メッセージハンドラのペイロード検証と実行。
 * handleOffscreenMessage から委譲される具体的な処理。
 */
export function handleCleansingOffscreenPayload(
    payload: unknown,
): CleansingOffscreenResponse {
    if (typeof payload !== 'object' || payload === null || typeof (payload as Record<string, unknown>).html !== 'string') {
        return { success: false, error: 'Invalid payload: html is required' };
    }
    const { html, options } = payload as { html: string; options?: AiSummaryCleanseOptions };
    if (html.length > MAX_CLEANSING_HTML_BYTES) {
        return { success: false, error: `${TOO_LARGE_ERROR_PREFIX} ${html.length} bytes exceeds limit of ${MAX_CLEANSING_HTML_BYTES}` };
    }
    try {
        const { html: cleansed, result } = cleanseHtmlOffscreen(html, options);
        return {
            success: true,
            html: cleansed,
            totalRemoved: result.totalRemoved,
            bytesBefore: result.bytesBefore,
            bytesAfter: result.bytesAfter,
            removed: result.removed,
        };
    } catch (e: unknown) {
        const msg = errorMessage(e);
        return { success: false, error: msg };
    }
}
