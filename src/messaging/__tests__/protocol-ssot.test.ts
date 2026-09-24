import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

describe('protocol version SSOT (Governance: no wxt hardcode drift)', () => {
  it('wxt.config.ts derives __PROTOCOL_VERSION__ from protocol.ts', () => {
    const wxtPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../wxt.config.ts');
    const wxtContent = readFileSync(wxtPath, 'utf-8');
    expect(wxtContent).toContain('CURRENT_PROTOCOL_VERSION');
    expect(wxtContent).not.toMatch(/__PROTOCOL_VERSION__.*JSON\.stringify\(\d+\)/);
  });
});
