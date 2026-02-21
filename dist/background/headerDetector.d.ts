export declare class HeaderDetector {
    /**
     * webRequest.onHeadersReceivedリスナーを初期化する
     */
    static initialize(): void;
    /**
     * HTTPレスポンスヘッダーを受信した際の処理
     */
    private static onHeadersReceived;
    /**
     * URL正規化（キャッシュキーの一貫性のため）
     * - 末尾のスラッシュを削除
     * - フラグメント（#...）を削除
     */
    private static normalizeUrl;
    /**
     * プライバシー情報をキャッシュに保存する
     * キャッシュサイズが上限を超えたら最も古いエントリを削除
     */
    private static cachePrivacyInfo;
    /**
     * 最も古いキャッシュエントリを削除する（LRU実装）
     */
    private static evictOldestEntry;
}
//# sourceMappingURL=headerDetector.d.ts.map