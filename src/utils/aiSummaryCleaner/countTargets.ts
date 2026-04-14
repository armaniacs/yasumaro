/**
 * AI要約クレンジング — カウント専用モジュール
 * DOM要素を削除せずにクレンジング対象の数をカウントする
 */

import { escapeCssSelector } from '../cssUtils.js';
import type { AiSummaryCleanseOptions, AiSummaryCleanseResult } from './types.js';
import { AD_CLASS_PATTERNS, SOCIAL_CLASS_PATTERNS, NAV_CLASS_PATTERNS, DEEP_CLASS_PATTERNS, DEEP_ROLES } from './patterns.js';
import { CARD_PATTERNS } from './stripCore.js';

/**
 * DOMのAI要約クレンジング対象要素数をカウントする（削除は行わない）
 * @param element - カウント対象のルート要素
 * @param options - クレンジングオプション
 * @returns カウント結果
 */
export function countAISummaryTargets(
    element: Element,
    options: AiSummaryCleanseOptions = {}
): AiSummaryCleanseResult {
    const {
        altEnabled = true,
        metadataEnabled = true,
        adsEnabled = true,
        navEnabled = true,
        socialEnabled = true,
        deepEnabled = false,
        jsonLdEnabled = false,
        lazyLoadEnabled = false,
        skipLinkEnabled = false,
        cardEnabled = false,
        linkDensityEnabled = false,
    } = options;

    let altCount = 0;
    let metadataCount = 0;
    let adsCount = 0;
    let navCount = 0;
    let socialCount = 0;
    let deepCount = 0;
    let jsonLdCount = 0;
    let lazyLoadCount = 0;
    let skipLinkCount = 0;
    let cardCount = 0;
    let linkDensityCount = 0;
    
    // 画像alt属性カウント
    if (altEnabled) {
        altCount = element.querySelectorAll('img[alt]').length;
    }
    
    // メタデータカウント
    if (metadataEnabled) {
        const metaElements = element.querySelectorAll('meta').length;
        const titleElements = element.querySelectorAll('title').length;
        const linkElements = element.querySelectorAll('link[rel="icon"], link[rel="stylesheet"], link[rel="canonical"]').length;
        metadataCount = metaElements + titleElements + linkElements;
    }
    
    // 広告関連要素カウント
    if (adsEnabled) {
        const counted = new Set<Element>();
        
        for (const pattern of AD_CLASS_PATTERNS) {
            const kw = escapeCssSelector(pattern.toLowerCase());
            
            const classElements = element.querySelectorAll(`[class*="${kw}"]`);
            classElements.forEach(elem => {
                if (!counted.has(elem)) {
                    adsCount++;
                    counted.add(elem);
                }
            });
            
            const idElements = element.querySelectorAll(`[id*="${kw}"]`);
            idElements.forEach(elem => {
                if (!counted.has(elem)) {
                    adsCount++;
                    counted.add(elem);
                }
            });
        }
    }
    
    // ナビゲーション・フッターカウント
    if (navEnabled) {
        const counted = new Set<Element>();
        
        const navElements = element.querySelectorAll('nav');
        navElements.forEach(elem => {
            if (!counted.has(elem)) {
                navCount++;
                counted.add(elem);
            }
        });
        
        const footerElements = element.querySelectorAll('footer');
        footerElements.forEach(elem => {
            if (!counted.has(elem)) {
                navCount++;
                counted.add(elem);
            }
        });
        
        const roleNavElements = element.querySelectorAll('[role="navigation"]');
        roleNavElements.forEach(elem => {
            if (!counted.has(elem)) {
                navCount++;
                counted.add(elem);
            }
        });
        
        const contentInfoElements = element.querySelectorAll('[role="contentinfo"]');
        contentInfoElements.forEach(elem => {
            if (!counted.has(elem)) {
                navCount++;
                counted.add(elem);
            }
        });

        element.querySelectorAll(
            '[data-testid*="footer"], [data-testid*="nav"], ' +
            '[aria-label*="advertisement"], [aria-label*="navigation"], [aria-label*="footer"]'
        ).forEach(elem => {
            if (!counted.has(elem)) {
                navCount++;
                counted.add(elem);
            }
        });
        
        for (const pattern of NAV_CLASS_PATTERNS) {
            const kw = escapeCssSelector(pattern.toLowerCase());
            
            const classElements = element.querySelectorAll(`[class*="${kw}"]`);
            classElements.forEach(elem => {
                if (!counted.has(elem)) {
                    navCount++;
                    counted.add(elem);
                }
            });
            
            const idElements = element.querySelectorAll(`[id*="${kw}"]`);
            idElements.forEach(elem => {
                if (!counted.has(elem)) {
                    navCount++;
                    counted.add(elem);
                }
            });
        }
    }
    
    // ソーシャルウィジェットカウント
    if (socialEnabled) {
        const counted = new Set<Element>();
        
        const commentsElements = element.querySelectorAll('#comments, .comments, .comment-section');
        commentsElements.forEach(elem => {
            if (!counted.has(elem)) {
                socialCount++;
                counted.add(elem);
            }
        });
        
        for (const pattern of SOCIAL_CLASS_PATTERNS) {
            const kw = escapeCssSelector(pattern.toLowerCase());
            
            const classElements = element.querySelectorAll(`[class*="${kw}"]`);
            classElements.forEach(elem => {
                if (!counted.has(elem)) {
                    socialCount++;
                    counted.add(elem);
                }
            });
            
            const idElements = element.querySelectorAll(`[id*="${kw}"]`);
            idElements.forEach(elem => {
                if (!counted.has(elem)) {
                    socialCount++;
                    counted.add(elem);
                }
            });
        }
    }

    // ディープクレンジング対象カウント
    if (deepEnabled) {
        const counted = new Set<Element>();

        const directTags = element.querySelectorAll('aside, figure, figcaption, form, dialog, iframe, video, audio, script, style, noscript, button, input, select, details');
        directTags.forEach(elem => {
            if (!counted.has(elem)) { deepCount++; counted.add(elem); }
        });

        for (const role of DEEP_ROLES) {
            element.querySelectorAll(`[role="${role}"]`).forEach(elem => {
                if (!counted.has(elem)) { deepCount++; counted.add(elem); }
            });
        }

        for (const pattern of DEEP_CLASS_PATTERNS) {
            const kw = escapeCssSelector(pattern.toLowerCase());
            element.querySelectorAll(`[class*="${kw}"]`).forEach(elem => {
                if (!counted.has(elem)) { deepCount++; counted.add(elem); }
            });
            element.querySelectorAll(`[id*="${kw}"]`).forEach(elem => {
                if (!counted.has(elem)) { deepCount++; counted.add(elem); }
            });
        }

        element.querySelectorAll('ul, ol').forEach(list => {
            if (counted.has(list)) return;
            const totalText = (list.textContent || '').trim().length;
            if (totalText === 0) return;
            let linkText = 0;
            list.querySelectorAll('a').forEach(a => { linkText += (a.textContent || '').length; });
            if (linkText / totalText > 0.7) { deepCount++; counted.add(list); }
        });

        // 非表示要素のカウント
        element.querySelectorAll('[hidden], [aria-hidden="true"], [style*="display:none"], [style*="display: none"]').forEach(elem => {
            if (!counted.has(elem)) { deepCount++; counted.add(elem); }
        });

        // 空要素のカウント（テキストコンテンツが空のdiv/span/p）
        element.querySelectorAll('div, span, p').forEach(elem => {
            if (!counted.has(elem) && (elem.textContent || '').trim() === '') {
                deepCount++; counted.add(elem);
            }
        });
    }

    if (jsonLdEnabled) {
        jsonLdCount = element.querySelectorAll('script[type="application/ld+json"]').length;
    }

    if (lazyLoadEnabled) {
        const counted = new Set<Element>();
        
        element.querySelectorAll('[loading="lazy"]').forEach(elem => {
            if (!counted.has(elem)) { lazyLoadCount++; counted.add(elem); }
        });
        element.querySelectorAll('img[data-src], iframe[data-src], video[data-src]').forEach(elem => {
            if (!counted.has(elem)) { lazyLoadCount++; counted.add(elem); }
        });
        const lazyPatterns = ['lazy', 'skeleton', 'placeholder', 'loading'];
        for (const pattern of lazyPatterns) {
            const kw = escapeCssSelector(pattern);
            element.querySelectorAll(`[class*="${kw}"]`).forEach(elem => {
                if (!counted.has(elem)) { lazyLoadCount++; counted.add(elem); }
            });
        }
    }

    if (skipLinkEnabled) {
        const counted = new Set<Element>();
        
        element.querySelectorAll('a[href^="#"], a[href^="javascript:"]').forEach(elem => {
            if (!counted.has(elem)) { skipLinkCount++; counted.add(elem); }
        });
        element.querySelectorAll('a[role="button"]').forEach(elem => {
            if (!counted.has(elem)) { skipLinkCount++; counted.add(elem); }
        });
        const srPatterns = ['skip', 'sr-only', 'visually-hidden', 'screen-reader'];
        for (const pattern of srPatterns) {
            const kw = escapeCssSelector(pattern);
            element.querySelectorAll(`[class*="${kw}"]`).forEach(elem => {
                if (!counted.has(elem)) { skipLinkCount++; counted.add(elem); }
            });
        }
    }

    if (cardEnabled) {
        const counted = new Set<Element>();
        
        for (const pattern of CARD_PATTERNS) {
            const kw = escapeCssSelector(pattern.toLowerCase());
            element.querySelectorAll(`[class*="${kw}"]`).forEach(elem => {
                if (!counted.has(elem)) { cardCount++; counted.add(elem); }
            });
            element.querySelectorAll(`[id*="${kw}"]`).forEach(elem => {
                if (!counted.has(elem)) { cardCount++; counted.add(elem); }
            });
        }
    }

    if (linkDensityEnabled) {
        const counted = new Set<Element>();
        element.querySelectorAll('ul, ol, div, section').forEach(elem => {
            if (counted.has(elem)) return;
            const totalText = (elem.textContent || '').trim().length;
            if (totalText < 100) return;
            const parent = elem.parentElement;
            if (parent && ['p', 'article', 'section'].includes(parent.tagName.toLowerCase())) return;
            let linkText = 0;
            elem.querySelectorAll('a').forEach(a => { linkText += (a.textContent || '').trim().length; });
            if (totalText > 0 && linkText / totalText >= 0.7) {
                linkDensityCount++;
                counted.add(elem);
            }
        });
    }

    const total = altCount + metadataCount + adsCount + navCount + socialCount +
        deepCount + jsonLdCount + lazyLoadCount + skipLinkCount + cardCount + linkDensityCount;

    return {
        altRemoved: altCount,
        metadataRemoved: metadataCount,
        adsRemoved: adsCount,
        navRemoved: navCount,
        socialRemoved: socialCount,
        deepRemoved: deepCount,
        jsonLdRemoved: jsonLdCount,
        lazyLoadRemoved: lazyLoadCount,
        skipLinkRemoved: skipLinkCount,
        cardRemoved: cardCount,
        linkDensityRemoved: linkDensityCount,
        totalRemoved: total,
        bytesBefore: 0,
        bytesAfter: 0
    };
}