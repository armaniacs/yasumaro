// @vitest-environment jsdom
/**
 * mediaKind.test.ts
 * Table tests for adaptive-recording media-kind detection (PBI 2026-10-23-02).
 *
 * The contract: unknown/blank input resolves to `article` (the legacy
 * condition), and detection never throws on a hostile or broken DOM.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyMediaKind,
  detectMediaKind,
  emptyMediaSignals,
  isMediaKind,
  MEDIA_KINDS,
} from '../mediaKind.js';

describe('classifyMediaKind', () => {
  it.each([
    ['pdf viewer wins over everything', { hasPlayingVideo: true, isPdfViewer: true, codeDominant: true, codeCopied: true }, 'pdf'],
    ['playing video classifies video', { hasPlayingVideo: true, isPdfViewer: false, codeDominant: false, codeCopied: false }, 'video'],
    ['dominant code classifies code', { hasPlayingVideo: false, isPdfViewer: false, codeDominant: true, codeCopied: false }, 'code'],
    ['copy on code classifies code', { hasPlayingVideo: false, isPdfViewer: false, codeDominant: false, codeCopied: true }, 'code'],
    ['blank signals resolve article', { hasPlayingVideo: false, isPdfViewer: false, codeDominant: false, codeCopied: false }, 'article'],
  ] as const)('%s', (_label, signals, expected) => {
    expect(classifyMediaKind(signals)).toBe(expected);
  });

  it('neutral signals equal emptyMediaSignals', () => {
    expect(classifyMediaKind(emptyMediaSignals())).toBe('article');
  });
});

describe('detectMediaKind', () => {
  it('classifies an article page', () => {
    document.body.innerHTML = '<p>' + 'a'.repeat(200) + '</p>';
    expect(detectMediaKind(document)).toBe('article');
  });

  it('classifies a code page from a dominant pre block', () => {
    document.body.innerHTML = '<pre>' + 'const x = 1;'.repeat(40) + '</pre><p>short note</p>';
    expect(detectMediaKind(document)).toBe('code');
  });

  it('classifies an embedded pdf page', () => {
    document.body.innerHTML = '<embed type="application/pdf" />';
    expect(detectMediaKind(document)).toBe('pdf');
  });

  it('classifies a playing video page', () => {
    document.body.innerHTML = '<video autoplay playsinline></video>';
    const video = document.querySelector('video');
    Object.defineProperty(video, 'paused', { value: false });
    Object.defineProperty(video, 'readyState', { value: 4 });
    expect(detectMediaKind(document)).toBe('video');
  });

  it('keeps a page with one snippet plus prose on the article side', () => {
    document.body.innerHTML =
      '<pre>short</pre><p>' + 'prose '.repeat(120) + '</p>';
    expect(detectMediaKind(document)).toBe('article');
  });

  it('resolves article when the body is empty', () => {
    document.body.innerHTML = '';
    expect(detectMediaKind(document)).toBe('article');
  });
});

describe('isMediaKind', () => {
  it('accepts the enumerated set only', () => {
    for (const kind of MEDIA_KINDS) expect(isMediaKind(kind)).toBe(true);
    expect(isMediaKind('song')).toBe(false);
    expect(isMediaKind(undefined)).toBe(false);
    expect(isMediaKind(42)).toBe(false);
  });
});
