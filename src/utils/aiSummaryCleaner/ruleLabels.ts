/**
 * クレンジングルールの表示ラベル
 *
 * Maps each rule key to its i18n message key and a Japanese fallback, derived
 * from CLEANSING_RULES so a new rule cannot be added without a label. The
 * previous hand-written map covered only 6 of the 32 rules, so a reason such
 * as 'popup' reached the UI as a raw English key.
 */

import { CLEANSING_RULES } from './rules.js';

/** Japanese fallbacks, used when the i18n message is unavailable. */
const RULE_LABEL_FALLBACKS: Record<string, string> = {
    alt: '画像alt属性',
    metadata: 'メタデータ',
    ads: '広告',
    nav: 'ナビゲーション',
    social: 'ソーシャル',
    deep: 'ディープ',
    jsonLd: 'JSON-LD',
    lazyLoad: '遅延読み込み',
    skipLink: 'スキップリンク',
    card: 'カード型要素',
    linkDensity: 'リンク密度',
    fixed: '固定要素',
    recommend: 'おすすめ',
    pagination: 'ページネーション',
    snsPromo: 'SNSプロモ',
    popup: 'ポップアップ',
    platform: 'プラットフォームノイズ',
    textDensity: 'テキスト密度',
    shortSeq: '短文の連続',
    symbolLine: '記号行',
    linkPara: 'リンクのみ段落',
    enhancedHidden: '非表示要素',
    emptyElem: '空要素',
    jpLayout: 'JPレイアウト',
    jpNavigation: 'JPナビゲーション',
    author: '執筆者情報',
    affiliate: 'アフィリエイト',
    speechBubble: '吹き出し',
    newsMedia: 'ニュースメディア',
    ecSite: 'EC・通販',
    qaSite: 'Q&A',
    videoSite: '動画プラットフォーム',
};

/** `alt` -> `historyAiSummaryCleansedReasonAlt` */
export function ruleMessageKey(ruleKey: string): string {
    return `historyAiSummaryCleansedReason${ruleKey.charAt(0).toUpperCase()}${ruleKey.slice(1)}`;
}

/** Japanese fallback label for a rule key, or the key itself when unknown. */
export function ruleLabelFallback(ruleKey: string): string {
    return RULE_LABEL_FALLBACKS[ruleKey] ?? ruleKey;
}

/**
 * Builds the label map for display.
 *
 * @param getMessage - i18n lookup; returning an empty string falls back.
 */
export function buildRuleLabelMap(getMessage: (key: string) => string): Record<string, string> {
    const map: Record<string, string> = {};
    for (const rule of CLEANSING_RULES) {
        map[rule.key] = getMessage(ruleMessageKey(rule.key)) || ruleLabelFallback(rule.key);
    }
    return map;
}
