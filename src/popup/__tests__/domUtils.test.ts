// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { updateStatusIcon } from '../domUtils.js';

describe('domUtils', () => {
  describe('updateStatusIcon', () => {
    it('returns early when container is null', () => {
      expect(() => updateStatusIcon(null, 'success')).not.toThrow();
    });

    it('returns early when svg not found', () => {
      const container = document.createElement('div');
      container.innerHTML = '<span>no svg</span>';
      expect(() => updateStatusIcon(container, 'success')).not.toThrow();
      expect(container.innerHTML).toContain('no svg');
    });

    it('renders success icon', () => {
      const container = document.createElement('div');
      container.innerHTML = '<svg class="status-svg"></svg>';
      updateStatusIcon(container, 'success');
      const svg = container.querySelector('.status-svg')!;
      expect(svg.children.length).toBeGreaterThan(0);
      // should contain circle and path
      expect(svg.querySelector('circle')).not.toBeNull();
      expect(svg.querySelector('path')).not.toBeNull();
    });

    it('renders error icon', () => {
      const container = document.createElement('div');
      container.innerHTML = '<svg class="status-svg"></svg>';
      updateStatusIcon(container, 'error');
      const svg = container.querySelector('.status-svg')!;
      expect(svg.children.length).toBeGreaterThan(0);
      expect(svg.querySelectorAll('line').length).toBeGreaterThanOrEqual(2);
    });

    it('renders warning icon', () => {
      const container = document.createElement('div');
      container.innerHTML = '<svg class="status-svg"></svg>';
      updateStatusIcon(container, 'warning');
      const svg = container.querySelector('.status-svg')!;
      expect(svg.children.length).toBeGreaterThan(0);
      expect(svg.querySelectorAll('line').length).toBeGreaterThanOrEqual(2);
    });

    it('renders muted icon', () => {
      const container = document.createElement('div');
      container.innerHTML = '<svg class="status-svg"></svg>';
      updateStatusIcon(container, 'muted');
      const svg = container.querySelector('.status-svg')!;
      expect(svg.children.length).toBeGreaterThan(0);
      expect(svg.querySelector('path')).not.toBeNull();
    });

    it('clears previous children before rendering', () => {
      const container = document.createElement('div');
      container.innerHTML = '<svg class="status-svg"><circle></circle><path></path></svg>';
      const svg = container.querySelector('.status-svg')!;
      expect(svg.children.length).toBe(2);
      updateStatusIcon(container, 'success');
      // should have new children, not doubled
      expect(svg.querySelectorAll('circle').length).toBe(1);
    });
  });
});
