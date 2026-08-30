/**
 * cleansingOffscreen.ts — Offscreen Document でのクレンジング委譲
 *
 * Content Script のメインスレッド占有を削減するための PoC。
 * DOMParser で html 文字列をパースし、cleanseAISummaryContent を実行して
 * cleansed HTML を返す純粋な処理を提供する。
 */

import { cleanseAISummaryContent } from '../utils/aiSummaryCleaner/index.js';
import type { AiSummaryCleanseOptions, AiSummaryCleanseResult } from '../utils/aiSummaryCleaner/types.js';

export const CLEANSING_OFFSCREEN_TYPE = 'CLEANSING_OFFSCREEN' as const;

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
 * Offscreen Document は document を直接持つが、メッセージ経由の文字列を
 * 扱うため DOMParser で隔離された Document を使う。
 * jsdom / node 環境でも動作するようフォールバックを用意。
 */
export function cleanseHtmlOffscreen(
    html: string,
    options?: AiSummaryCleanseOptions,
): { html: string; result: AiSummaryCleanseResult } {
    const Parser = (globalThis as unknown as { DOMParser?: typeof DOMParser }).DOMParser;
    let rootEl: Element;
    let doc: Document | null = null;

    if (Parser) {
        const parser = new Parser();
        doc = parser.parseFromString(html, 'text/html');
        rootEl = doc.body as unknown as Element;
    } else if (typeof document !== 'undefined' && (document as unknown as { createElement?: (tag: string) => Element }).createElement) {
        const container = document.createElement('div');
        container.innerHTML = html;
        rootEl = container;
    } else {
        throw new Error('No DOM available for cleansing');
    }

    const result = cleanseAISummaryContent(rootEl, options ?? {});

    let cleansedHtml: string;
    if (doc) {
        cleansedHtml = (doc.body as unknown as Element).innerHTML;
    } else {
        cleansedHtml = (rootEl as HTMLElement).innerHTML;
    }

    return { html: cleansedHtml, result };
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
        const msg = e instanceof Error ? e.message : String(e);
        return { success: false, error: msg };
    }
}
