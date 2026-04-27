// 本文らしさスコアを計算する
export function calculateReadabilityScore(element: Element): number {
    let score = 0;
    const text = element.textContent || '';

    // テキスト量（文字数）
    score += Math.min(text.length / 10, 300);

    // <p>タグの数（記事本文の主要マーカー）
    score += element.querySelectorAll('p').length * 25;

    // 見出しの存在
    score += element.querySelectorAll('h1,h2,h3,h4,h5,h6').length * 50;

    // class/id名によるスコア補正
    const identifier = `${element.className} ${element.id}`.toLowerCase();
    
    const positivePatterns = ['article', 'content', 'body', 'text', 'post', 'story', 'main', 'entry'];
    const negativePatterns = ['nav', 'menu', 'sidebar', 'footer', 'comment', 'ad', 'banner', 'widget'];
    
    for (const pat of positivePatterns) {
        if (identifier.includes(pat)) score += 50;
    }
    for (const pat of negativePatterns) {
        if (identifier.includes(pat)) score -= 50;
    }

    // リンク密度（高いとスコアを下げる）
    const links = element.querySelectorAll('a');
    const linkText = Array.from(links).reduce((sum, a) => sum + (a.textContent?.length ?? 0), 0);
    const linkRatio = text.length > 0 ? linkText / text.length : 0;
    if (linkRatio > 0.5) {
        score *= 0.5;
    }

    return score;
}