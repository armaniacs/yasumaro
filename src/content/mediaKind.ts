// @layer 0 — Foundation (no imports)
/**
 * mediaKind.ts
 *
 * Media-kind detection for adaptive recording (PBI 2026-10-23-02). The
 * recording gate used one condition for every page (5s + 50% scroll); a
 * watched video, a read PDF, and a studied code file neither read nor scroll
 * the same way, so pages that were read could be dropped and pages that were
 * glanced at could be kept. This module classifies the page once at load from
 * the DOM, and the gate branches on the verdict.
 *
 * An unknown page classifies as `article` and keeps the legacy condition, so
 * the detector's blind spots can only ever fall back to today's behavior
 * (縮退の出口). Detection never throws: it reads the DOM defensively.
 */

export type MediaKind = 'article' | 'video' | 'pdf' | 'code';

export const MEDIA_KINDS: readonly MediaKind[] = ['article', 'video', 'pdf', 'code'];

export function isMediaKind(value: unknown): value is MediaKind {
    return typeof value === 'string' && (MEDIA_KINDS as readonly string[]).includes(value);
}

export interface MediaSignals {
    /** A video element exists and is playing (or has been played). */
    hasPlayingVideo: boolean;
    /** The document is the browser PDF viewer (or an embedded PDF). */
    isPdfViewer: boolean;
    /** Code blocks dominate the visible content. */
    codeDominant: boolean;
    /** Copy events observed on code content (set by the copy listener). */
    codeCopied: boolean;
}

/** Neutral signals: the detector reads nothing before the DOM is inspected. */
export function emptyMediaSignals(): MediaSignals {
    return { hasPlayingVideo: false, isPdfViewer: false, codeDominant: false, codeCopied: false };
}

/** Classify from one set of signals. Unknown/blank input resolves to article. */
export function classifyMediaKind(signals: MediaSignals): MediaKind {
    if (signals.isPdfViewer) return 'pdf';
    if (signals.hasPlayingVideo) return 'video';
    if (signals.codeDominant || signals.codeCopied) return 'code';
    return 'article';
}

/**
 * Classify from the live document. Defensive by contract: every read is
 * guarded, so a hostile or broken DOM yields `article`, never a throw.
 */
export function detectMediaKind(doc: Document): MediaKind {
    const signals = emptyMediaSignals();
    try {
        signals.isPdfViewer = detectPdf(doc);
        signals.hasPlayingVideo = detectPlayingVideo(doc);
        signals.codeDominant = detectCodeDominant(doc);
    } catch {
        return 'article';
    }
    return classifyMediaKind(signals);
}

function detectPdf(doc: Document): boolean {
    const contentType = (doc as unknown as { contentType?: string }).contentType;
    if (contentType === 'application/pdf') return true;
    if (doc.querySelector('embed[type="application/pdf"], object[type="application/pdf"]')) return true;
    return false;
}

function detectPlayingVideo(doc: Document): boolean {
    const videos = doc.querySelectorAll('video');
    for (const video of videos) {
        if (!video.paused && !video.ended && video.readyState > 2) return true;
    }
    return false;
}

/**
 * Code dominance: the largest text block on the page is a pre/code element.
 * Comparing character counts (not node counts) keeps a page with one snippet
 * plus long prose on the article side.
 */
function detectCodeDominant(doc: Document): boolean {
    const codeBlocks = doc.querySelectorAll('pre, pre code');
    let codeChars = 0;
    for (const block of codeBlocks) {
        codeChars += (block.textContent ?? '').length;
    }
    if (codeChars === 0) return false;
    const bodyChars = (doc.body?.textContent ?? '').length;
    if (bodyChars === 0) return false;
    return codeChars / bodyChars >= 0.5;
}
