/**
 * contentCleaner.ts
 * 【機能概要】: WebページのDOMから機密情報を含む可能性がある要素を削除する
 * 【設計方針】:
 *   - Hard Strip: タグ・属性ベースの強制削除
 *   - Keyword Strip: ID/クラス属性のキーワードベース削除
 *   - 外部ライブラリ不使用（バンドルサイズ抑止）
 * 🟢
 */

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
    'embed'
]);

/**
 * Hard Strip 用属性セレクタ
 * これらの属性に一致する要素を削除
 */
interface AttributeSelector {
    name: string;
    value?: string | RegExp;
}

const HARD_STRIP_ATTRIBUTES: AttributeSelector[] = [
    { name: 'type', value: 'password' },
    { name: 'type', value: 'hidden' },
    { name: 'autocomplete' }
];

/**
 * 要素がHard Strip対象かどうかを判定
 * @param element - 判定対象の要素
 * @returns trueの場合は削除対象
 */
function isHardStripTarget(element: Element): boolean {
    // タグ名で判定
    if (HARD_STRIP_TAGS.has(element.tagName.toLowerCase())) {
        return true;
    }

    // 属性で判定
    for (const attr of HARD_STRIP_ATTRIBUTES) {
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

    // TreeWalker で全要素を走査
    const walker = element.ownerDocument.createTreeWalker(
        element,
        NodeFilter.SHOW_ELEMENT,
        undefined
    );

    let node: Node | null = walker.nextNode();
    while (node) {
        const elem = node as Element;

        if (isHardStripTarget(elem)) {
            elementsToRemove.push(elem);
        }

        node = walker.nextNode();
    }

    // 削除実行
    for (const elem of elementsToRemove) {
        elem.remove();
        removedCount++;
    }

    return removedCount;
}

/**
 * DOMからKeyword Strip対象の要素を削除する
 * ID/クラス属性に指定されたキーワードを含む要素を削除
 * @param element - クレンジング対象のルート要素
 * @param keywords - 削除対象のキーワードリスト
 * @returns 削除された要素の数
 */
export function stripKeywordElements(element: Element, keywords: string[]): number {
    if (!keywords || keywords.length === 0) {
        return 0;
    }

    let removedCount = 0;
    const elementsToRemove: Element[] = [];

    // TreeWalker で全要素を走査
    const walker = element.ownerDocument.createTreeWalker(
        element,
        NodeFilter.SHOW_ELEMENT,
        undefined
    );

    let node: Node | null = walker.nextNode();
    while (node) {
        const elem = node as Element;

        // IDで判定
        const id = elem.id?.toLowerCase() || '';
        for (const keyword of keywords) {
            if (id.includes(keyword.toLowerCase())) {
                elementsToRemove.push(elem);
                break;
            }
        }

        // クラス名で判定（まだ削除リストにない場合のみ）
        if (!elementsToRemove.includes(elem)) {
            const classes = elem.className?.toLowerCase() || '';
            for (const keyword of keywords) {
                if (classes.includes(keyword.toLowerCase())) {
                    elementsToRemove.push(elem);
                    break;
                }
            }
        }

        node = walker.nextNode();
    }

    // 削除実行
    for (const elem of elementsToRemove) {
        elem.remove();
        removedCount++;
    }

    return removedCount;
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
        keywords = ['balance', 'account', 'meisai', 'login', 'card-number', 'keiyaku']
    } = options;

    let hardStripCount = 0;
    let keywordStripCount = 0;

    if (hardStripEnabled) {
        const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_ELEMENT, undefined);
        let node: Node | null = walker.nextNode();
        while (node) {
            if (isHardStripTarget(node as Element)) hardStripCount++;
            node = walker.nextNode();
        }
    }

    if (keywordStripEnabled && keywords.length > 0) {
        const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_ELEMENT, undefined);
        const counted = new Set<Element>();
        let node: Node | null = walker.nextNode();
        while (node) {
            const elem = node as Element;
            if (!counted.has(elem)) {
                const id = elem.id?.toLowerCase() || '';
                const classes = elem.className?.toLowerCase() || '';
                for (const keyword of keywords) {
                    const kw = keyword.toLowerCase();
                    if (id.includes(kw) || classes.includes(kw)) {
                        keywordStripCount++;
                        counted.add(elem);
                        break;
                    }
                }
            }
            node = walker.nextNode();
        }
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
        keywords = ['balance', 'account', 'meisai', 'login', 'card-number', 'keiyaku']
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