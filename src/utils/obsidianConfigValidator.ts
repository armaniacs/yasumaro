/**
 * obsidianConfigValidator.ts
 * Pure validation functions extracted from ObsidianClient.
 * These functions have no dependency on the ObsidianClient class.
 */

import { addLog, LogType } from './logger.js';

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
 * Validate and normalize the Obsidian protocol setting.
 * @param protocol - Raw protocol value from settings
 * @returns Normalized protocol ('http' or 'https')
 * @throws Error if protocol is a non-empty string that is not 'http' or 'https'
 */
export function validateObsidianProtocol(protocol: string | undefined | null): ObsidianProtocol {
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
        addLog(LogType.WARN, 'HTTP protocol selected — API key and data will be sent in plaintext over the local network. Use HTTPS for encrypted communication.', {
            protocol: normalized
        });
    }

    return normalized;
}

/**
 * Validate and normalize the Obsidian host setting.
 * IPv6 addresses are wrapped in brackets for correct URL assembly.
 * @param host - Raw host value from settings
 * @returns Normalized host string
 * @throws Error if host contains invalid characters
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

    // Reject hosts containing protocol or slash characters
    if (/[\s\/\\]/.test(trimmed)) {
        throw new Error('Obsidian host contains invalid characters.');
    }

    return trimmed;
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
    // Guard against unbounded reads of potentially huge responses
    const contentLength = response.headers?.get('content-length');
    const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB
    if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
        throw new Error(`Response body too large: ${Math.round(parseInt(contentLength, 10) / 1024 / 1024)}MB exceeds ${MAX_BODY_SIZE / 1024 / 1024}MB limit`);
    }

    const textPromise = response.text();
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
