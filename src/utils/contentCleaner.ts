/**
 * contentCleaner.ts
 * 【機能概要】: WebページのDOMから機密情報を含む可能性がある要素を削除する
 * 【設計方針】:
 *   - Hard Strip: タグ・属性ベースの強制削除
 *   - Keyword Strip: ID/クラス属性のキーワードベース削除
 *   - 外部ライブラリ不使用（バンドルサイズ抑止）
 * 🟢
 */

import { escapeCssSelector } from './cssUtils.js';

/**
 * デフォルトのキーワードリスト（countCleanseTargets / cleanseContent 共通）
 * モジュールスコープで一元管理し、重複定義によるデグレを防ぐ
 */
const DEFAULT_KEYWORDS: readonly string[] = [
    'balance', 'account', 'meisai', 'login', 'card-number', 'keiyaku',
    'password', 'payment', 'transaction', 'billing', 'invoice', 'receipt',
    'rireki', 'torihiki', 'zandaka', 'hoken', 'address',
    'credit-card', 'cc-number', 'card-expiry', 'cvv', 'cvc', 'security-code',
    'bank-account', 'routing-number', 'iban', 'swift', 'bic',
    'mynumber', 'my-number', 'personal-number', 'social-security', 'ssn',
    'passport', 'driver-license', 'license-number',
    'email', 'phone', 'tel-number', 'mobile',
    'birth-date', 'birthday', 'age', 'gender',
    'postal-code', 'zip-code', 'prefecture', 'city',
    'medical', 'patient-id', 'insurance',
    'crypto', 'wallet', 'private-key', 'seed-phrase'
];

/**
 * Hard Strip 用タグセレクタ
 * これらのタグに一致する要素をすべて削除
 */
const HARD_STRIP_TAGS = new Set([
    'input',
    'textarea',
    'select',
    'button',
    'form',
    'script',
    'iframe',
    'style',
    'canvas',
    'embed',
    'object',
    'audio',
    'video'
]);

/**
 * Hard Strip 用属性セレクタ
 * これらの属性に一致する要素を削除
 */
export interface AttributeSelector {
    name: string;
    value?: string | RegExp;
}

const HARD_STRIP_ATTRIBUTES: AttributeSelector[] = [
    { name: 'type', value: 'password' },
    { name: 'type', value: 'hidden' },
    { name: 'type', value: 'file' },
    { name: 'type', value: 'email' },
    { name: 'type', value: 'tel' },
    { name: 'autocomplete' },
    { name: 'inputmode', value: /^(numeric|tel|email)$/i }
];

/**
 * 要素がHard Strip対象かどうかを判定
 * @param element - 判定対象の要素
 * @param attributes - 判定に使用する属性セレクタ（省略時はHARD_STRIP_ATTRIBUTES）
 * @returns trueの場合は削除対象
 */
export function isHardStripTarget(element: Element, attributes: AttributeSelector[] = HARD_STRIP_ATTRIBUTES): boolean {
    // タグ名で判定
    if (HARD_STRIP_TAGS.has(element.tagName.toLowerCase())) {
        return true;
    }

    // 属性で判定
    for (const attr of attributes) {
        if (attr.value === undefined) {
            // 属性が存在する場合のみ
            if (element.hasAttribute(attr.name)) {
                return true;
            }
        } else if (attr.value instanceof RegExp) {
            // 正規表現マッチ
            const attrValue = element.getAttribute(attr.name);
            if (attrValue && attr.value.test(attrValue)) {
                return true;
            }
        } else {
            // 完全一致
            if (element.getAttribute(attr.name) === attr.value) {
                return true;
            }
        }
    }

    return false;
}

/**
 * DOMからHard Strip対象の要素を削除する
 * @param element - クレンジング対象のルート要素
 * @returns 削除された要素の数
 */
export function stripHardStripElements(element: Element): number {
    let removedCount = 0;

    // 削除対象の要素を収集（後から削除してDOM操作の問題を回避）
    const elementsToRemove: Element[] = [];

    // タグセレクタをCSSセレクタ文字列に変換
    const tagSelector = [...HARD_STRIP_TAGS].join(',');

    // タグに一致する要素を取得
    if (tagSelector) {
        const tagElements = element.querySelectorAll(tagSelector);
        tagElements.forEach(elem => elementsToRemove.push(elem));
    }

    // 属性に一致する要素を取得
    for (const attr of HARD_STRIP_ATTRIBUTES) {
        if (attr.value instanceof RegExp) {
            // RegExp は CSS セレクタで表現できないため、要素を直接走査
            element.querySelectorAll('*').forEach(elem => {
                if (isHardStripTarget(elem, [attr]) && !elementsToRemove.includes(elem)) {
                    elementsToRemove.push(elem);
                }
            });
        } else {
            const selector = buildAttributeSelector(attr);
            const attrElements = element.querySelectorAll(selector);
            attrElements.forEach(elem => {
                if (!elementsToRemove.includes(elem)) {
                    elementsToRemove.push(elem);
                }
            });
        }
    }

    // 削除実行
    for (const elem of elementsToRemove) {
        elem.remove();
        removedCount++;
    }

    return removedCount;
}

/**
 * 属性セレクタを構築するヘルパー関数
 * @param attr - 属性セレクタ情報
 * @returns CSS属性セレクタ文字列
 */
function buildAttributeSelector(attr: AttributeSelector): string {
    if (attr.value === undefined) {
        // 属性が存在する場合のみ
        return `[${attr.name}]`;
    } else {
        // 完全一致
        return `[${attr.name}="${attr.value}"]`;
    }
}

/**
 * DOMからKeyword Strip対象の要素を削除する
 * ID/クラス属性に指定されたキーワードを含む要素を削除
 * @param element - クレンジング対象のルート要素
 * @param keywords - 削除対象のキーワードリスト
 * @returns 削除された要素の数
 */
export function stripKeywordElements(element: Element, keywords: readonly string[]): number {
    if (!keywords || keywords.length === 0) {
        return 0;
    }

    const elementsToRemove = collectKeywordElements(element, keywords);

    for (const elem of elementsToRemove) {
        elem.remove();
    }

    return elementsToRemove.size;
}

/**
 * キーワードにマッチする要素を収集する（ID / class / data-* 属性を対象）
 * stripKeywordElements と countCleanseTargets の共通ロジック
 */
function collectKeywordElements(element: Element, keywords: readonly string[]): Set<Element> {
    const matched = new Set<Element>();
    // data-*スキャン用に全子要素を1回だけ取得（キーワードループ外で O(N) → O(K×N) を回避）
    const allElements = element.querySelectorAll('*');

    for (const keyword of keywords) {
        const kwLower = keyword.toLowerCase();
        const kw = escapeCssSelector(kwLower);

        element.querySelectorAll(`[id*="${kw}"]`).forEach(elem => matched.add(elem));
        element.querySelectorAll(`[class*="${kw}"]`).forEach(elem => matched.add(elem));

        for (const elem of allElements) {
            if (matched.has(elem)) continue;
            for (let i = 0; i < elem.attributes.length; i++) {
                const attr = elem.attributes[i];
                const attrNameLower = attr.name.toLowerCase();
                if (attrNameLower.startsWith('data-') && attrNameLower.includes(kwLower)) {
                    matched.add(elem);
                    break;
                }
            }
        }
    }

    return matched;
}

/**
 * DOMをクレンジングする（Hard Strip + Keyword Strip）
 * @param element - クレンジング対象のルート要素
 * @param options - クレンジングオプション
 * @returns クレンジング結果（削除数）
 */
export interface CleanseResult {
    hardStripRemoved: number;
    keywordStripRemoved: number;
    totalRemoved: number;
}

export interface CleanseOptions {
    hardStripEnabled?: boolean;
    keywordStripEnabled?: boolean;
    keywords?: string[];
}

/**
 * DOMのクレンジング対象要素数をカウントする（削除は行わない）
 * @param element - カウント対象のルート要素
 * @param options - クレンジングオプション
 * @returns カウント結果（削除数と同じ構造だがDOMは変更しない）
 */
export function countCleanseTargets(element: Element, options: CleanseOptions = {}): CleanseResult {
    const {
        hardStripEnabled = true,
        keywordStripEnabled = true,
        keywords = DEFAULT_KEYWORDS
    } = options;

    let hardStripCount = 0;
    let keywordStripCount = 0;

    if (hardStripEnabled) {
        // タグセレクタをCSSセレクタ文字列に変換
        const tagSelector = [...HARD_STRIP_TAGS].join(',');

        // タグに一致する要素をカウント
        if (tagSelector) {
            hardStripCount += element.querySelectorAll(tagSelector).length;
        }

        // 属性に一致する要素をカウント
        for (const attr of HARD_STRIP_ATTRIBUTES) {
            if (attr.value instanceof RegExp) {
                // RegExp は CSS セレクタで表現できないため、要素を直接走査
                // ここでは属性マッチのみをカウントし、タグマッチはタグセレクタ側で行われる
                element.querySelectorAll('*').forEach(elem => {
                    const attrValue = elem.getAttribute(attr.name);
                    if (attrValue && attr.value.test(attrValue)) {
                        hardStripCount++;
                    }
                });
            } else {
                const selector = buildAttributeSelector(attr);
                hardStripCount += element.querySelectorAll(selector).length;
            }
        }
    }

    if (keywordStripEnabled && keywords.length > 0) {
        keywordStripCount = collectKeywordElements(element, keywords).size;
    }

    return {
        hardStripRemoved: hardStripCount,
        keywordStripRemoved: keywordStripCount,
        totalRemoved: hardStripCount + keywordStripCount
    };
}

export function cleanseContent(element: Element, options: CleanseOptions = {}): CleanseResult {
    const {
        hardStripEnabled = true,
        keywordStripEnabled = true,
        keywords = DEFAULT_KEYWORDS
    } = options;

    let hardStripRemoved = 0;
    let keywordStripRemoved = 0;

    // Hard Strip
    if (hardStripEnabled) {
        hardStripRemoved = stripHardStripElements(element);
    }

    // Keyword Strip
    if (keywordStripEnabled && keywords.length > 0) {
        keywordStripRemoved = stripKeywordElements(element, keywords);
    }

    return {
        hardStripRemoved,
        keywordStripRemoved,
        totalRemoved: hardStripRemoved + keywordStripRemoved
    };
}