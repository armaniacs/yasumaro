/**
 * obsidianConfigBuilder.ts
 * Shared config-building logic extracted from ObsidianClient.
 * Used by both _getConfig() and testConnection() to eliminate duplication.
 */

import { settingsRepository } from './storage/SettingsRepository.js';
import { StorageKeys, Settings } from './storage/types.js';
import { LogType } from './logger/types.js';
import { addLog } from './logger/core.js';
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
    /** Host override so testConnection evaluates the same loopback rule as saved configs. */
    host?: string;
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
        return await buildFromOverride(override);
    }
    return buildFromSettings();
}

/**
 * Build config from stored settings.
 */
async function buildFromSettings(): Promise<ObsidianConfig> {
    const settings = await settingsRepository.getAll();

    const rawHost = settings[StorageKeys.OBSIDIAN_HOST];
    const protocol = validateObsidianProtocol(settings[StorageKeys.OBSIDIAN_PROTOCOL], typeof rawHost === 'string' ? rawHost : undefined);
    const rawPort = settings[StorageKeys.OBSIDIAN_PORT] ?? OBSIDIAN_DEFAULT_PORT;
    const port = validateObsidianPort(rawPort);
    const host = validateObsidianHost(rawHost);
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
 * Host falls back to DEFAULT_HOST when not provided, matching the stored-config path.
 *
 * apiKey falls back to the stored key when the override omits it: the dashboard
 * clears the API key input's value (masking the saved key behind a placeholder),
 * so editing only protocol/port/host must not be treated as "no API key configured".
 */
async function buildFromOverride(override: ObsidianConfigOverride): Promise<ObsidianConfig> {
    const protocol = validateObsidianProtocol(override.protocol, override.host);
    const port = validateObsidianPort(override.port);
    const apiKey = override.apiKey || (await settingsRepository.get(StorageKeys.OBSIDIAN_API_KEY));

    if (!apiKey || typeof apiKey !== 'string') {
        // Throw to match the original behavior in testConnection
        throw new Error('API key is missing');
    }

    const host = override.host && override.host.trim() !== '' ? validateObsidianHost(override.host) : OBSIDIAN_DEFAULT_HOST;

    return {
        baseUrl: `${protocol}://${host}:${port}`,
        headers: {
            ...BASE_HEADERS,
            'Authorization': `Bearer ${apiKey}`
        },
        settings: {} as Settings
    };
}
