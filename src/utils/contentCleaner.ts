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
 * CSSセレクタで使用する文字列をエスケープする
 * CSS.escape()が利用可能な場合はそれを使用し、そうでない場合はフォールバック実装を使用
 * @param str - エスケープ対象の文字列
 * @returns エスケープされた文字列
 */
function escapeCssSelector(str: string): string {
    // CSS.escape()が利用可能な場合はそれを使用（モダンブラウザ）
    if (typeof CSS !== 'undefined' && CSS.escape) {
        return CSS.escape(str);
    }
    
    // フォールバック: CSS識別子のルールに従ってエスケープ
    // CSS識別子は [a-zA-Z0-9] と ISO 10646 U+00A0 以上、ハイフン(-)、アンダースコア(_) のみを含むことができる
    // それ以外の文字はバックスラッシュでエスケープする必要がある
    return str.replace(/([^a-zA-Z0-9_-])/g, '\\$1');
}

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
interface AttributeSelector {
    name: string;
    value?: string | RegExp;
}

const HARD_STRIP_ATTRIBUTES: AttributeSelector[] = [
    { name: 'type', value: 'password' },
    { name: 'type', value: 'hidden' },
    { name: 'type', value: 'file' },
    { name: 'type', value: 'email' },
    { name: 'type', value: 'tel' },
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

    // タグセレクタをCSSセレクタ文字列に変換
    const tagSelector = Array.from(HARD_STRIP_TAGS).join(',');

    // タグに一致する要素を取得
    if (tagSelector) {
        const tagElements = element.querySelectorAll(tagSelector);
        tagElements.forEach(elem => elementsToRemove.push(elem));
    }

    // 属性に一致する要素を取得
    for (const attr of HARD_STRIP_ATTRIBUTES) {
        const selector = buildAttributeSelector(attr);
        const attrElements = element.querySelectorAll(selector);
        attrElements.forEach(elem => {
            if (!elementsToRemove.includes(elem)) {
                elementsToRemove.push(elem);
            }
        });
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
export function stripKeywordElements(element: Element, keywords: string[]): number {
    if (!keywords || keywords.length === 0) {
        return 0;
    }

    let removedCount = 0;
    const elementsToRemove: Element[] = [];

    // キーワードごとにIDとクラスをチェック
    for (const keyword of keywords) {
        const kw = escapeCssSelector(keyword.toLowerCase());

        // IDにキーワードを含む要素を取得
        const idSelector = `[id*="${kw}"]`;
        const idElements = element.querySelectorAll(idSelector);
        idElements.forEach(elem => {
            if (!elementsToRemove.includes(elem)) {
                elementsToRemove.push(elem);
            }
        });

        // クラスにキーワードを含む要素を取得
        const classSelector = `[class*="${kw}"]`;
        const classElements = element.querySelectorAll(classSelector);
        classElements.forEach(elem => {
            if (!elementsToRemove.includes(elem)) {
                elementsToRemove.push(elem);
            }
        });
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
        // タグセレクタをCSSセレクタ文字列に変換
        const tagSelector = Array.from(HARD_STRIP_TAGS).join(',');

        // タグに一致する要素をカウント
        if (tagSelector) {
            hardStripCount += element.querySelectorAll(tagSelector).length;
        }

        // 属性に一致する要素をカウント
        for (const attr of HARD_STRIP_ATTRIBUTES) {
            const selector = buildAttributeSelector(attr);
            hardStripCount += element.querySelectorAll(selector).length;
        }
    }

    if (keywordStripEnabled && keywords.length > 0) {
        const counted = new Set<Element>();

        // キーワードごとにIDとクラスをチェック
        for (const keyword of keywords) {
            const kw = escapeCssSelector(keyword.toLowerCase());

            // IDにキーワードを含む要素をカウント
            const idSelector = `[id*="${kw}"]`;
            const idElements = element.querySelectorAll(idSelector);
            idElements.forEach(elem => {
                if (!counted.has(elem)) {
                    keywordStripCount++;
                    counted.add(elem);
                }
            });

            // クラスにキーワードを含む要素をカウント
            const classSelector = `[class*="${kw}"]`;
            const classElements = element.querySelectorAll(classSelector);
            classElements.forEach(elem => {
                if (!counted.has(elem)) {
                    keywordStripCount++;
                    counted.add(elem);
                }
            });
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