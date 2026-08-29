import { describe, it, expect } from 'vitest';
import {
  collectPositions,
  nextIndex,
  prevIndex,
  MaskNavigator,
} from '../maskNavigator.js';

describe('collectPositions', () => {
  it('returns empty array for text without MASKED tokens', () => {
    expect(collectPositions('hello world')).toEqual([]);
  });

  it('collects single MASKED token position', () => {
    const text = 'hello [MASKED:email] world';
    expect(collectPositions(text)).toEqual([
      { start: 6, end: 20 },
    ]);
  });

  it('collects multiple MASKED token positions', () => {
    const text = '[MASKED:a] middle [MASKED:b]';
    expect(collectPositions(text)).toEqual([
      { start: 0, end: 10 },
      { start: 18, end: 28 },
    ]);
  });

  it('handles empty string', () => {
    expect(collectPositions('')).toEqual([]);
  });
});

describe('nextIndex', () => {
  it('returns -1 for length 0', () => {
    expect(nextIndex(0, 0)).toBe(-1);
  });

  it('wraps from last to first', () => {
    expect(nextIndex(2, 3)).toBe(0);
  });

  it('advances normally', () => {
    expect(nextIndex(0, 3)).toBe(1);
    expect(nextIndex(1, 3)).toBe(2);
  });
});

describe('prevIndex', () => {
  it('returns -1 for length 0', () => {
    expect(prevIndex(0, 0)).toBe(-1);
  });

  it('wraps from first to last', () => {
    expect(prevIndex(0, 3)).toBe(2);
  });

  it('goes back normally', () => {
    expect(prevIndex(2, 3)).toBe(1);
    expect(prevIndex(1, 3)).toBe(0);
  });
});

describe('MaskNavigator', () => {
  it('constructs with no text', () => {
    const nav = new MaskNavigator();
    expect(nav.getCount()).toBe(0);
    expect(nav.getCurrentIndex()).toBe(-1);
  });

  it('constructs with initial text', () => {
    const nav = new MaskNavigator('[MASKED:x]');
    expect(nav.getCount()).toBe(1);
  });

  it('setText resets positions and index', () => {
    const nav = new MaskNavigator('[MASKED:x]');
    nav.next();
    nav.setText('');
    expect(nav.getCount()).toBe(0);
    expect(nav.getCurrentIndex()).toBe(-1);
  });

  it('getPositions returns a copy', () => {
    const nav = new MaskNavigator('[MASKED:x]');
    const positions = nav.getPositions();
    positions.pop();
    expect(nav.getCount()).toBe(1);
  });

  it('getCurrent returns undefined when index is -1', () => {
    const nav = new MaskNavigator('[MASKED:x]');
    expect(nav.getCurrent()).toBeUndefined();
  });

  it('getCurrent returns undefined when index out of bounds after manual set', () => {
    const nav = new MaskNavigator('[MASKED:x]');
    (nav as any).currentIndex = 99;
    expect(nav.getCurrent()).toBeUndefined();
  });

  it('jumpTo clamps to valid range', () => {
    const nav = new MaskNavigator('[MASKED:a] [MASKED:b] [MASKED:c]');
    expect(nav.jumpTo(0)).toBe(0);
    expect(nav.jumpTo(1)).toBe(1);
    expect(nav.jumpTo(-1)).toBe(2);
    expect(nav.jumpTo(3)).toBe(0);
    expect(nav.jumpTo(-2)).toBe(1);
  });

  it('jumpTo returns -1 when empty', () => {
    const nav = new MaskNavigator();
    expect(nav.jumpTo(0)).toBe(-1);
  });

  it('next navigates and wraps', () => {
    const nav = new MaskNavigator('[MASKED:a] [MASKED:b]');
    expect(nav.next()).toBe(0);
    expect(nav.next()).toBe(1);
    expect(nav.next()).toBe(0);
  });

  it('next returns -1 when empty', () => {
    const nav = new MaskNavigator();
    expect(nav.next()).toBe(-1);
  });

  it('prev navigates from -1 to 0, then wraps', () => {
    const nav = new MaskNavigator('[MASKED:a] [MASKED:b]');
    expect(nav.prev()).toBe(0);
    expect(nav.prev()).toBe(1);
    expect(nav.prev()).toBe(0);
  });

  it('prev returns -1 when empty', () => {
    const nav = new MaskNavigator();
    expect(nav.prev()).toBe(-1);
  });

  it('reset clears state', () => {
    const nav = new MaskNavigator('[MASKED:x]');
    nav.next();
    nav.reset();
    expect(nav.getCount()).toBe(0);
    expect(nav.getCurrentIndex()).toBe(-1);
    expect(nav.getCurrent()).toBeUndefined();
  });

  it('static methods are exposed', () => {
    expect(MaskNavigator.collectPositions).toBe(collectPositions);
    expect(MaskNavigator.nextIndex).toBe(nextIndex);
    expect(MaskNavigator.prevIndex).toBe(prevIndex);
  });

  it('getCurrent returns correct position after navigation', () => {
    const nav = new MaskNavigator('[MASKED:a] text [MASKED:b]');
    nav.next();
    expect(nav.getCurrent()).toEqual({ start: 0, end: 10 });
    nav.next();
    expect(nav.getCurrent()).toEqual({ start: 16, end: 26 });
  });
});
