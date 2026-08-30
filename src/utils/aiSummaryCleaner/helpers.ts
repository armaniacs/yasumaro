/**
 * AI要約クレンジングヘルパー関数
 * セレクター生成・要素判定ユーティリティ
 */

import { escapeCssSelector } from '../cssUtils.js';
import { getLowerClassName } from '../elementClassName.js';
import { isBodyProtected } from './bodyProtection.js';
import { I18N_AD_TEXT_PATTERNS, I18N_SOCIAL_TEXT_PATTERNS } from './patterns.js';

/**
 * 要素を削除する前に本文保護チェックを行う
 * 本文と判定された要素は削除せずfalseを返す
 * @param element 削除対象の要素
 * @returns 削除に成功したかどうか（本文保護によりスキップされた場合はfalse）
 */
export function safeRemoveElement(element: Element): boolean {
    if (isBodyProtected(element)) {
        return false;  // 本文保護: 削除しない
    }
    element.remove();
    return true;
}

/**
 * 要素をテキストノードに差し替える（本文保護チェック付き）
 * アフィリエイト要素や吹き出しなど、要素自体はノイズだが中のテキストは保持したい場合に使用
 * @param element 差し替え対象の要素
 * @param text 差し替え後のテキスト
 * @returns 差し替えに成功したかどうか（本文保護によりスキップされた場合はfalse）
 */
export function safeReplaceWithText(element: Element, text: string): boolean {
    if (isBodyProtected(element)) {
        return false;
    }
    const textNode = document.createTextNode(text);
    element.replaceWith(textNode);
    return true;
}

/**
 * パターン配列から [class*="..."], [id*="..."] を結合したCSSセレクター文字列を生成する
 */
export function buildClassIdSelectors(patterns: string[]): string {
    return patterns.map(p => {
        const kw = escapeCssSelector(p.toLowerCase());
        return `[class*="${kw}"], [id*="${kw}"]`;
    }).join(', ');
}

/**
 * 要素がposition: fixed/stickyかを判定
 */
export function isFixedOrSticky(elem: Element): boolean {
    const style = elem.getAttribute('style') || '';
    return style.includes('position: fixed') || style.includes('position:fixed') ||
           style.includes('position: sticky') || style.includes('position:sticky');
}

/**
 * 要素が広告かどうかを判定
 * 「 ad 」は単語境界レベルでマッチし、header/loaded 等の誤マッチを防ぐ
 */
export function isLikelyAd(elem: Element): boolean {
    const className = getLowerClassName(elem);
    const id = (elem.id || '').toLowerCase();
    const rawText = elem.textContent || '';
    const text = rawText.toLowerCase();
    // \bはハイフンを認識しないため、CSSクラス向けに (^|[-_\s])ad([-_\s]|$) を使用
    const AD_WORD_RE = /(^|[-_\s])ad([-_\s]|$)/;
    if (AD_WORD_RE.test(className) || AD_WORD_RE.test(id)) return true;
    if (text.includes('sponsored') || text.includes('promoted') || text.includes('advertise')) return true;
    // i18n広告テキストパターン（テキストマッチ — クラス誤爆を避けるため RegExp[] で判定）
    if (I18N_AD_TEXT_PATTERNS.some((re) => re.test(rawText))) return true;
    return false;
}

/**
 * 要素がソーシャル/共有かどうかを判定 — 決定木化（M7 mitigation）
 * 1) i18nテキストパターン
 * 2) テキスト内容 "Share on X" など英語パターン
 * 3) aria-label 判定（Share on X / social/share/follow 単語境界）
 * 4) クラス/ID 単語境界判定（social/share + x-share/x-follow/x-button 具体化パターン）
 */
export function isLikelySocial(elem: Element): boolean {
    const rawText = elem.textContent || '';
    if (I18N_SOCIAL_TEXT_PATTERNS.some((re) => re.test(rawText))) return true;

    // 英語圏 "Share on X" / "Follow on X" 系テキスト — 精度の高いシグナル
    const SHARE_ON_X_RE = /share on (x|twitter|facebook|linkedin|instagram)/i;
    const FOLLOW_ON_RE = /follow (us )?on (x|twitter|facebook|instagram|youtube|tiktok)/i;
    if (SHARE_ON_X_RE.test(rawText) || FOLLOW_ON_RE.test(rawText)) return true;

    // aria-label 決定木 — getAttribute のみで完結
    const ariaLabelRaw = elem.getAttribute('aria-label') || '';
    const ariaLabel = ariaLabelRaw.toLowerCase();
    if (ariaLabel) {
        if (SHARE_ON_X_RE.test(ariaLabelRaw) || FOLLOW_ON_RE.test(ariaLabelRaw)) return true;
        // 単語境界で social/share/follow を判定（\b はハイフンを跨がないため (^|[-_\s]) を使用）
        const SOCIAL_ARIA_WORD_RE = /(^|[-_\s])(social|share|follow)([-_\s]|$)/;
        if (SOCIAL_ARIA_WORD_RE.test(ariaLabel)) return true;
    }

    const className = getLowerClassName(elem);
    const id = (elem.id || '').toLowerCase();

    // M7: x- 単独は誤爆するため x-share/x-follow/x-button のみを単語境界で判定
    const X_SOCIAL_RE = /(^|[-_\s])x-(share|follow|button)([-_\s]|$)/;
    if (X_SOCIAL_RE.test(className) || X_SOCIAL_RE.test(id)) return true;

    // social/share は単語境界で判定（share-buttons 等は ^share + - でヒット）
    const SOCIAL_WORD_RE = /(^|[-_\s])(social|share)([-_\s]|$)/;
    if (SOCIAL_WORD_RE.test(className) || SOCIAL_WORD_RE.test(id)) return true;

    // 短縮系 fb-/tw-/ig- （X以外のSNS短縮）は前方境界で判定
    const SHORT_SOCIAL_RE = /(^|[-_\s])(fb|tw|ig)-/;
    if (SHORT_SOCIAL_RE.test(className) || SHORT_SOCIAL_RE.test(id)) return true;

    // フルプラットフォーム名は単語境界で判定
    const PLATFORM_RE = /(^|[-_\s])(facebook|twitter|linkedin|instagram|youtube|tiktok|pinterest)([-_\s]|$)/;
    if (PLATFORM_RE.test(className) || PLATFORM_RE.test(id)) return true;

    return false;
}

/**
 * 要素がポップアップかどうかを判定
 */
export function isLikelyPopup(elem: Element): boolean {
    const className = getLowerClassName(elem);
    const id = (elem.id || '').toLowerCase();
    const style = elem.getAttribute('style') || '';
    return className.includes('popup') || className.includes('modal') ||
           className.includes('overlay') || className.includes('cookie') ||
           className.includes('consent') || className.includes('banner') ||
           id.includes('popup') || id.includes('modal') ||
           (style.includes('position: fixed') && className.length < 50);
}

/**
 * 30-03: Shadow DOM / iframe を再帰的に走査して selector にマッチする要素を集める。
 * - open shadowRoot のみ対象（closed は element.shadowRoot が null で走査不可、仕様としてスキップ）
 * - iframe は same-origin のみ対象、cross-origin は SecurityError を try-catch でスキップ
 * - 再帰: 各要素の shadowRoot / iframe.contentDocument を深掘り
 */
export function querySelectorAllDeep(
    root: Element | Document | ShadowRoot | DocumentFragment,
    selector: string,
): Element[] {
    const result: Element[] = [];

    // 1) Light DOM — root 直下の querySelectorAll
    try {
        const nodeList = (root as Element).querySelectorAll?.(selector);
        if (nodeList) {
            result.push(...Array.from(nodeList) as Element[]);
        }
    } catch {
        // invalid selector 等は無視
    }

    // 2) 子要素を列挙して shadowRoot / iframe を再帰
    let children: Element[] = [];
    try {
        const all = (root as Element).querySelectorAll?.('*');
        if (all) children = Array.from(all) as Element[];
        else if ((root as unknown as { children?: HTMLCollection }).children) {
            children = Array.from((root as unknown as { children: HTMLCollection }).children) as Element[];
        }
    } catch {
        children = [];
    }

    for (const el of children) {
        // shadowRoot（open のみ）
        const shadow = (el as unknown as { shadowRoot?: ShadowRoot | null }).shadowRoot;
        if (shadow) {
            try {
                result.push(...querySelectorAllDeep(shadow, selector));
            } catch {}
        }
        // iframe same-origin
        if (el.tagName?.toLowerCase() === 'iframe') {
            try {
                const iframe = el as HTMLIFrameElement;
                const doc = iframe.contentDocument;
                if (doc) {
                    // iframe 内の document 全体を再帰
                    result.push(...querySelectorAllDeep(doc as unknown as Element, selector));
                    // documentElement 直下も含めるため documentElement でも再帰（重複は許容、呼び出し元で Set 化可能）
                    if (doc.documentElement) {
                        // querySelectorAllDeep(doc.documentElement) は doc 側で既にカバーされるが、
                        // iframe 内の shadowRoot を確実に拾うため両方走査
                    }
                }
            } catch {
                // cross-origin は SecurityError → スキップ
            }
        }
    }

    return result;
}

/**
 * エイリアス: 旧 spec で言及された collectElementsDeep としても利用可能
 */
export const collectElementsDeep = querySelectorAllDeep;

/**
 * 要素がプラットフォームノイズかどうかを判定 — 決定木化
 * 「 ad 」は単語境界、comment/related は単語境界+aria-label で誤爆を抑止
 */
export function isPlatformNoise(elem: Element): boolean {
    const className = getLowerClassName(elem);
    const id = (elem.id || '').toLowerCase();
    // \bはハイフンを認識しないため、CSSクラス向けに (^|[-_\s])ad([-_\s]|$) を使用
    const AD_WORD_RE = /(^|[-_\s])ad([-_\s]|$)/;
    if (AD_WORD_RE.test(className) || AD_WORD_RE.test(id)) return true;

    // comment/related/youtube は単語境界で判定（comments 複数形も許容）— 既存 isPlatformNoise セマンティクスを単語境界で横展開
    const COMMENT_RE = /(^|[-_\s])comments?([-_\s]|$)/;
    const RELATED_RE = /(^|[-_\s])related([-_\s]|$)/;
    const YOUTUBE_RE = /(^|[-_\s])youtube([-_\s]|$)/;

    // 既存: className は youtube + comment 同居でノイズ（両シグナル必要）
    if (COMMENT_RE.test(className) && YOUTUBE_RE.test(className)) return true;

    // 既存: id 単独の comment/related はノイズ — 単語境界で横展開（comments 複数形許容）
    if (COMMENT_RE.test(id) || RELATED_RE.test(id)) return true;

    // 決定木追加: aria-label でも判定（getAttribute のみ、TreeWalker 不使用）
    const ariaLabel = (elem.getAttribute('aria-label') || '').toLowerCase();
    if (ariaLabel && (COMMENT_RE.test(ariaLabel) || RELATED_RE.test(ariaLabel))) return true;

    return false;
}