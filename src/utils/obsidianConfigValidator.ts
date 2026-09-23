/**
 * obsidianConfigValidator.ts
 * Pure validation functions extracted from ObsidianClient.
 * These functions have no dependency on the ObsidianClient class.
 */

import { MAX_BODY_SIZE as LIMIT_MAX_BODY_SIZE } from '../messaging/limits.js';
import { LogType } from './logger/types.js';
import { addLog } from './logger/core.js';
import { readBodyCapped } from './readBodyCapped.js';

/** Protocol type used by Obsidian Local REST API. */
export type ObsidianProtocol = 'http' | 'https';

const MIN_PORT = 1;
const MAX_PORT = 65535;
const DEFAULT_PORT = '27124';
const DEFAULT_HOST = '127.0.0.1';

/**
 * PBI-11: Response body read timeout (response.text()).
 * Prevents hangs when headers are received but body never arrives.
 */
const READ_TIMEOUT_MS = 15000;

/**
 * Returns true for loopback hosts where plaintext HTTP carries no LAN risk.
 */
export function isLoopbackHost(host: string): boolean {
    const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
    return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}

/**
 * Validate and normalize the Obsidian protocol setting.
 * @param protocol - Raw protocol value from settings
 * @param host - Raw host value (used to escalate non-loopback HTTP to an error)
 * @returns Normalized protocol ('http' or 'https')
 * @throws Error if protocol is a non-empty string that is not 'http' or 'https',
 *   or if plaintext HTTP targets a non-loopback host
 */
export function validateObsidianProtocol(protocol: string | undefined | null, host?: string | undefined | null): ObsidianProtocol {
    if (protocol === undefined || protocol === null || protocol === '') {
        return 'https';
    }

    if (typeof protocol !== 'string') {
        return 'https';
    }

    const normalized = protocol.trim().toLowerCase();
    if (normalized !== 'http' && normalized !== 'https') {
        throw new Error('Protocol must be "http" or "https".');
    }

    if (normalized === 'http') {
        const hostValue = typeof host === 'string' && host.trim() !== '' ? host : DEFAULT_HOST;
        if (!isLoopbackHost(hostValue)) {
            throw new Error(`Plaintext HTTP to non-loopback host "${hostValue}" is blocked. Use HTTPS or a loopback address.`);
        }
        addLog(LogType.WARN, 'HTTP protocol selected — API key and data will be sent in plaintext over the local network. Use HTTPS for encrypted communication.', {
            protocol: normalized
        });
    }

    return normalized;
}

/**
 * Validate and normalize the Obsidian host setting.
 * IPv6 addresses are wrapped in brackets for correct URL assembly.
 *
 * Accepts loopback names, IPv4 literals, IPv6 literals, and valid RFC-1123
 * DNS hostnames. Remote (non-loopback) https vaults are legitimate, so the
 * check is syntactic rather than a loopback allowlist.
 * @param host - Raw host value from settings
 * @returns Normalized host string
 * @throws Error if host contains invalid characters or is malformed
 */
export function validateObsidianHost(host: string | undefined | null): string {
    if (host === undefined || host === null || host === '') {
        return DEFAULT_HOST;
    }

    if (typeof host !== 'string') {
        return DEFAULT_HOST;
    }

    const trimmed = host.trim();
    if (trimmed === '') {
        return DEFAULT_HOST;
    }

    // IPv6 addresses (::1, [::1], etc.) are allowed.
    // Brackets are added so URL assembly works correctly (e.g. https://[::1]:27123).
    if (trimmed.includes(':')) {
        const inner = trimmed.startsWith('[') && trimmed.endsWith(']') ? trimmed.slice(1, -1) : trimmed;
        if (!isIpv6Address(inner)) {
            throw new Error('Obsidian host contains invalid characters.');
        }
        return `[${inner}]`;
    }

    // Reject hosts containing protocol or slash characters, plus '@' (URL
    // userinfo: "127.0.0.1@evil.com" resolves to evil.com and would send the
    // API key there) and '%' (percent-encoded bypasses of the same trick).
    if (/[\s\/\\@%]/.test(trimmed)) {
        throw new Error('Obsidian host contains invalid characters.');
    }

    // A dot-or-digit-only value is an IPv4 attempt, so it must parse as one.
    // Otherwise "999.999.999.999" would slip through as a "hostname".
    if (/^[0-9.]+$/.test(trimmed)) {
        if (!isValidIpv4Address(trimmed)) {
            throw new Error('Obsidian host contains invalid characters.');
        }
        return trimmed;
    }

    if (!isValidDnsHostname(trimmed)) {
        throw new Error('Obsidian host contains invalid characters.');
    }

    return trimmed;
}

/**
 * Determine whether a string is a valid IPv4 literal (four 0-255 octets).
 */
function isValidIpv4Address(host: string): boolean {
    const octets = host.split('.');
    if (octets.length !== 4) {
        return false;
    }
    return octets.every((octet) => {
        if (!/^\d{1,3}$/.test(octet)) {
            return false;
        }
        return Number(octet) <= 255;
    });
}

/**
 * Determine whether a string is a valid RFC-1123 DNS hostname: dot-separated
 * labels of alphanumerics and hyphens, no empty labels, no leading/trailing
 * hyphen per label, max 63 chars per label and 253 overall.
 */
function isValidDnsHostname(host: string): boolean {
    const name = host.endsWith('.') ? host.slice(0, -1) : host;
    if (name.length === 0 || name.length > 253) {
        return false;
    }
    const labelPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
    return name.split('.').every((label) => labelPattern.test(label));
}

/**
 * Determine whether a string is an IPv6 address.
 * Matches strings containing colons composed of hex digits, colons, and dots (embedded IPv4).
 * @param host - String to test
 * @returns true if the string looks like an IPv6 address
 */
export function isIpv6Address(host: string): boolean {
    if (!host.includes(':')) {
        return false;
    }
    return /^[0-9a-fA-F:.]+$/.test(host);
}

/**
 * Validate and normalize the Obsidian port setting.
 * @param port - Raw port value from settings
 * @returns Normalized port as a string
 * @throws Error if port is not a valid integer in range 1-65535
 */
export function validateObsidianPort(port: string | number | undefined | null): string {
    // Use default when unspecified or empty
    if (port === undefined || port === null || port === '') {
        return DEFAULT_PORT;
    }

    // Numeric conversion
    const portNum = Number(port);

    // Non-numeric check
    if (isNaN(portNum)) {
        throw new Error('Invalid port number. Port must be a valid number.');
    }

    // Integer check
    if (!Number.isInteger(portNum)) {
        throw new Error('Invalid port number. Port must be an integer.');
    }

    // Range check
    if (portNum < MIN_PORT || portNum > MAX_PORT) {
        throw new Error(`Invalid port number. Port must be between ${MIN_PORT} and ${MAX_PORT}.`);
    }

    return String(portNum);
}

/**
 * Read response body with a timeout to prevent hangs.
 * @param response - fetch Response object
 * @returns Response body as string
 * @throws Error with name='AbortError' if body read times out
 */
export async function readBodyWithTimeout(response: Response): Promise<string> {
    // Cap the streamed body on actual bytes (Content-Length can be omitted or lie).
    // Value lives in messaging/limits.ts (PBI 2026-09-11-08 round 6).
    const MAX_BODY_SIZE = LIMIT_MAX_BODY_SIZE;

    const textPromise = readBodyCapped(response, MAX_BODY_SIZE);
    // Suppress unhandled rejection when timeout wins the race
    textPromise.catch(() => {});

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            const timeoutError = new Error(`Body read timed out after ${READ_TIMEOUT_MS}ms`);
            // Named 'AbortError' so downstream _handleError can detect it by name
            timeoutError.name = 'AbortError';
            reject(timeoutError);
        }, READ_TIMEOUT_MS);
    });

    const race = Promise.race([textPromise, timeoutPromise]);
    race.then(() => clearTimeout(timer), () => clearTimeout(timer));
    return race;
}

/**
 * Handle Obsidian connection errors with user-friendly messages.
 * Preserves error.name behavior used by callers.
 * @param error - Original error
 * @param targetUrl - URL that was being accessed
 * @param traceId - Trace identifier for logging
 * @returns User-friendly Error with sanitized message
 */
export function handleObsidianError(error: Error, targetUrl: string, traceId: string = ''): Error {
    const errorMessage = error.message;
    if (errorMessage.includes('Failed to fetch') && targetUrl.startsWith('https')) {
        addLog(LogType.ERROR, `Failed to connect to Obsidian at ${targetUrl}`, { traceId });
        return new Error('Error: Failed to connect to Obsidian. Please visit the Obsidian URL in a new tab and accept the self-signed certificate.');
    }
    if (error.name === 'AbortError' || errorMessage.toLowerCase().includes('timed out')) {
        addLog(LogType.WARN, `Obsidian request timed out: ${targetUrl}`, { error: errorMessage, traceId });
        return new Error('Error: Request timed out. Please check your Obsidian connection.');
    }
    addLog(LogType.ERROR, `Failed to connect to Obsidian at ${targetUrl}. Cause: ${errorMessage}`, { traceId });
    return new Error('Error: Failed to connect to Obsidian. Please check your settings and connection.');
}

/** Default port constant for external use (e.g. config building). */
export const OBSIDIAN_DEFAULT_PORT = DEFAULT_PORT;

/** Default host constant for external use (e.g. config building). */
export const OBSIDIAN_DEFAULT_HOST = DEFAULT_HOST;
