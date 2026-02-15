/**
 * ublockParser/constants.ts
 * uBlock Origin形式フィルターパーサーの定数定義
 *
 * 【機能概要】: パーサーで使用するすべての定数を集約
 * 🟢 信頼性レベル: plan/UII/02-phase2-parser.md および plan/UII/10-data-structures.md に基づく実装
 */
/** 【キャッシュ定数】: パーサーキャッシュの設定 🟢 */
export declare const CACHE_CONFIG: {
    /** キャッシュの最大サイズ */
    readonly MAX_SIZE: 100;
    /** LRUキャッシュの最大エントリ数 */
    readonly LRU_MAX_ENTRIES: 50;
};
export declare const CLEANUP_INTERVAL = 300000;
/** 【正規表現定数】: uBlock形式の基本パターンマッチング 🟢 */
export declare const PATTERNS: {
    /** `||` プレフィックス検出 */
    readonly RULE_PREFIX: RegExp;
    /** `^` サフィックス検出（行末） */
    readonly RULE_SUFFIX: RegExp;
    /** 空行検出（空白のみ含む） */
    readonly EMPTY_LINE: RegExp;
    /** `!` コメントプレフィックス検出 */
    readonly COMMENT_PREFIX: RegExp;
    /** `#` コメントプレフィックス検出（hosts形式） */
    readonly HOSTS_COMMENT_PREFIX: RegExp;
    /** hosts形式検出: IPアドレス（IPv4/IPv6、ゾーンID付きIPv6を含む）で始まる行 */
    readonly HOSTS_FORMAT: RegExp;
    /** ドメイン形式検証（アンダースコアを許可） */
    readonly DOMAIN_VALIDATION: RegExp;
};
/** 【ルールタイプ定数】: ルールの種類を表す文字列定数 🟢 */
export declare const RULE_TYPES: {
    /** ドメインをブロックするルール */
    readonly BLOCK: "block";
    /** ブロックの例外として許可するルール */
    readonly EXCEPTION: "exception";
    /** 無視するルール（hostsファイルのlocalhost定義など） */
    readonly IGNORE: "ignore";
};
export type RuleType = typeof RULE_TYPES[keyof typeof RULE_TYPES];
/** 【オプション種別定数】: uBlock形式のオプション識別子 🟢 */
export declare const OPTION_TYPES: {
    /** ドメイン指定プレフィックス `domain=` */
    readonly DOMAIN_PREFIX: "domain=";
    /** サードパーティフラグ `3p` */
    readonly THIRD_PARTY: "3p";
    /** ファーストパーティフラグ `1p` */
    readonly FIRST_PARTY: "1p";
    /** 重要フラグ `important` */
    readonly IMPORTANT: "important";
    /** 重要フラグ解除 `~important` */
    readonly NOT_IMPORTANT: "~important";
    /** 大文字小文字を区別する `match-case` */
    readonly MATCH_CASE: "match-case";
    /** 大文字小文字を区別しない `~match-case` */
    readonly NOT_MATCH_CASE: "~match-case";
    /** 除外ドメインプレフィックス */
    readonly EXCLUDE_DOMAIN_PREFIX: "~";
    /** ドメイン区切り記号 */
    readonly DOMAIN_SEPARATOR: "|";
    /** オプション区切り記号 */
    readonly OPTION_SEPARATOR: ",";
};
/** 【プレフィックス定数】: uBlock形式のプレフィックス 🟢 */
export declare const PREFIXES: {
    /** ルールプレフィックス */
    readonly RULE: "||";
    /** 例外ルールプレフィックス */
    readonly EXCEPTION: "@@||";
    /** サフィックス */
    readonly SUFFIX: "^";
    /** オプション開始 */
    readonly OPTION: "$";
};
/** 【メタデータ定数】: デフォルトのメタデータ値 🟢 */
export declare const DEFAULT_METADATA: {
    /** デフォルトデータソース */
    readonly SOURCE: "paste";
};
/** 【ルールID定数】: null/undefined入力時に返す固定ID 🟡 */
export declare const NULL_RULE_ID = "00000000-0000-0000-0000-000000000000";
//# sourceMappingURL=constants.d.ts.map