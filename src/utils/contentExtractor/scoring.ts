/**
 * contentExtractor スコアリング・候補探索
 * テキストスコア計算とメインコンテンツ候補要素の抽出
 */

import { isExcludedElement, isAsianContentElement } from './classifier.js';

/**
 * 要素のテキストスコアを計算
 * テキストの多さ、段落の数、リンク密度などに基づいてスコアを計算
 * 【パフォーマンス最適化】DOM走査を一度に集約し、querySelectorAll呼び出しを削減
 */
export function calculateTextScore(element: Element): number {
    let score = 0;

    // textContent (not innerText): avoids forced synchronous layout. Accepted
    // semantic change (PBI 03): display:none subtrees and script/style text
    // now count toward the score — relative ranking is unaffected in practice.
    const text = element.textContent || '';
    score += text.length;

    // 単一DOM走覧でp, h*, ul, ol, aの要素をカウント（パフォーマンス改善）
    let pCount = 0;
    let hCount = 0;
    let listCount = 0;
    let _linkCount = 0;
    let linkTextLength = 0;

    const walker = document.createTreeWalker(
        element,
        // NodeFilter.SHOW_ELEMENT is the constant 1; use the literal because
        // NodeFilter is not a global in node-env tests that stub only
        // document/window (PBI 03 made score computation eager, surfacing it).
        1,
        undefined
    );

    let node: Node | null = walker.nextNode();
    while (node) {
        const elem = node as Element;
        const tag = elem.tagName.toLowerCase();

        if (tag === 'p') {
            pCount++;
        } else if (/^h[1-7]$/.test(tag)) {
            hCount++;
        } else if (tag === 'ul' || tag === 'ol') {
            listCount++;
        } else if (tag === 'a') {
            _linkCount++;
            linkTextLength += elem.textContent?.length || 0;
        }

        node = walker.nextNode();
    }

    // スコア計算
    score += pCount * 50;      // 段落: 50点
    score += hCount * 100;     // 見出し: 100点
    score += listCount * 30;   // リスト: 30点

    // リンク密度（比率が高い場合はスコアを下げる）
    const linkRatio = text.length > 0 ? linkTextLength / text.length : 0;
    if (linkRatio > 0.5) {
        score *= 0.3; // リンクが多い要素はスコアを下げる
    }

    return score;
}

/**
 * Score each element exactly once, sort by score descending, return top `take`.
 * Exported for test observability (scoreFn injection); defaults to calculateTextScore.
 */
export function scoreAndSort(
    elements: Element[],
    take: number,
    scoreFn: (el: Element) => number = calculateTextScore,
): Element[] {
    return elements
        .map((el) => ({ el, score: scoreFn(el) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, take)
        .map((x) => x.el);
}

/**
 * Result of a guarded candidate scan (PBI 05 ①).
 *
 * `rejectedTop` is the highest-scored candidate the floor rejected — carried
 * only for diagnostics (transparent discard: candidate_bytes still measures
 * what was thrown away), never fed to extraction.
 */
export interface CandidateScanResult {
    candidates: Element[];
    rejectedTop?: Element | undefined;
}

/**
 * Adopt the first score-ordered candidate at or above the char floor.
 * All-miss → empty list (caller joins the candidate-zero body branch).
 * Off (`guardMinChars` undefined/<=0) → input order preserved untouched.
 */
function guardAdopt(sorted: Element[], guardMinChars: number | undefined): CandidateScanResult {
    if (guardMinChars === undefined || guardMinChars <= 0 || sorted.length === 0) {
        return { candidates: sorted };
    }
    const idx = sorted.findIndex((el) => (el.textContent || '').length >= guardMinChars);
    if (idx === -1) {
        return { candidates: [], rejectedTop: sorted[0] };
    }
    if (idx === 0) {
        return { candidates: sorted };
    }
    const head = sorted[idx]!;
    return { candidates: [head, ...sorted.filter((_, i) => i !== idx)] };
}

/**
 * Score, apply the floor guard, slice to `take`, and propagate rejectedTop —
 * the three scan branches differ only in `take`, so they share this step.
 */
function scanAndAdopt(candidates: Element[], guardMinChars: number | undefined, take: number): CandidateScanResult {
  const sorted = scoreAndSort(candidates, candidates.length);
  const res = guardAdopt(sorted, guardMinChars);
  const adopted = res.candidates.slice(0, take);
  return res.rejectedTop !== undefined
    ? { candidates: adopted, rejectedTop: res.rejectedTop }
    : { candidates: adopted };
}

/**
 * メインコンテンツの候補要素を抽出
 *
 * PBI 05: the optional floor is applied to the FULL score-ordered list BEFORE
 * the take-slice — the article/main branch returns take=1, so scanning the
 * returned list would never see rank 2+. `findMainContentCandidates()` keeps
 * the legacy no-guard contract as a thin wrapper.
 */
export function scanMainContentCandidates(guardMinChars?: number): CandidateScanResult {
  const candidates: Element[] = [];

  // 優先ターゲット: article, main
  const mainTags = document.querySelectorAll('article, main');
  for (const tag of mainTags) {
    if (!isExcludedElement(tag)) {
      candidates.push(tag);
    }
  }

  // 候補がある場合、最もスコアの高い要素を選択
  if (candidates.length > 0) {
    return scanAndAdopt(candidates, guardMinChars, 1);
  }

  // アジア圏のコンテンツ構造を検索
  const allElements = document.querySelectorAll('div, section');
  for (const elem of allElements) {
    if (isAsianContentElement(elem) && !isExcludedElement(elem)) {
      candidates.push(elem);
    }
  }

  // アジアコンテンツが見つかった場合、スコア順にソートして返す
  if (candidates.length > 0) {
    return scanAndAdopt(candidates, guardMinChars, 3);
  }

  // 候補がない場合、階層的に探索
  const body = document.body;
  if (!body) {
    return { candidates: [] };
  }

  // body直下の子要素を候補にする
  const directChildren = Array.from(body.children).filter(
    child => !isExcludedElement(child)
  );

  for (const child of directChildren) {
    candidates.push(child);
  }

  // スコア順にソートし、上位3候補を返す
  return scanAndAdopt(candidates, guardMinChars, 3);
}

/**
 * レガシー契約: ガードなし候補抽出（take 後のスコア順リスト）。
 */
export function findMainContentCandidates(): Element[] {
    return scanMainContentCandidates().candidates;
}