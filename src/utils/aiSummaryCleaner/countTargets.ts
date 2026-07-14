/**
 * AI要約クレンジング — カウント専用モジュール
 * DOM要素を削除せずにクレンジング対象の数をカウントする
 */

import { escapeCssSelector } from '../cssUtils.js';
import type { AiSummaryCleanseOptions, AiSummaryCleanseResult } from './types.js';
import { AD_CLASS_PATTERNS, SOCIAL_CLASS_PATTERNS, NAV_CLASS_PATTERNS, DEEP_CLASS_PATTERNS, DEEP_ROLES, GUTENBERG_STRUCTURAL_PATTERNS } from './patterns.js';
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
        // Category A: Japanese WordPress patterns
        jpLayoutEnabled = false,
        affiliateEnabled = false,
        speechBubbleEnabled = false,
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
    let jpLayoutCount = 0;
    let affiliateCount = 0;
    let speechBubbleCount = 0;
    
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

    // Category A: Japanese WordPress Theme Patterns
    if (jpLayoutEnabled) {
        const counted = new Set<Element>();
        const jpLayoutPatterns = [
            'l-footer', 'l-header', 'l-sidebar', 'l-wrapper',
            'p-entry__footer', 'p-entry__header', 'p-entry__body',
            'c-button', 'c-label', 'c-card',
            'common-footer', 'common-header', 'sub-column',
            'ly-', 'el-',
            // A-1: WordPress Themes
            'swell-toc', 'p-postList', 'c-shareBtns', 'p-relatedPosts', 'c-widget',
            'swell-block-', 'swell-block-check', 'swell-block-quote',
            'author-box', 'author-box-label', 'sns-share', 'related-entry-card',
            'toc', 'toc-box', 'sidebar', 'sns-follow-buttons', 'article-outer',
            'entry-card', 'post-list', 'sidebar-widget', 'author-block', 'share-btn',
            'entry-utility', 'cat-links', 'tag-links', 'wp-post-image', 'post-thumbnail',
            'sm-related-posts', 'sm-author-profile', 'sm-widget', 'sm-entry-summary',
            'stinger', 'stingerV8',
            // A-3: Stealth Marketing Disclosure
            'ad-disclosure', 'promotion-note', 'pr-disclosure',
            'disclosure-area', 'sponsor-info-wrapper', 'pr-note',
            'promotion-content', 'sponsored-content-label',
            // A-4: Japanese Recommend Ad Engines
            'popin_recommend', 'popin_recommend_container', 'popin-recommend',
            'logly-lift', 'logly-lift-widget', 'logly-widget',
            'uzou-recommend', 'uzou-widget', 'uzou-recommendation',
            'outbrain_carousels', 'outbrain-widget', 'taboola-placeholder',
            'taboola-unit', 'taboola-container',
            // A-5: Gutenberg Decorative/UI Blocks
            'wp-block-button', 'wp-block-separator', 'wp-block-spacer',
            'wp-block-pullquote', 'wp-block-image', 'wp-block-list',
            'wp-block-quote', 'wp-block-code',
            // A-6: Japanese Blog UI Components
            'pagetop', 'page-top', 'to-top', 'go-top', 'btn-pagetop', 'back-to-top',
            'drawer-menu', 'sp-menu', 'hamburger', 'toggle-menu', 'mobile-menu', 'menu-drawer',
            'toc-container', 'rtoc-box', 'toc_list',
            'table-of-contents', 'toc-wrapper', 'toc_title',
            'access-counter', 'accesscount', 'pv-counter', 'page-counter',
        ];
        for (const pattern of jpLayoutPatterns) {
            const kw = escapeCssSelector(pattern.toLowerCase());
            element.querySelectorAll(`[class*="${kw}"]`).forEach(elem => {
                if (!counted.has(elem)) { jpLayoutCount++; counted.add(elem); }
            });
            element.querySelectorAll(`[id*="${kw}"]`).forEach(elem => {
                if (!counted.has(elem)) { jpLayoutCount++; counted.add(elem); }
            });
        }
    }

    if (affiliateEnabled) {
        const counted = new Set<Element>();
        const affiliatePatterns = [
            'yyi-rinker-contents', 'yyi-rinker-box', 'yyi-rinker-title', 'yyi-rinker-text',
            'kaerebalink-box', 'kaerebalink-name', 'yomerebalink-box', 'booklink-box',
            'moshimo-style-single', 'moshimo-style', 'moshimo-affiliate',
            'pochipp-box', 'pochi-contents', 'pochipp-card', 'pochipp-btn',
        ];
        for (const pattern of affiliatePatterns) {
            const kw = escapeCssSelector(pattern.toLowerCase());
            element.querySelectorAll(`[class*="${kw}"]`).forEach(elem => {
                if (!counted.has(elem)) { affiliateCount++; counted.add(elem); }
            });
            element.querySelectorAll(`[id*="${kw}"]`).forEach(elem => {
                if (!counted.has(elem)) { affiliateCount++; counted.add(elem); }
            });
        }
    }

    if (speechBubbleEnabled) {
        const bubbleSelectors = [
            '.speech-balloon', '.balloon-box', '.talk-balloon',
            '.balloon', '.talk-box', '.chat-bubble',
            '.comment-balloon', '.message-balloon',
        ];
        speechBubbleCount = element.querySelectorAll(bubbleSelectors.join(', ')).length;
    }

    const total = altCount + metadataCount + adsCount + navCount + socialCount +
        deepCount + jsonLdCount + lazyLoadCount + skipLinkCount + cardCount + linkDensityCount +
        jpLayoutCount + affiliateCount + speechBubbleCount;

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
        // NEW: 6つの新しいオプション
        fixedRemoved: 0,
        recommendRemoved: 0,
        paginationRemoved: 0,
        snsPromoRemoved: 0,
        popupRemoved: 0,
        platformRemoved: 0,
        // NEW: 9つの追加オプション
        textDensityRemoved: 0,
        shortSeqRemoved: 0,
        symbolLineRemoved: 0,
        linkParaRemoved: 0,
        enhancedHiddenRemoved: 0,
        emptyElemRemoved: 0,
        jpLayoutRemoved: jpLayoutCount,
        jpNavigationRemoved: 0,
        authorRemoved: 0,
        affiliateRemoved: affiliateCount,
        speechBubbleRemoved: speechBubbleCount,
        totalRemoved: total,
        bytesBefore: 0,
        bytesAfter: 0
    } as AiSummaryCleanseResult;
}