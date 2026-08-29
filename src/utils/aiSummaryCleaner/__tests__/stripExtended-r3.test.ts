/**
 * @vitest-environment jsdom
 */
/**
 * stripExtended-r3.test.ts — branch coverage for uncovered lines 589-690 and 869-870
 * Targets: stripLinkOnlyParagraphs direct-text-node + hasNonLinkText branches,
 *          stripEnhancedHiddenElements opacity fixed/sticky variants,
 *          stripEmptyElements allEmpty / childHasContent branches,
 *          stripAffiliateElements ancestor deduplication.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  stripLinkOnlyParagraphs,
  stripEnhancedHiddenElements,
  stripEmptyElements,
  stripAffiliateElements,
} from '../stripExtended.js';

describe('stripExtended - R3 uncovered branches 589-690, 869-870', () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
  });

  afterEach(() => {
    root.remove();
  });

  // ==========================================================================
  // stripLinkOnlyParagraphs — covers lines 582-613
  // ==========================================================================
  describe('stripLinkOnlyParagraphs — uncovered branches', () => {
    it('returns 0 for paragraph with no links (hasLinks false)', () => {
      root.innerHTML = '<p>Just plain text without any links</p>';
      expect(stripLinkOnlyParagraphs(root, 50)).toBe(0);
      expect(root.querySelector('p')).not.toBeNull();
    });

    it('returns 0 when text exceeds maxLength early return', () => {
      root.innerHTML = '<p><a href="#">short</a></p>';
      // text "short" length 5, maxLength 2 → early return
      expect(stripLinkOnlyParagraphs(root, 2)).toBe(0);
    });

    it('returns 0 for empty paragraph (text.length == 0)', () => {
      root.innerHTML = '<p>   </p>';
      expect(stripLinkOnlyParagraphs(root, 50)).toBe(0);
    });

    it('does not remove paragraph with non-link child containing text (hasOnlyLinks false + hasNonLinkText true)', () => {
      root.innerHTML = '<p><a href="#">Link</a><span>extra</span></p>';
      expect(stripLinkOnlyParagraphs(root, 50)).toBe(0);
      expect(root.querySelector('p')).not.toBeNull();
    });

    it('does not remove paragraph with non-link child containing only whitespace (hasOnlyLinks false, hasNonLinkText false)', () => {
      root.innerHTML = '<p><a href="#">Link</a><span>   </span></p>';
      expect(stripLinkOnlyParagraphs(root, 50)).toBe(0);
    });

    it('does not remove paragraph with direct text node outside links (nodeType 3 branch)', () => {
      root.innerHTML = '<p><a href="#">Link</a> direct text</p>';
      expect(stripLinkOnlyParagraphs(root, 50)).toBe(0);
    });

    it('removes paragraph with only links and whitespace text nodes (whitespace trimmed length 0)', () => {
      root.innerHTML = '<p><a href="#">Link1</a>   <a href="#">Link2</a>   </p>';
      expect(stripLinkOnlyParagraphs(root, 50)).toBe(1);
      expect(root.querySelector('p')).toBeNull();
    });

    it('removes paragraph with only links and br tags (br branch)', () => {
      root.innerHTML = '<p><a href="#">A</a><br><a href="#">B</a></p>';
      expect(stripLinkOnlyParagraphs(root, 50)).toBe(1);
    });

    it('does not remove paragraph with span empty text but non-link element present (second loop empty branch)', () => {
      // First loop: encounters span → hasOnlyLinks = false → break
      // Second loop: span text is whitespace → childText trimmed 0 → hasNonLinkText stays false
      // Final: hasLinks true, hasOnlyLinks false → not removed
      root.innerHTML = '<p><a href="#">Link</a><span>   </span></p>';
      expect(stripLinkOnlyParagraphs(root, 50)).toBe(0);
    });

    it('does not remove paragraph where direct childNodes include element nodes (nodeType !==3)', () => {
      // Only element children, no text nodes, with hasNonLinkText already true via span
      root.innerHTML = '<p><a href="#">Link</a><span>hello</span></p>';
      expect(stripLinkOnlyParagraphs(root, 50)).toBe(0);
    });

    it('skips direct text node check when hasNonLinkText already true', () => {
      // hasNonLinkText set via second loop (span with text), so !hasNonLinkText is false → inner text node loop skipped
      root.innerHTML = '<p><a href="#">Link</a><span>not empty</span> trailing</p>';
      expect(stripLinkOnlyParagraphs(root, 50)).toBe(0);
    });

    it('handles paragraph with zero children but direct text (children.length 0, childNodes text)', () => {
      // <p>hello</p> has no element children, hasLinks false → not removed (covers child loop 0 iterations + text node check)
      root.innerHTML = '<p>hello direct</p>';
      expect(stripLinkOnlyParagraphs(root, 50)).toBe(0);
    });

    it('removes paragraph with single link and no extra text nodes', () => {
      root.innerHTML = '<p><a href="#">OnlyLink</a></p>';
      expect(stripLinkOnlyParagraphs(root, 50)).toBe(1);
    });

    it('does not remove link-only paragraph when body protected', () => {
      root.innerHTML = '<div data-ow-body-protected="true"><p><a href="#">Link</a></p></div>';
      expect(stripLinkOnlyParagraphs(root, 50)).toBe(0);
      expect(root.querySelector('p')).not.toBeNull();
    });

    it('covers nodeValue null branch (empty text node)', () => {
      // Create p with an empty text node via JS to hit (node.nodeValue || '') path
      const p = document.createElement('p');
      const a = document.createElement('a');
      a.href = '#';
      a.textContent = 'Link';
      p.appendChild(a);
      // Append an empty text node (nodeValue is "")
      p.appendChild(document.createTextNode(''));
      // Append whitespace-only text node
      p.appendChild(document.createTextNode('   '));
      root.appendChild(p);
      // hasLinks true, hasOnlyLinks true, hasNonLinkText false (empty text trimmed 0), text length >0 → should be removed
      expect(stripLinkOnlyParagraphs(root, 50)).toBe(1);
    });
  });

  // ==========================================================================
  // stripEnhancedHiddenElements — covers lines 638-659 (opacity branches)
  // ==========================================================================
  describe('stripEnhancedHiddenElements — opacity and selector branches', () => {
    it('removes opacity:0 with position:fixed without space', () => {
      root.innerHTML = '<div style="opacity: 0;position:fixed;">hidden</div>';
      expect(stripEnhancedHiddenElements(root)).toBe(1);
    });

    it('removes opacity:0 with position:sticky without space', () => {
      root.innerHTML = '<div style="opacity: 0;position:sticky;">hidden</div>';
      expect(stripEnhancedHiddenElements(root)).toBe(1);
    });

    it('does not remove opacity:0 with position:relative', () => {
      root.innerHTML = '<div style="opacity: 0; position: relative;">not removed</div>';
      expect(stripEnhancedHiddenElements(root)).toBe(0);
    });

    it('does not remove opacity:0 with no position', () => {
      root.innerHTML = '<div style="opacity: 0;">not removed</div>';
      expect(stripEnhancedHiddenElements(root)).toBe(0);
    });

    it('removes hidden, aria-hidden, display:none, visibility:hidden, template, slot individually', () => {
      root.innerHTML = `
        <div hidden>h</div>
        <div aria-hidden="true">a</div>
        <div style="display:none">d1</div>
        <div style="display: none">d2</div>
        <div style="visibility:hidden">v1</div>
        <div style="visibility: hidden">v2</div>
        <template>t</template>
        <slot>s</slot>
      `;
      const count = stripEnhancedHiddenElements(root);
      // 8 elements matched (opacity not included)
      expect(count).toBe(8);
    });

    it('deduplicates elements matched by multiple selectors', () => {
      root.innerHTML = '<div hidden aria-hidden="true" style="display:none">multi</div>';
      expect(stripEnhancedHiddenElements(root)).toBe(1);
    });

    it('respects body protection for hidden elements', () => {
      root.innerHTML = '<div data-ow-body-protected="true"><div hidden>protected</div></div>';
      expect(stripEnhancedHiddenElements(root)).toBe(0);
      expect(root.querySelector('[hidden]')).not.toBeNull();
    });
  });

  // ==========================================================================
  // stripEmptyElements — covers lines 667-705
  // ==========================================================================
  describe('stripEmptyElements — allEmpty and childHasContent branches', () => {
    it('removes element with no text, no images, no children', () => {
      root.innerHTML = '<div></div>';
      expect(stripEmptyElements(root)).toBe(1);
    });

    it('does not remove element with text content', () => {
      root.innerHTML = '<div>hello</div>';
      expect(stripEmptyElements(root)).toBe(0);
    });

    it('does not remove element with image', () => {
      root.innerHTML = '<div><img src="a.jpg"></div>';
      expect(stripEmptyElements(root)).toBe(0);
    });

    it('removes parent whose children are all empty', () => {
      root.innerHTML = '<section><div></div><span>   </span><p></p></section>';
      // section has no direct text, no img, hasChildren true, allEmpty true → removed, plus each child individually
      const count = stripEmptyElements(root);
      expect(count).toBeGreaterThanOrEqual(1);
      // section removed implies root no longer contains section
      expect(root.querySelector('section')).toBeNull();
    });

    it('does not remove parent when a child has text (childHasContent via text)', () => {
      root.innerHTML = '<div><span></span><p>text</p></div>';
      const count = stripEmptyElements(root);
      // Only the empty span removed, parent not removed, p not removed
      expect(count).toBe(1);
      expect(root.querySelector('div')).not.toBeNull();
    });

    it('does not remove parent when a child has image (childHasContent via img)', () => {
      root.innerHTML = '<div><span></span><p><img src="x.jpg"></p></div>';
      const count = stripEmptyElements(root);
      // span is empty, but parent has child with img → parent not removed; img prevents removal of p and parent
      expect(count).toBe(1);
      expect(root.querySelector('div')).not.toBeNull();
    });

    it('removes parent when all children have no text and no img (allEmpty true)', () => {
      root.innerHTML = '<div><span>   </span><p>  </p></div>';
      const count = stripEmptyElements(root);
      // Both children empty, parent empty → all 3 removed (order may vary)
      expect(count).toBe(3);
    });

    it('does not remove p with whitespace only but hasImages false counted as empty', () => {
      root.innerHTML = '<p>   </p>';
      expect(stripEmptyElements(root)).toBe(1);
    });

    it('handles nested empty structure with image deep in child', () => {
      root.innerHTML = '<div><span><img src="y.jpg"></span></div>';
      // outer div has child span which has img → childHasContent true → outer not removed
      // span itself has img so not removed
      expect(stripEmptyElements(root)).toBe(0);
    });

    it('skips already counted elements', () => {
      // Create duplicate scenario by having same element matched twice via selector overlap
      root.innerHTML = '<div>   </div>';
      // Run once, then run again — second run should have 0 because elements removed
      expect(stripEmptyElements(root)).toBe(1);
      expect(stripEmptyElements(root)).toBe(0);
    });

    it('respects body protection', () => {
      root.innerHTML = '<div data-ow-body-protected="true"><div></div></div>';
      expect(stripEmptyElements(root)).toBe(0);
    });
  });

  // ==========================================================================
  // stripAffiliateElements — covers lines 869-870 (ancestor dedup)
  // ==========================================================================
  describe('stripAffiliateElements — nested ancestor skip (869-870)', () => {
    it('skips nested affiliate elements whose ancestor already matched', () => {
      root.innerHTML = `
        <div class="yyi-rinker-contents">
          <div class="yyi-rinker-title">Outer Product</div>
          <div class="kaerebalink-box">
            <div class="kaerebalink-name">Inner Product</div>
          </div>
        </div>
      `;
      const count = stripAffiliateElements(root);
      // Only outer processed, inner skipped via hasMatchingAncestor
      expect(count).toBe(1);
      expect(root.textContent).toContain('Outer Product');
      expect(root.textContent).not.toContain('Inner Product');
    });

    it('processes sibling affiliates independently (no ancestor overlap)', () => {
      root.innerHTML = `
        <div class="yyi-rinker-contents"><div class="yyi-rinker-title">A</div></div>
        <div class="pochipp-box"><div class="pochipp-title">B</div></div>
      `;
      expect(stripAffiliateElements(root)).toBe(2);
    });

    it('processes outer but not inner when inner is pochipp inside rinker', () => {
      root.innerHTML = `
        <div class="pochipp-box">
          <div class="pochipp-title">Outer</div>
          <div class="yyi-rinker-contents"><div class="yyi-rinker-title">Inner</div></div>
        </div>
      `;
      expect(stripAffiliateElements(root)).toBe(1);
      expect(root.textContent).toContain('Outer');
    });

    it('deeply nested ancestor chain still skips', () => {
      root.innerHTML = `
        <div class="yyi-rinker-contents">
          <div class="yyi-rinker-title">Top</div>
          <div><div><div class="kaerebalink-box"><div class="kaerebalink-name">Deep</div></div></div></div>
        </div>
      `;
      expect(stripAffiliateElements(root)).toBe(1);
      expect(root.textContent).toContain('Top');
    });

    it('counts nested case where ancestor is not affiliate (should process inner)', () => {
      root.innerHTML = `
        <div class="normal-wrapper">
          <div class="yyi-rinker-contents"><div class="yyi-rinker-title">Inner1</div></div>
          <div class="kaerebalink-box"><div class="kaerebalink-name">Inner2</div></div>
        </div>
      `;
      expect(stripAffiliateElements(root)).toBe(2);
    });

    it('handles empty nested affiliate (inner skipped, outer removed)', () => {
      root.innerHTML = `
        <div class="yyi-rinker-contents">
          <div class="yyi-rinker-title">Outer</div>
          <div class="moshimo-style"><span>Inner Empty</span></div>
        </div>
      `;
      expect(stripAffiliateElements(root)).toBe(1);
    });
  });
});
