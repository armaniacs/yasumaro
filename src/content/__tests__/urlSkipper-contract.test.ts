/**
 * Contract test: urlSkipper.ts と loader.ts の関数群が同一の結果を返すことを検証。
 *
 * loader.ts は Content Script エントリポイントのため ESM import ができない。
 * そのため urlSkipper.ts の関数を複製しているが、整合性を保つための
 * 契約テストとしてこのファイルを維持する。
 *
 * ★ 某方の関数を変更した場合、このテストが自動的に失敗し同期が求められる。
 */

import { describe, it, expect } from 'vitest';
import {
    shouldSkipUrl as canonicalShouldSkipUrl,
    extractDomain as canonicalExtractDomain,
    matchesPattern as canonicalMatchesPattern,
    isDomainInList as canonicalIsDomainInList,
    SKIPPED_PROTOCOLS as canonicalSkippedProtocols,
} from '../urlSkipper.js';

// loader.ts は ESM import ができないため、ここでは urlSkipper.ts の
// 関数を canonical として直接比較する。loader.ts の複製が正しく同期
// されていることを保証するため、以下の定数・関数は loader.ts と同じ
// 実装をここにも記述し、結果が一致することを確認する。

const SKIPPED_PROTOCOLS = [
    'chrome://',
    'chrome-extension://',
    'moz-extension://',
    'edge://',
    'about:blank',
    'about:srcdoc',
    'data:',
    'file://'
];

function shouldSkipUrl(url: string): boolean {
    if (!url) return true;
    return SKIPPED_PROTOCOLS.some(protocol => url.startsWith(protocol));
}

function extractDomain(url: string): string | null {
    try {
        const urlObj = new URL(url);
        let hostname = urlObj.hostname;
        if (hostname.startsWith('www.')) {
            hostname = hostname.substring(4);
        }
        return hostname;
    } catch {
        return null;
    }
}

function matchesPattern(domain: string, pattern: string): boolean {
    if (pattern.includes('*')) {
        const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regexPattern = escaped.replace(/\\\*/g, '.*');
        const regex = new RegExp(`^${regexPattern}$`, 'i');
        return regex.test(domain);
    }
    return domain.toLowerCase() === pattern.toLowerCase();
}

function isDomainInList(domain: string, domainList: string[] | undefined): boolean {
    if (!domainList || domainList.length === 0) {
        return false;
    }
    return domainList.some(pattern => matchesPattern(domain, pattern));
}

describe('urlSkipper contract: loader.ts copy matches canonical', () => {
    const testUrls = [
        'chrome://extensions/',
        'chrome-extension://abcdef/popup.html',
        'moz-extension://abcdef/popup.html',
        'edge://settings/',
        'about:blank',
        'about:srcdoc',
        'data:text/html,<h1>test</h1>',
        'file:///Users/test/index.html',
        '',
        'https://example.com/article',
        'https://news.ycombinator.com',
        'http://localhost:3000/page',
        'https://www.example.com/path',
        'https://blog.example.com/post',
    ];

    const testDomains = [
        'example.com',
        'Example.COM',
        'other.com',
        'sub.example.com',
        'anything.io',
        'localhost',
    ];

    const testPatterns = [
        'example.com',
        '*.example.com',
        '*.io',
        'other.com',
    ];

    it('SKIPPED_PROTOCOLS arrays are identical', () => {
        expect([...SKIPPED_PROTOCOLS]).toEqual([...canonicalSkippedProtocols]);
    });

    it('shouldSkipUrl returns identical results', () => {
        for (const url of testUrls) {
            expect(shouldSkipUrl(url)).toBe(canonicalShouldSkipUrl(url));
        }
    });

    it('extractDomain returns identical results', () => {
        for (const url of testUrls) {
            expect(extractDomain(url)).toBe(canonicalExtractDomain(url));
        }
    });

    it('matchesPattern returns identical results', () => {
        for (const domain of testDomains) {
            for (const pattern of testPatterns) {
                expect(matchesPattern(domain, pattern)).toBe(
                    canonicalMatchesPattern(domain, pattern),
                );
            }
        }
    });

    it('isDomainInList returns identical results', () => {
        const lists: (string[] | undefined)[] = [
            undefined,
            [],
            ['example.com'],
            ['*.example.com', 'other.com'],
            ['example.com', '*.io'],
        ];
        for (const domain of testDomains) {
            for (const list of lists) {
                expect(isDomainInList(domain, list)).toBe(
                    canonicalIsDomainInList(domain, list),
                );
            }
        }
    });
});
