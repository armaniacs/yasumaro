/**
 * domainUtils.js
 * Utility functions for domain filtering with wildcard support.
 */

import { getSettings, StorageKeys } from './storage.js';
import { isUrlBlocked } from './ublockMatcher.js';

/**
 * Check if ublockRules object has any rules (supports both old and new formats)
 * @param {Object} ublockRules - The uBlock rules object
 * @returns {boolean} - True if there are any rules
 */
function hasUblockRules(ublockRules) {
    // New format: blockDomains/exceptionDomains (arrays)
    const hasBlockDomains = Array.isArray(ublockRules.blockDomains) && ublockRules.blockDomains.length > 0;
    const hasExceptionDomains = Array.isArray(ublockRules.exceptionDomains) && ublockRules.exceptionDomains.length > 0;

    // Old format: blockRules/exceptionRules (object arrays)
    const hasBlockRules = Array.isArray(ublockRules.blockRules) && ublockRules.blockRules.length > 0;
    const hasExceptionRules = Array.isArray(ublockRules.exceptionRules) && ublockRules.exceptionRules.length > 0;

    return hasBlockDomains || hasExceptionDomains || hasBlockRules || hasExceptionRules;
}

/**
 * Extract domain from URL, removing www subdomain
 * @param {string} url - The URL to extract domain from
 * @returns {string|null} - The extracted domain without www, or null if invalid
 */
export function extractDomain(url) {
    try {
        const urlObj = new URL(url);
        let hostname = urlObj.hostname;

        // Remove www. prefix if present
        if (hostname.startsWith('www.')) {
            hostname = hostname.substring(4);
        }

        return hostname;
    } catch (e) {
        return null;
    }
}

/**
 * Check if a domain matches a pattern (supports wildcards)
 * @param {string} domain - The domain to check
 * @param {string} pattern - The pattern to match against (supports wildcards)
 * @returns {boolean} - True if the domain matches the pattern
 */
export function matchesPattern(domain, pattern) {
    // Convert wildcard pattern to regex
    if (pattern.includes('*')) {
        // 【Code Review #3】: 全ての正規表現特殊文字をエスケープしてからワイルドカードを処理
        const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // ワイルドカード（\*）を .* に変換
        const regexPattern = escaped.replace(/\\\*/g, '.*');
        const regex = new RegExp(`^${regexPattern}$`, 'i');
        return regex.test(domain);
    }

    // Exact match (case insensitive)
    return domain.toLowerCase() === pattern.toLowerCase();
}

/**
 * Check if a domain is in a list (supports wildcards)
 * @param {string} domain - The domain to check
 * @param {Array<string>} domainList - The list of domains/patterns to check against
 * @returns {boolean} - True if the domain is in the list
 */
export function isDomainInList(domain, domainList) {
    if (!domainList || domainList.length === 0) {
        return false;
    }

    return domainList.some(pattern => matchesPattern(domain, pattern));
}

/**
 * Validate domain format
 * @param {string} domain - The domain to validate
 * @returns {boolean} - True if the domain format is valid
 */
export function isValidDomain(domain) {
    if (!domain || typeof domain !== 'string') {
        return false;
    }

    // Basic domain validation
    const domainPattern = /^(\*\.)*[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

    // Check if it's a valid domain or wildcard pattern
    return domainPattern.test(domain);
}

/**
 * Check if a URL is allowed based on domain filter settings from storage.
 * @param {string} url - The URL to check
 * @returns {Promise<boolean>} - True if the URL is allowed
 */
export async function isDomainAllowed(url) {
    const settings = await getSettings();
    const mode = settings[StorageKeys.DOMAIN_FILTER_MODE];

    if (mode === 'disabled') {
        return true;
    }

    const domain = extractDomain(url);
    if (!domain) {
        return false;
    }

    // Simple Domain Filter
    let simpleResult = true;
    const simpleEnabled = settings[StorageKeys.SIMPLE_FORMAT_ENABLED] !== false;

    if (simpleEnabled) {
        const storedWhitelist = settings[StorageKeys.DOMAIN_WHITELIST] || [];
        const storedBlacklist = settings[StorageKeys.DOMAIN_BLACKLIST] || [];

        if (mode === 'whitelist') {
            simpleResult = isDomainInList(domain, storedWhitelist);
        } else if (mode === 'blacklist') {
            simpleResult = !isDomainInList(domain, storedBlacklist);
        }
    }

    // uBlock Filter
    const ublockEnabled = settings[StorageKeys.UBLOCK_FORMAT_ENABLED] === true;
    let ublockBlocked = false;

    if (ublockEnabled) {
        const ublockRules = settings[StorageKeys.UBLOCK_RULES];


        if (ublockRules && hasUblockRules(ublockRules)) {
            ublockBlocked = await isUrlBlocked(url, ublockRules, {});

        }
    }

    return simpleResult && !ublockBlocked;
}

/**
 * Parse domain list from textarea content
 * @param {string} text - The textarea content (one domain per line)
 * @returns {Array<string>} - Array of valid domains
 */
export function parseDomainList(text) {
    if (!text) {
        return [];
    }

    return text
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);
}

/**
 * Validate domain list and return errors
 * @param {Array<string>} domainList - The domain list to validate
 * @returns {Array<string>} - Array of error messages
 */
export function validateDomainList(domainList) {
    const errors = [];

    if (!Array.isArray(domainList)) {
        errors.push('ドメインリストが不正な形式です');
        return errors;
    }

    domainList.forEach((domain, index) => {
        if (!isValidDomain(domain)) {
            errors.push(`${index + 1}行目: "${domain}" は無効なドメイン形式です`);
        }
    });

    return errors;
}