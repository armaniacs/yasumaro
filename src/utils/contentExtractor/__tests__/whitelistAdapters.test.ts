// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { WHITELIST_ADAPTERS, matchWhitelistAdapter, extractWhitelistedContent } from '../whitelistAdapters.js';

describe('WHITELIST_ADAPTERS definitions', () => {
  it('defines exactly 10 adapters', () => {
    expect(WHITELIST_ADAPTERS).toHaveLength(10);
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

  it('includes the hatena-bookmark adapter', () => {
    const hatena = WHITELIST_ADAPTERS.find(a => a.name === 'hatena-bookmark');
    expect(hatena).toBeDefined();
    expect(hatena?.domains).toContain('b.hatena.ne.jp');
    expect(hatena?.contentSelectors).toContain('.entry-comment-text');
    expect(hatena?.metadataPatterns).toEqual([]);
  });

  it('includes the tabelog adapter with rating/date metadata patterns', () => {
    const tabelog = WHITELIST_ADAPTERS.find(a => a.name === 'tabelog');
    expect(tabelog).toBeDefined();
    expect(tabelog?.domains).toContain('tabelog.com');
    expect(tabelog?.contentSelectors).toContain('.rvw-item__rvw-comment');
    expect(tabelog?.metadataPatterns?.length).toBe(2);
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

  it('matches hatena-bookmark by exact hostname', () => {
    const adapter = matchWhitelistAdapter('b.hatena.ne.jp', document.body);
    expect(adapter?.name).toBe('hatena-bookmark');
  });

  it('matches tabelog by exact hostname', () => {
    const adapter = matchWhitelistAdapter('tabelog.com', document.body);
    expect(adapter?.name).toBe('tabelog');
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

  it('uses default metadata patterns when adapter.metadataPatterns is undefined', () => {
    document.body.innerHTML = `<div class="tweet_body">本文です @some_user RT(5)</div>`;
    const togetter = WHITELIST_ADAPTERS.find(a => a.name === 'togetter')!;
    expect(togetter.metadataPatterns).toBeUndefined();
    const result = extractWhitelistedContent(document.body, togetter);
    expect(result).toContain('本文です');
    expect(result).not.toContain('@some_user');
    expect(result).not.toContain('RT(5)');
    document.body.innerHTML = '';
  });

  it('applies adapter-specific metadataPatterns instead of the default when specified', () => {
    document.body.innerHTML = `<div class="custom-review">とても美味しい ★4.5 でした</div>`;
    const customAdapter = {
      name: 'test-custom',
      domains: [],
      detectSelector: '.custom-review',
      contentSelectors: ['.custom-review'],
      metadataPatterns: [/★\s*[\d.]+/g],
    };
    const result = extractWhitelistedContent(document.body, customAdapter);
    expect(result).toContain('とても美味しい');
    expect(result).toContain('でした');
    expect(result).not.toContain('★4.5');
    document.body.innerHTML = '';
  });

  it('applies no metadata removal when adapter.metadataPatterns is an empty array', () => {
    document.body.innerHTML = `<div class="custom-comment">@mention はそのまま残る RT(1) も残る</div>`;
    const customAdapter = {
      name: 'test-no-strip',
      domains: [],
      detectSelector: '.custom-comment',
      contentSelectors: ['.custom-comment'],
      metadataPatterns: [],
    };
    const result = extractWhitelistedContent(document.body, customAdapter);
    expect(result).toContain('@mention はそのまま残る');
    expect(result).toContain('RT(1) も残る');
    document.body.innerHTML = '';
  });

  it('extracts hatena-bookmark comment text without metadata stripping', () => {
    document.body.innerHTML = `<div class="entry-comment-text">これは@mentionを含むコメントです RT(9)も含む</div>`;
    const hatena = WHITELIST_ADAPTERS.find(a => a.name === 'hatena-bookmark')!;
    const result = extractWhitelistedContent(document.body, hatena);
    expect(result).toContain('@mentionを含むコメントです');
    expect(result).toContain('RT(9)も含む');
    document.body.innerHTML = '';
  });

  it('strips star rating and visit date metadata from tabelog review text', () => {
    document.body.innerHTML = `<div class="rvw-item__rvw-comment">とても美味しかったです ★4.5 2026/3/15訪問 また行きたい</div>`;
    const tabelog = WHITELIST_ADAPTERS.find(a => a.name === 'tabelog')!;
    const result = extractWhitelistedContent(document.body, tabelog);
    expect(result).toContain('とても美味しかったです');
    expect(result).toContain('また行きたい');
    expect(result).not.toContain('★4.5');
    expect(result).not.toContain('2026/3/15訪問');
    document.body.innerHTML = '';
  });

  it('extracts Wikipedia article body and excludes navigation/edit links', () => {
    document.body.innerHTML = `
      <div id="mw-content-text">
        <div class="mw-parser-output">
          <p>これはWikipediaの記事本文です。非常に有用な情報が含まれています。</p>
          <div class="toc">目次</div>
          <p>さらに続きの記事本文があります。独自研究なしで記述されています。</p>
          <div class="mw-editsection">[編集]</div>
          <div class="reflist">[1] 出典</div>
          <div class="navbox">関連プロジェクト</div>
        </div>
      </div>`;
    const wikipedia = WHITELIST_ADAPTERS.find(a => a.name === 'wikipedia')!;
    const result = extractWhitelistedContent(document.body, wikipedia);
    expect(result).toContain('これはWikipediaの記事本文です');
    expect(result).toContain('さらに続きの記事本文があります');
    expect(result).not.toContain('[編集]');
    expect(result).not.toContain('出典');
    expect(result).not.toContain('関連プロジェクト');
    expect(result).not.toContain('目次');
    document.body.innerHTML = '';
  });

  it('extracts CNN.co.jp article body and excludes sidebar/social/navigation', () => {
    document.body.innerHTML = `
      <div id="leaf-body">
        <p>CNNの記事本文です。世界の最新ニュースがここにあります。</p>
        <p>さらに詳しく解説します。</p>
      </div>
      <div class="story-sns-top">SNS</div>
      <div class="story-tag">タグ</div>
      <div class="pagination">ページネーション</div>
      <div id="related_stories">関連記事</div>`;
    const cnn = WHITELIST_ADAPTERS.find(a => a.name === 'cnn-jp')!;
    const result = extractWhitelistedContent(document.body, cnn);
    expect(result).toContain("CNNの記事本文です");
    expect(result).toContain("さらに詳しく解説します");
    expect(result).not.toContain('SNS');
    expect(result).not.toContain('タグ');
    expect(result).not.toContain('ページネーション');
    expect(result).not.toContain('関連記事');
    document.body.innerHTML = '';
  });
});
