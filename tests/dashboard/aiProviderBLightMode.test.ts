import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSS_PATH = path.resolve(__dirname, '../../entrypoints/options/dashboard.css');

/**
 * B分離型 AIプロバイダー設定パネルのライトモード視認性。
 * ハードコードされた暗色 (#27272a / #18181b / #3f3f46 / #a78bfa) が
 * `prefers-color-scheme` を無視して常時適用されると、OS ライトモードで
 * 紙色 UI に黒背景が浮く。ベース規則はテーマトークンを使い、暗色は
 * dark メディアクエリ側だけに置く。
 */
function readBlock(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`);
  const m = css.match(re);
  if (!m) throw new Error(`selector not found: ${selector}`);
  return m[1];
}

describe('B分離型パネルのライトモード対応 (dashboard.css)', () => {
  const css = readFileSync(CSS_PATH, 'utf8');

  it('.b-priority-row のベース規則が暗色を直値で持たない', () => {
    const block = readBlock(css, '.b-priority-row');
    expect(block).not.toMatch(/#27272a/i);
    expect(block).not.toMatch(/#3f3f46/i);
    // 行は薄い紙色。白い select/input の子要素と境界が付くようにする
    expect(block).toMatch(/var\(--color-bg-subtle\)/);
    expect(block).toMatch(/var\(--color-border\)/);
  });

  it('.b-provider-details のベース規則が暗色を直値で持たない', () => {
    const block = readBlock(css, '.b-provider-details');
    expect(block).not.toMatch(/#18181b/i);
    expect(block).not.toMatch(/#3f3f46/i);
    expect(block).toMatch(/var\(--color-bg-white\)/);
    expect(block).toMatch(/var\(--color-border\)/);
  });

  it('.b-provider-summary のベース規則がライトで読めるトークン色を使う', () => {
    const block = readBlock(css, '.b-provider-summary');
    expect(block).not.toMatch(/#e4e4e7/i);
    expect(block).toMatch(/var\(--color-text-secondary\)/);
  });

  it('.b-priority-handle のベース規則が薄すぎる #a78bfa を直値で持たない', () => {
    const block = readBlock(css, '.b-priority-handle');
    expect(block).not.toMatch(/#a78bfa/i);
    expect(block).toMatch(/var\(--color-primary\)/);
  });

  it('.b-priority-row.has-error がトークンの danger 色を使う', () => {
    const block = readBlock(css, '.b-priority-row.has-error');
    expect(block).not.toMatch(/#ef4444/i);
    expect(block).toMatch(/var\(--color-danger\)/);
  });

  it('B分離型セレクタのブロック外に暗色直値が残っていない', () => {
    // .b-priority-row 以降 EOF までの範囲に生の暗色が無いこと
    const start = css.indexOf('.ai-layout-toggle {');
    const tail = css.slice(start);
    expect(tail).not.toMatch(/#27272a/i);
    expect(tail).not.toMatch(/#18181b/i);
    expect(tail).not.toMatch(/#3f3f46/i);
    expect(tail).not.toMatch(/#a78bfa/i);
  });
});
