// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { WHITELIST_ADAPTERS, matchWhitelistAdapter, extractWhitelistedContent } from '../whitelistAdapters.js';

describe('WHITELIST_ADAPTERS definitions', () => {
  it('defines exactly 6 adapters', () => {
    expect(WHITELIST_ADAPTERS).toHaveLength(6);
  });

  it('each adapter has required fields', () => {
    for (const adapter of WHITELIST_ADAPTERS) {
      expect(typeof adapter.name).toBe('string');
      expect(Array.isArray(adapter.domains)).toBe(true);
      expect(typeof adapter.detectSelector).toBe('string');
      expect(Array.isArray(adapter.contentSelectors)).toBe(true);
      expect(adapter.contentSelectors.length).toBeGreaterThan(0);
    }
  });

  it('includes the Togetter adapter with correct selectors', () => {
    const togetter = WHITELIST_ADAPTERS.find(a => a.name === 'togetter');
    expect(togetter).toBeDefined();
    expect(togetter?.domains).toContain('togetter.com');
    expect(togetter?.contentSelectors).toContain('.tweet_body');
  });

  it('includes the 5ch matome adapter with empty domains (domain-independent)', () => {
    const matome = WHITELIST_ADAPTERS.find(a => a.name === '5ch-matome');
    expect(matome).toBeDefined();
    expect(matome?.domains).toEqual([]);
  });

  it('includes the naro/kakuyomu adapter', () => {
    const novel = WHITELIST_ADAPTERS.find(a => a.name === 'novel-site');
    expect(novel).toBeDefined();
    expect(novel?.domains).toEqual(expect.arrayContaining(['syosetu.com', 'kakuyomu.jp']));
  });
});

describe('matchWhitelistAdapter', () => {
  it('matches by exact hostname', () => {
    const adapter = matchWhitelistAdapter('togetter.com', document.body);
    expect(adapter?.name).toBe('togetter');
  });

  it('matches by hostname suffix (subdomain)', () => {
    const adapter = matchWhitelistAdapter('www.togetter.com', document.body);
    expect(adapter?.name).toBe('togetter');
  });

  it('matches by detectSelector even when hostname is unknown (5ch matome)', () => {
    document.body.innerHTML = '<div class="res">レス本文</div>';
    const adapter = matchWhitelistAdapter('random-matome-blog.example.com', document.body);
    expect(adapter?.name).toBe('5ch-matome');
    document.body.innerHTML = '';
  });

  it('matches by detectSelector even when hostname is unrelated (novel site structure)', () => {
    document.body.innerHTML = '<div id="novel_honbun">小説本文</div>';
    const adapter = matchWhitelistAdapter('some-mirror-site.example.com', document.body);
    expect(adapter?.name).toBe('novel-site');
    document.body.innerHTML = '';
  });

  it('returns null when neither domain nor detectSelector matches', () => {
    document.body.innerHTML = '<p>Normal content</p>';
    const adapter = matchWhitelistAdapter('example.com', document.body);
    expect(adapter).toBeNull();
    document.body.innerHTML = '';
  });

  it('domain match takes priority even without detectSelector present', () => {
    document.body.innerHTML = '<p>No tweet_body here</p>';
    const adapter = matchWhitelistAdapter('togetter.com', document.body);
    expect(adapter?.name).toBe('togetter');
    document.body.innerHTML = '';
  });
});

describe('extractWhitelistedContent', () => {
  it('extracts and joins text from contentSelectors in DOM order', () => {
    document.body.innerHTML = `
      <div class="tweet_body">最初のツイート本文</div>
      <div class="item_text">まとめ主のコメント</div>
      <div class="tweet_body">2番目のツイート本文</div>
    `;
    const togetter = WHITELIST_ADAPTERS.find(a => a.name === 'togetter')!;
    const result = extractWhitelistedContent(document.body, togetter);
    expect(result).toContain('最初のツイート本文');
    expect(result).toContain('まとめ主のコメント');
    expect(result).toContain('2番目のツイート本文');
    expect(result.indexOf('最初のツイート本文')).toBeLessThan(result.indexOf('まとめ主のコメント'));
    document.body.innerHTML = '';
  });

  it('returns empty string when no contentSelectors match', () => {
    document.body.innerHTML = '<p>Unrelated content</p>';
    const togetter = WHITELIST_ADAPTERS.find(a => a.name === 'togetter')!;
    const result = extractWhitelistedContent(document.body, togetter);
    expect(result).toBe('');
    document.body.innerHTML = '';
  });

  it('strips retweet count and @username metadata patterns from extracted text', () => {
    document.body.innerHTML = `<div class="tweet_body">これは本文です @some_user RT(123)</div>`;
    const togetter = WHITELIST_ADAPTERS.find(a => a.name === 'togetter')!;
    const result = extractWhitelistedContent(document.body, togetter);
    expect(result).toContain('これは本文です');
    expect(result).not.toContain('@some_user');
    expect(result).not.toContain('RT(123)');
    document.body.innerHTML = '';
  });
});
