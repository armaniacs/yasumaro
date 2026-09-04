/**
 * domEnv.test.ts — the instrumented jsdom counts what it claims and cleans up.
 */
// @ts-nocheck
import { describe, it, expect, afterEach } from 'vitest';
import { setupDom } from '../domEnv.mjs';

let env: ReturnType<typeof setupDom> | null = null;

afterEach(() => {
  env?.teardown();
  env = null;
});

describe('setupDom counters', () => {
  it('counts querySelectorAll on Element and Document', () => {
    env = setupDom('<div id="a"><span></span><span></span></div>');
    env.resetCounters();
    env.document.querySelectorAll('span');
    env.document.getElementById('a').querySelectorAll('span');
    expect(env.counters.qsa).toBe(2);
  });

  it('counts deep cloneNode only', () => {
    env = setupDom('<div id="a"><p>x</p></div>');
    env.resetCounters();
    const el = env.document.getElementById('a');
    el.cloneNode(false);
    el.cloneNode(true);
    el.cloneNode(true);
    expect(env.counters.clone).toBe(2);
  });

  it('counts TreeWalker traversal steps', () => {
    env = setupDom('<div id="a"><p></p><p></p><p></p></div>');
    env.resetCounters();
    const walker = env.document.createTreeWalker(
      env.document.getElementById('a'),
      env.window.NodeFilter.SHOW_ELEMENT,
    );
    let n = walker.nextNode();
    while (n) n = walker.nextNode();
    // 3 <p> elements visited
    expect(env.counters.treeWalker).toBe(3);
  });

  it('counts reflow-coupled getter reads', () => {
    env = setupDom('<div id="a">hello</div>');
    env.resetCounters();
    const el = env.document.getElementById('a');
    env.window.getComputedStyle(el);
    el.getBoundingClientRect();
    // jsdom v26 does not implement innerText/offset* so only getComputedStyle
    // and getBoundingClientRect are instrumentable here.
    expect(env.counters.reflow).toBe(2);
  });
});

describe('teardown', () => {
  it('restores globalThis and prototypes', () => {
    const hadWindow = 'window' in globalThis;
    env = setupDom('<div></div>');
    const patchedQSA = env.window.Element.prototype.querySelectorAll;
    env.teardown();
    env = null;

    // global cleaned up (node has no window by default in this suite)
    expect('window' in globalThis).toBe(hadWindow);

    // a fresh env gets an un-double-patched prototype
    const env2 = setupDom('<div id="x"><span></span></div>');
    env2.resetCounters();
    env2.document.querySelectorAll('span');
    expect(env2.counters.qsa).toBe(1); // not 2, so the previous patch was removed
    env2.teardown();
    expect(patchedQSA).not.toBe(env2.window.Element.prototype.querySelectorAll);
  });
});
