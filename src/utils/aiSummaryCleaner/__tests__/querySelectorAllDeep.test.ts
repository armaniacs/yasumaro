// @vitest-environment jsdom
/**
 * querySelectorAllDeep.test.ts — 30-03 Shadow DOM / iframe 走査
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { querySelectorAllDeep, collectElementsDeep } from '../helpers.js';

describe('querySelectorAllDeep (30-03)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('Light DOM retrieves elements as before', () => {
    document.body.innerHTML = `<div class="ad-banner">ad</div><div class="ad-banner">ad2</div><p>body</p>`;
    const result = querySelectorAllDeep(document.body, '.ad-banner');
    expect(result.length).toBe(2);
  });

  it('retrieves elements inside an open shadowRoot', () => {
    const host = document.createElement('div');
    host.id = 'host';
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<div class="ad-banner">shadow ad</div><p>shadow body</p>`;

    const result = querySelectorAllDeep(document.body, '.ad-banner');
    // light DOM 0 + shadow 1 = 1
    expect(result.length).toBe(1);
    expect(result[0]!.textContent).toBe('shadow ad');
  });

  it('retrieves elements across two nested shadowRoot levels', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const innerHost = document.createElement('div');
    innerHost.id = 'inner';
    shadow.appendChild(innerHost);
    const innerShadow = innerHost.attachShadow({ mode: 'open' });
    innerShadow.innerHTML = `<span class="ad-banner">deep ad</span>`;

    const result = querySelectorAllDeep(document.body, '.ad-banner');
    expect(result.length).toBe(1);
    expect(result[0]!.textContent).toBe('deep ad');
  });

  it('does not throw for elements without shadowRoot', () => {
    document.body.innerHTML = `<div><p>hello</p></div>`;
    const result = querySelectorAllDeep(document.body, 'p');
    expect(result.length).toBe(1);
  });

  it('does not retrieve a closed shadowRoot (by design)', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `<div class="ad-banner">closed ad</div>`;
    // closed は .shadowRoot が null なので取得できない
    const result = querySelectorAllDeep(document.body, '.ad-banner');
    expect(result.length).toBe(0);
    expect(host.shadowRoot).toBeNull();
  });

  it('does not throw for an empty shadowRoot', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    host.attachShadow({ mode: 'open' });
    const result = querySelectorAllDeep(document.body, '.ad-banner');
    expect(result.length).toBe(0);
  });

  it('collectElementsDeep is an alias of querySelectorAllDeep', () => {
    expect(collectElementsDeep).toBe(querySelectorAllDeep);
  });

  it('does not throw for an invalid selector', () => {
    document.body.innerHTML = `<div>test</div>`;
    expect(() => querySelectorAllDeep(document.body, ':::invalid')).not.toThrow();
    const result = querySelectorAllDeep(document.body, ':::invalid');
    expect(result.length).toBe(0);
  });

  it('scans directly from a shadowRoot root', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<div class="target">a</div><div class="target">b</div>`;
    const result = querySelectorAllDeep(shadow, '.target');
    expect(result.length).toBe(2);
  });

  it('retrieves elements inside a same-origin iframe (mock)', () => {
    // jsdom では iframe.contentDocument をモックして検証
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    // jsdom の iframe は contentDocument が null のことがあるため、モック差し替え
    const iframeDoc = document.implementation.createHTMLDocument('iframeDoc');
    iframeDoc.body.innerHTML = `<div class="ad-banner">iframe ad</div>`;
    Object.defineProperty(iframe, 'contentDocument', {
      value: iframeDoc,
      writable: true,
      configurable: true,
    });
    const result = querySelectorAllDeep(document.body, '.ad-banner');
    expect(result.length).toBe(1);
    expect(result[0]!.textContent).toBe('iframe ad');
  });

  it('skips an iframe that throws as a cross-origin equivalent', () => {
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    Object.defineProperty(iframe, 'contentDocument', {
      get() { throw new Error('SecurityError: cross-origin'); },
      configurable: true,
    });
    expect(() => querySelectorAllDeep(document.body, '.ad-banner')).not.toThrow();
  });
});
