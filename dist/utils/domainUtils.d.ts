/**
 * domainUtils.ts
 * Utility functions for domain filtering with wildcard support.
 */
/**
 * Extract domain from URL, removing www subdomain
 * @param {string} url - The URL to extract domain from
 * @returns {string|null} - The extracted domain without www, or null if invalid
 */
export declare function extractDomain(url: string): string | null;
/**
 * Check if a domain matches a pattern (supports wildcards)
 * @param {string} domain - The domain to check
 * @param {string} pattern - The pattern to match against (supports wildcards)
 * @returns {boolean} - True if the domain matches the pattern
 */
export declare function matchesPattern(domain: string, pattern: string): boolean;
/**
 * Check if a domain is in a list (supports wildcards)
 * @param {string} domain - The domain to check
 * @param {string[]} domainList - The list of domains/patterns to check against
 * @returns {boolean} - True if the domain is in the list
 */
export declare function isDomainInList(domain: string, domainList: string[] | undefined): boolean;
/**
 * Validate domain format
 * @param {any} domain - The domain to validate
 * @returns {boolean} - True if the domain format is valid
 */
export declare function isValidDomain(domain: any): boolean;
/**
 * Check if a URL is allowed based on domain filter settings from storage.
 * @param {string} url - The URL to check
 * @returns {Promise<boolean>} - True if the URL is allowed
 */
export declare function isDomainAllowed(url: string): Promise<boolean>;
/**
 * Parse domain list from textarea content
 * @param {string} text - The textarea content (one domain per line)
 * @returns {string[]} - Array of valid domains
 */
export declare function parseDomainList(text: string): string[];
/**
 * Validate domain list and return errors
 * @param {string[]} domainList - The domain list to validate
 * @returns {string[]} - Array of error messages
 */
export declare function validateDomainList(domainList: string[]): string[];
//# sourceMappingURL=domainUtils.d.ts.map