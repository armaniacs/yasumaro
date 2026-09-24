import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CURRENT_PROTOCOL_VERSION } from '../protocol.js';

describe('protocol version single source', () => {
  it('CURRENT_PROTOCOL_VERSION is a positive integer', () => {
    expect(Number.isInteger(CURRENT_PROTOCOL_VERSION)).toBe(true);
    expect(CURRENT_PROTOCOL_VERSION).toBeGreaterThan(0);
  });

  it('wxt.config.ts define matches protocol.ts', () => {
    const wxtPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../wxt.config.ts');
    const wxtContent = readFileSync(wxtPath, 'utf-8');
    // Preferred: wxt.config.ts derives the value from protocol.ts (no drift).
    // Legacy: a numeric literal that must equal CURRENT_PROTOCOL_VERSION.
    const derived = /__PROTOCOL_VERSION__.*?JSON\.stringify\(CURRENT_PROTOCOL_VERSION\)/.test(wxtContent);
    if (derived) {
      expect(wxtContent).toContain('CURRENT_PROTOCOL_VERSION');
      return;
    }
    const match = wxtContent.match(/__PROTOCOL_VERSION__.*?JSON\.stringify\((\d+)\)/);
    expect(match).not.toBeNull();
    if (match) {
      expect(Number(match[1])).toBe(CURRENT_PROTOCOL_VERSION);
    }
  });

  it('loader.ts uses build-time define with fallback', () => {
    const loaderPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../content/loader.ts');
    const loaderContent = readFileSync(loaderPath, 'utf-8');
    expect(loaderContent).toContain('__PROTOCOL_VERSION__');
    expect(loaderContent).toContain('CURRENT_PROTOCOL_VERSION');
    // loader.ts must not have a bare `= 1` hardcode without the define reference
    expect(loaderContent).not.toMatch(/const CURRENT_PROTOCOL_VERSION\s*=\s*1\s*;/);
  });
});
