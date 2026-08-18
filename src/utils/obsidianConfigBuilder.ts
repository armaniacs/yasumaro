/**
 * obsidianConfigBuilder.ts
 * Shared config-building logic extracted from ObsidianClient.
 * Used by both _getConfig() and testConnection() to eliminate duplication.
 */

import { getSettings, StorageKeys, Settings } from './storage.js';
import { addLog, LogType } from './logger.js';
import { redactSensitiveData } from './redaction.js';
import {
    validateObsidianProtocol,
    validateObsidianHost,
    validateObsidianPort,
    OBSIDIAN_DEFAULT_PORT,
    OBSIDIAN_DEFAULT_HOST,
} from './obsidianConfigValidator.js';

/** HTTP headers sent with every Obsidian API request. */
const BASE_HEADERS = {
    'Content-Type': 'text/markdown',
    'Accept': 'application/json'
};

/** Configuration required to connect to Obsidian Local REST API. */
export interface ObsidianConfig {
    baseUrl: string;
    headers: HeadersInit;
    settings: Settings;
}

/** Optional overrides for config building (used by testConnection). */
export interface ObsidianConfigOverride {
    protocol?: string;
    port?: string | number;
    apiKey?: string;
}

/**
 * Build ObsidianConfig from settings (or override values).
 *
 * Without override: reads settings from storage, validates all fields,
 * and checks that API key is present.
 *
 * With override: uses override values for protocol/port/apiKey,
 * defaults host to 127.0.0.1, and skips storage read for those fields.
 *
 * @param override - Optional field overrides (e.g. from testConnection popup inputs)
 * @returns Validated ObsidianConfig
 * @throws Error if API key is missing or protocol is invalid
 */
export async function buildObsidianConfig(override?: ObsidianConfigOverride): Promise<ObsidianConfig> {
    if (override) {
        return buildFromOverride(override);
    }
    return buildFromSettings();
}

/**
 * Build config from stored settings.
 */
async function buildFromSettings(): Promise<ObsidianConfig> {
    const settings = await getSettings();

    const protocol = validateObsidianProtocol(settings[StorageKeys.OBSIDIAN_PROTOCOL]);
    const rawPort = settings[StorageKeys.OBSIDIAN_PORT] ?? OBSIDIAN_DEFAULT_PORT;
    const port = validateObsidianPort(rawPort);
    const host = validateObsidianHost(settings[StorageKeys.OBSIDIAN_HOST]);
    const apiKey = settings[StorageKeys.OBSIDIAN_API_KEY];

    addLog(LogType.DEBUG, 'Obsidian API Key check', {
        exists: !!apiKey,
        isEmpty: apiKey === ''
    });

    if (!apiKey || apiKey === '' || typeof apiKey === 'object') {
        console.error('[ObsidianClient] API Key is missing or invalid!', redactSensitiveData({
            apiKey: typeof apiKey
        }));
        addLog(LogType.WARN, 'Obsidian API Key is missing or invalid', { apiKey: typeof apiKey });
        throw new Error('Error: API key is missing. Please check your Obsidian settings.');
    }

    return {
        baseUrl: `${protocol}://${host}:${port}`,
        headers: {
            ...BASE_HEADERS,
            'Authorization': `Bearer ${apiKey}`
        },
        settings
    };
}

/**
 * Build config from override values (used by testConnection).
 * Host is always DEFAULT_HOST since testConnection doesn't read from settings.
 */
function buildFromOverride(override: ObsidianConfigOverride): ObsidianConfig {
    const protocol = validateObsidianProtocol(override.protocol);
    const port = validateObsidianPort(override.port);
    const apiKey = override.apiKey;

    if (!apiKey) {
        // Throw to match the original behavior in testConnection
        throw new Error('API key is missing');
    }

    return {
        baseUrl: `${protocol}://${OBSIDIAN_DEFAULT_HOST}:${port}`,
        headers: {
            ...BASE_HEADERS,
            'Authorization': `Bearer ${apiKey}`
        },
        settings: {} as Settings
    };
}
