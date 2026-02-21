export interface PendingPage {
    url: string;
    title: string;
    timestamp: number;
    reason: 'cache-control' | 'set-cookie' | 'authorization';
    headerValue: string;
    expiry: number;
}
/**
 * Adds a pending page to storage if it doesn't already exist.
 * @param page - The PendingPage object to add.
 * @returns Promise that resolves when the operation is complete.
 */
export declare function addPendingPage(page: PendingPage): Promise<void>;
/**
 * Retrieves all non-expired pending pages from storage.
 * @returns Promise resolving to an array of PendingPage objects that have not expired.
 */
export declare function getPendingPages(): Promise<PendingPage[]>;
/**
 * Removes pending pages with matching URLs from storage.
 * @param urls - Array of URLs to remove from pending pages.
 * @returns Promise that resolves when the operation is complete.
 */
export declare function removePendingPages(urls: string[]): Promise<void>;
/**
 * Removes all expired pending pages from storage.
 * @returns Promise that resolves when the operation is complete.
 */
export declare function clearExpiredPages(): Promise<void>;
//# sourceMappingURL=pendingStorage.d.ts.map