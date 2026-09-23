// @vitest-environment node
/**
 * fieldDescriptor.test.ts
 * Descriptor-table SSOT tests: shape pinning (DOM ids / storage keys) and
 * SSOT-delegation parity (token range via aiLimits, protocol/port/host via
 * obsidianConfigValidator).
 */

import { describe, expect, it } from 'vitest';
import {
  GENERAL_SETTINGS_FIELDS,
  getDescriptorByElementId,
  validateGeminiApiVersionValue,
  validateMaxTokensValue,
  validateMinScrollDepthValue,
  validateMinVisitDurationValue,
  validateObsidianHostValue,
  validatePortValue,
  validateProtocolValue,
} from '../fieldDescriptor.js';
import {
  validateMaxTokens as clampMaxTokens,
  GLOBAL_MAX_TOKENS,
  MIN_TOKENS,
} from '../../../utils/aiLimits.js';
import { StorageKeys } from '../../../utils/storage/types.js';

describe('GENERAL_SETTINGS_FIELDS shape (DOM ids / storage keys are pinned)', () => {
  it('holds exactly the 7 legacy general-settings rows in pipeline order', () => {
    expect(GENERAL_SETTINGS_FIELDS.map((d) => d.elementId)).toEqual([
      'protocol',
      'port',
      'obsidianHost',
      'geminiApiVersion',
      'minVisitDuration',
      'minScrollDepth',
      'maxTokensPerPrompt',
    ]);
  });

  it('maps each row to the unchanged storage key and error element id', () => {
    expect(GENERAL_SETTINGS_FIELDS.map((d) => [d.storageKey, d.elementId, d.errorId])).toEqual([
      [StorageKeys.OBSIDIAN_PROTOCOL, 'protocol', 'protocolError'],
      [StorageKeys.OBSIDIAN_PORT, 'port', 'portError'],
      [StorageKeys.OBSIDIAN_HOST, 'obsidianHost', 'obsidianHostError'],
      [StorageKeys.GEMINI_API_VERSION, 'geminiApiVersion', 'geminiApiVersionError'],
      [StorageKeys.MIN_VISIT_DURATION, 'minVisitDuration', 'minVisitDurationError'],
      [StorageKeys.MIN_SCROLL_DEPTH, 'minScrollDepth', 'minScrollDepthError'],
      [StorageKeys.MAX_TOKENS_PER_PROMPT, 'maxTokensPerPrompt', 'maxTokensError'],
    ]);
  });

  it('exposes parse/validate/save on every row so one row wires validation end to end', () => {
    for (const d of GENERAL_SETTINGS_FIELDS) {
      expect(typeof d.parse).toBe('function');
      expect(typeof d.validate).toBe('function');
      expect(typeof d.save).toBe('function');
    }
  });

  it('parse+validate round-trips without throwing for representative raw input', () => {
    const raws: Record<string, string> = {
      protocol: 'https',
      port: '27124',
      obsidianHost: '127.0.0.1',
      geminiApiVersion: 'v1beta',
      minVisitDuration: '5',
      minScrollDepth: '50',
      maxTokensPerPrompt: '1000',
    };
    for (const d of GENERAL_SETTINGS_FIELDS) {
      expect(() => d.validate(d.parse(raws[d.elementId] ?? ''))).not.toThrow();
      expect(d.validate(d.parse(raws[d.elementId] ?? ''))).toBeNull();
    }
  });

  it('resolves rows by element id', () => {
    expect(getDescriptorByElementId('port')?.storageKey).toBe(StorageKeys.OBSIDIAN_PORT);
    expect(getDescriptorByElementId('nope')).toBeUndefined();
  });
});

describe('token range delegates to aiLimits.validateMaxTokens', () => {
  it('matches the clamp decision for every provider × boundary value', () => {
    const providers = ['gemini', 'openai', 'unknown', ''];
    const values = [9, 10, 11, 1000, 8192, 8193, 10000, 16000, 16001, 0, -5, NaN];
    for (const providerId of providers) {
      for (const v of values) {
        const clamped = clampMaxTokens(v, providerId);
        const expectedValid = Number.isFinite(v) && clamped === v;
        expect(validateMaxTokensValue(v, providerId) === null).toBe(expectedValid);
      }
    }
  });

  it('rejects gemini 10000 while the global range accepts 16000 (provider caps govern)', () => {
    expect(validateMaxTokensValue(10000, 'gemini')).toBe('error_max_tokens_range');
    expect(validateMaxTokensValue(8192, 'gemini')).toBeNull();
    expect(validateMaxTokensValue(16000, '')).toBeNull();
    expect(validateMaxTokensValue(16001, '')).toBe('error_max_tokens_range');
    expect(validateMaxTokensValue(MIN_TOKENS - 1, '')).toBe('error_max_tokens_range');
    expect(validateMaxTokensValue(16000, 'openai')).toBeNull();
    expect(validateMaxTokensValue(16384, 'openai')).toBeNull();
    expect(validateMaxTokensValue(16385, 'openai')).toBe('error_max_tokens_range');
  });
});

describe('other validators preserve legacy UI decisions', () => {
  it('protocol accepts http/https case-insensitively, rejects empty and ftp', () => {
    expect(validateProtocolValue('https')).toBeNull();
    expect(validateProtocolValue('HTTP')).toBeNull();
    expect(validateProtocolValue('ftp')).toBe('errorProtocol');
    expect(validateProtocolValue('')).toBe('errorProtocol');
  });

  it('port defers to validateObsidianPort (empty = default, decimals rejected)', () => {
    expect(validatePortValue('27124')).toBeNull();
    expect(validatePortValue('')).toBeNull();
    expect(validatePortValue('0')).toBe('errorPort');
    expect(validatePortValue('80.5')).toBe('errorPort');
  });

  it('host defers to validateObsidianHost (userinfo tricks rejected)', () => {
    expect(validateObsidianHostValue('127.0.0.1')).toBeNull();
    expect(validateObsidianHostValue('127.0.0.1@evil.com')).toBe('obsidianHostError');
  });

  it('min visit duration keeps the v < 0 floor', () => {
    expect(validateMinVisitDurationValue(0)).toBeNull();
    expect(validateMinVisitDurationValue(30)).toBeNull();
    expect(validateMinVisitDurationValue(-1)).toBe('errorDuration');
    expect(validateMinVisitDurationValue(NaN)).toBe('errorDuration');
  });

  it('min scroll depth keeps the 0-100 range', () => {
    expect(validateMinScrollDepthValue(0)).toBeNull();
    expect(validateMinScrollDepthValue(100)).toBeNull();
    expect(validateMinScrollDepthValue(101)).toBe('errorScrollDepth');
    expect(validateMinScrollDepthValue(-1)).toBe('errorScrollDepth');
  });

  it('gemini api version keeps the legacy shape (empty = provider default)', () => {
    expect(validateGeminiApiVersionValue('v1')).toBeNull();
    expect(validateGeminiApiVersionValue('v1beta')).toBeNull();
    expect(validateGeminiApiVersionValue('')).toBeNull();
    expect(validateGeminiApiVersionValue('bad')).toBe('geminiApiVersionError');
  });
});
