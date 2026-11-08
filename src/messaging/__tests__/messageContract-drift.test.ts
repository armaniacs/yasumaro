/**
 * messageContract-drift.test.ts (PBI 2026-11-08-08)
 *
 * union/配列/loader の3点 drift 検出 pin。新種別を片側だけに追加すると落ちる。
 * - union 側: background/messageTypes.ts の個別メッセージ定義が持つ
 *   `type: 'LITERAL'` の集合 (ExtensionMessage union の実体)。
 * - 配列側: messageTypeRegistry.ts の VALID_MESSAGE_TYPES。
 *   順序は問わない (順序 pin は messageTypeRegistry-parity test の責務)。
 * - loader 側: 共有定数への型結合があり、数値 hardcode 複製がないこと。
 *   union との型一致自体は background 側の compile assert が担保する。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VALID_MESSAGE_TYPES } from '../messageTypeRegistry.js';

describe('message contract 3-point drift pin (PBI 2026-11-08-08)', () => {
  it('ExtensionMessage union / VALID_MESSAGE_TYPES / loader stay in sync', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const messageTypesSrc = readFileSync(resolve(here, '../../background/messageTypes.ts'), 'utf-8');
    // AiTestProgressMessage uses `typeof AI_TEST_PROGRESS_MESSAGE_TYPE`
    // (no string literal), so every remaining `type: 'X'` literal is a
    // union member definition. A union member without its own definition
    // cannot exist (it would not narrow), so this set IS the union side.
    const unionLiterals = new Set(
      [...messageTypesSrc.matchAll(/^\s*type:\s*'([A-Z0-9_]+)'/gm)].map((m) => m[1] as string),
    );
    expect(unionLiterals.size).toBeGreaterThan(0);
    expect([...unionLiterals].sort()).toEqual([...VALID_MESSAGE_TYPES].sort());

    const loaderSrc = readFileSync(resolve(here, '../../content/loader.ts'), 'utf-8');
    expect(loaderSrc).toContain('typeof CURRENT_PROTOCOL_VERSION');
    expect(loaderSrc).not.toMatch(/const CURRENT_PROTOCOL_VERSION\s*=\s*\d+\s*;/);
  });
});
