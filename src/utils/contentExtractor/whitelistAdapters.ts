/**
 * Domain Whitelist Extraction — サイト別ホワイトリスト抽出アダプタ定義
 * ノイズ比率が極端に高いサイト向けに、特定クラスの中身だけを狙い撃ちで抽出する
 */

export interface WhitelistAdapter {
    /** アダプタ識別名（ログ・デバッグ用） */
    name: string;
    /** hostname完全一致またはサフィックス一致で判定。空配列は「ドメイン判定なし」を意味する */
    domains: string[];
    /** このセレクタがDOM上に1件でも存在すればアダプタを適用（ドメイン不一致でも発火） */
    detectSelector: string;
    /** 抽出対象のクラス/ID（複数要素をDOM出現順に結合） */
    contentSelectors: string[];
    /** contentSelectors内でさらに除外したい要素（メタ情報等） */
    excludeSelectors?: string[];
}

export const WHITELIST_ADAPTERS: WhitelistAdapter[] = [
    {
        name: 'togetter',
        domains: ['togetter.com'],
        detectSelector: '.tweet_body',
        contentSelectors: ['.tweet_body', '.item_text'],
    },
    {
        name: '5ch-matome',
        domains: [],
        detectSelector: '.t_b, .res, .reply_body',
        contentSelectors: ['.t_b', '.res', '.reply_body'],
    },
    {
        name: 'girlschannel',
        domains: ['girlschannel.net'],
        detectSelector: '.comment-body',
        contentSelectors: ['.comment-body'],
    },
    {
        name: 'chiebukuro',
        domains: ['chiebukuro.yahoo.co.jp'],
        detectSelector: '[class*="Chie-ItemAnswer"]',
        contentSelectors: ['[class*="Chie-Item"]', '[class*="Chie-ItemAnswer"]'],
    },
    {
        name: 'novel-site',
        domains: ['syosetu.com', 'kakuyomu.jp'],
        detectSelector: '#novel_honbun',
        contentSelectors: ['#novel_honbun'],
    },
    {
        name: 'recipe-site',
        domains: ['cookpad.com', 'kurashiru.com'],
        detectSelector: '.ingredient',
        contentSelectors: ['.ingredient', '.step'],
    },
];

/**
 * hostnameが対象ドメインに一致するか判定（完全一致またはサブドメイン一致）
 */
function matchesDomain(hostname: string, domains: string[]): boolean {
    return domains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
}

/**
 * hostnameとDOM構造から適用すべきホワイトリストアダプタを判定する
 * 1. domainsに一致するアダプタがあれば即座に返す
 * 2. なければ、detectSelectorがDOM上に存在するアダプタを探して返す
 * 3. どちらもなければ null（ホワイトリストモードを発動しない）
 * @param hostname - location.hostname
 * @param root - 検索対象のルート要素（通常は document.body）
 * @returns 一致したアダプタ、または null
 */
export function matchWhitelistAdapter(hostname: string, root: Element): WhitelistAdapter | null {
    for (const adapter of WHITELIST_ADAPTERS) {
        if (adapter.domains.length > 0 && matchesDomain(hostname, adapter.domains)) {
            return adapter;
        }
    }

    for (const adapter of WHITELIST_ADAPTERS) {
        if (root.querySelector(adapter.detectSelector)) {
            return adapter;
        }
    }

    return null;
}

/**
 * @username 形式のメンション表記を除去する正規表現
 */
const USERNAME_MENTION_PATTERN = /@[A-Za-z0-9_]+/g;

/**
 * RT(数字) 形式のリツイート数表記を除去する正規表現
 */
const RETWEET_COUNT_PATTERN = /RT\(\d+\)/g;

/**
 * 抽出後テキストからメタデータ文字列（メンション・リツイート数）を除去する
 */
function stripExtractionMetadata(text: string): string {
    return text
        .replace(USERNAME_MENTION_PATTERN, '')
        .replace(RETWEET_COUNT_PATTERN, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * ホワイトリストアダプタに従い、contentSelectorsにマッチする要素のテキストを
 * DOM出現順に結合して抽出する
 * @param root - 抽出対象のルート要素（通常は document.body）
 * @param adapter - 適用するアダプタ
 * @returns 抽出・整形されたテキスト。1件もマッチしなければ空文字列
 */
export function extractWhitelistedContent(root: Element, adapter: WhitelistAdapter): string {
    const selector = adapter.contentSelectors.join(', ');
    const elements = root.querySelectorAll(selector);

    if (elements.length === 0) {
        return '';
    }

    const parts: string[] = [];
    elements.forEach(elem => {
        const text = (elem.textContent || '').trim();
        if (text) {
            parts.push(stripExtractionMetadata(text));
        }
    });

    return parts.filter(p => p.length > 0).join('\n\n');
}
