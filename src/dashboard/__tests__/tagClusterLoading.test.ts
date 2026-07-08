/**
 * tagClusterLoading.test.ts
 * PBI 2026-07-09-01: Tag Cluster ローディングラベルの i18n 化
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TagClusterLoadingManager } from '../tagClusterLoading.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const { getMessage } = vi.hoisted(() => ({
  getMessage: vi.fn((key: string) => key),
}));

vi.mock('../../popup/i18n.js', () => ({
  getMessage,
}));

function createSvg(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  svg.setAttribute('width', '400');
  svg.setAttribute('height', '300');
  document.body.appendChild(svg);
  return svg;
}

describe('TagClusterLoadingManager (i18n)', () => {
  let svg: SVGSVGElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    getMessage.mockClear();
    svg = createSvg();
  });

  it('renders step labels via getMessage (no hardcoded Japanese)', () => {
    const manager = new TagClusterLoadingManager(svg);
    manager.show();

    const texts = Array.from(svg.querySelectorAll('text')).map((t) => t.textContent || '');
    const joined = texts.join(' | ');

    // getMessage が期待キーで呼ばれていること
    for (const n of [1, 2, 3, 4]) {
      expect(getMessage).toHaveBeenCalledWith(`tagClusterLoadingStep${n}`);
    }

    // 描画テキストにキーが含まれ、ハードコードされた日本語がないこと
    expect(joined).toContain('tagClusterLoadingStep1');
    expect(joined).toContain('tagClusterLoadingStep2');
    expect(joined).toContain('tagClusterLoadingStep3');
    expect(joined).toContain('tagClusterLoadingStep4');
    expect(joined).not.toContain('データ読み込み');
    expect(joined).not.toContain('ノード分析');
    expect(joined).not.toContain('レイアウト計算');
    expect(joined).not.toContain('グラフ描画');
  });

  it('uses the same label source after updateStep (still i18n)', () => {
    const manager = new TagClusterLoadingManager(svg);
    manager.show();
    manager.updateStep(0);
    manager.updateStep(1);

    // ステップ進行後も getMessage 経由であること（再描画でも日本語直書きなし）
    expect(getMessage).toHaveBeenCalledWith('tagClusterLoadingStep2');
  });

  it('cleanup removes the overlay so it can be shown again', () => {
    const manager = new TagClusterLoadingManager(svg);
    manager.show();
    manager.cleanup();
    expect(svg.querySelector('.tag-cluster-loading-overlay')).toBeNull();

    manager.show();
    expect(svg.querySelector('.tag-cluster-loading-overlay')).not.toBeNull();
  });
});
