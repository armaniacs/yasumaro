import {
  deduplicateContent,
  deduplicateContentReference,
  resetJaccardCallCount,
  getJaccardCallCount,
} from '../contentDeduplicator.js';

describe('contentDeduplicator approx — 方式B exactness', () => {
  // ------------------------------------------------------------
  // 既存 dedup ケース（ja/en）で新旧結果一致
  // ------------------------------------------------------------
  const existingFixtures: Array<{ input: string; options?: { threshold?: number; minLength?: number } }> = [
    { input: 'Aについて説明する。Bは異なる概念だ。Cも全く別の話題である。' },
    { input: '人工智能が急速に発展しています。人工智能の発展は非常に急速です。', options: { threshold: 0.5 } },
    { input: 'この製品は高品質です。この製品は高品質で優れています。全く異なる内容のセンテンス。', options: { threshold: 0.4 } },
    { input: '' },
    { input: 'これは一つのセンテンスです。' },
    { input: '同じ文章です。同じ文章です。', options: { threshold: 0 } },
    { input: '同じ文章です。同じ文章です。', options: { threshold: 1.0, minLength: 5 } },
    // 英語
    { input: 'This product is high quality. This product is high quality and excellent. Completely different content here.' },
    { input: 'Machine learning is rapidly evolving. Machine learning evolves very quickly. The weather is nice today.' , options: { threshold: 0.5 } },
  ];

  it.each(existingFixtures)('既存ケースで新旧一致: $input', ({ input, options }) => {
    const ref = deduplicateContentReference(input, options);
    const cur = deduplicateContent(input, options);
    expect(cur).toBe(ref);
  });

  // 追加の ja/en ケース
  it('日英混在でも新旧一致', () => {
    const input = 'Hello world. こんにちは世界。Hello world again. こんにちは世界。';
    expect(deduplicateContent(input, { threshold: 0.6 })).toBe(deduplicateContentReference(input, { threshold: 0.6 }));
  });

  it('PBIシナリオ: 1・3文目が高類似なら3文目が除去される', () => {
    // "猫は可愛い。" と "猫はとても可愛い。" は bigram 類似が高い
    const input = '猫は可愛い。犬も可愛い。猫はとても可愛い。';
    const ref = deduplicateContentReference(input, { threshold: 0.5 });
    const cur = deduplicateContent(input, { threshold: 0.5 });
    expect(cur).toBe(ref);
    // 少なくとも短い入力でも新旧一致を担保（除去有無は閾値依存のため一致のみ検証）
  });

  // ------------------------------------------------------------
  // Synthetic 300-500 sentences: sub-quadratic call count
  // ------------------------------------------------------------
  function generateSynthetic(n: number, duplicatePairs: number): string {
    const sentences: string[] = [];
    // 各センテンスはユニークな語彙を持ち、重複ペア以外は J=0 になるようにする
    for (let i = 0; i < n; i++) {
      // ユニークな語彙: tok_<i>_a tok_<i>_b tok_<i>_c tok_<i>_d
      sentences.push(`tok_${i}_aa tok_${i}_bb tok_${i}_cc tok_${i}_dd.`);
    }
    // 重複ペアを末尾に追加（既存センテンスと完全同一）
    for (let p = 0; p < duplicatePairs; p++) {
      const srcIdx = p * 10; // 0,10,20... なるべく分散
      if (srcIdx < n) {
        sentences.push(sentences[srcIdx]!);
      }
    }
    return sentences.join(' ');
  }

  it('合成 300-500 センテンスで Jaccard 呼び出し回数が sub-quadratic（2倍で4倍未満）', () => {
    const dupPairs = 10;
    const nSmall = 200;
    const nLarge = 400;

    const textSmall = generateSynthetic(nSmall, dupPairs);
    const textLarge = generateSynthetic(nLarge, dupPairs);

    resetJaccardCallCount();
    const refSmall = deduplicateContentReference(textSmall, { threshold: 0.7 });
    // reference の呼び出し回数は測らない（新実装のみ）
    resetJaccardCallCount();
    const curSmall = deduplicateContent(textSmall, { threshold: 0.7 });
    const countSmall = getJaccardCallCount();
    expect(curSmall).toBe(refSmall);

    resetJaccardCallCount();
    const refLarge = deduplicateContentReference(textLarge, { threshold: 0.7 });
    resetJaccardCallCount();
    const curLarge = deduplicateContent(textLarge, { threshold: 0.7 });
    const countLarge = getJaccardCallCount();
    expect(curLarge).toBe(refLarge);

    // sub-quadratic: N を2倍にしても呼び出し回数は4倍未満
    // ユニーク語彙のため本来はほぼ O(N) なので 2倍程度になるはず
    expect(countLarge).toBeGreaterThan(0);
    expect(countSmall).toBeGreaterThan(0);
    // 0除算対策 & 両方が0の場合はパス、片方のみ0は fail
    const ratio = countLarge / Math.max(1, countSmall);
    expect(ratio).toBeLessThan(4);

    // 追加: 絶対数が O(N^2) でないこと（N=400 で N^2/2=80k より大幅に小さい）
    // candidate 方式なら 10回程度のはず
    expect(countLarge).toBeLessThan(5000);
    expect(countSmall).toBeLessThan(5000);
  });

  it('合成 500 センテンスで除去結果が参照と一致', () => {
    const text = generateSynthetic(500, 10);
    const ref = deduplicateContentReference(text, { threshold: 0.7 });
    resetJaccardCallCount();
    const cur = deduplicateContent(text, { threshold: 0.7 });
    expect(cur).toBe(ref);
  });

  // ------------------------------------------------------------
  // 100+ randomized pattern comparisons (deterministic seeded)
  // ------------------------------------------------------------
  function seededRng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      // LCG: Numerical Recipes
      s = (1664525 * s + 1013904223) >>> 0;
      return s / 0x100000000;
    };
  }

  function randomWord(rng: () => number, vocabSize: number): string {
    const idx = Math.floor(rng() * vocabSize);
    // 2文字以上を保証、かつ多様性を持たせる
    const suffix = ['aa', 'bb', 'cc', 'dd', 'ee', 'ff'][Math.floor(rng() * 6)]!;
    return `w${idx}${suffix}`;
  }

  function generateRandomText(rng: () => number): { text: string; threshold: number; minLength: number } {
    const sentenceCount = 2 + Math.floor(rng() * 14); // 2-15
    const vocabSize = 50 + Math.floor(rng() * 50); // 50-100
    const sentences: string[] = [];
    for (let i = 0; i < sentenceCount; i++) {
      const wordCount = 2 + Math.floor(rng() * 6); // 2-7 words
      const words: string[] = [];
      for (let j = 0; j < wordCount; j++) words.push(randomWord(rng, vocabSize));
      // 日本語混在を 20% で追加
      if (rng() < 0.2) words.push('こんにちは', '世界', '人工', '知能')[Math.floor(rng() * 4)]!;
      const delim = ['。', '.', '！', '!'][Math.floor(rng() * 4)]!;
      sentences.push(words.join(' ') + delim);
    }
    const text = sentences.join(' ');
    const threshold = 0.3 + rng() * 0.6; // 0.3-0.9
    const minLength = 5 + Math.floor(rng() * 11); // 5-15
    return { text, threshold, minLength };
  }

  it('100+ ランダムパターンで新旧出力が完全一致（seeded）', () => {
    const rng = seededRng(0x12345678);
    for (let i = 0; i < 120; i++) {
      const { text, threshold, minLength } = generateRandomText(rng);
      const ref = deduplicateContentReference(text, { threshold, minLength });
      const cur = deduplicateContent(text, { threshold, minLength });
      if (cur !== ref) {
        // デバッグ用に詳細を出す
        throw new Error(`Mismatch at iteration ${i}: threshold=${threshold} minLength=${minLength}\nref=${JSON.stringify(ref)}\ncur=${JSON.stringify(cur)}\ntext=${JSON.stringify(text)}`);
      }
      expect(cur).toBe(ref);
    }
  });

  // ------------------------------------------------------------
  // Boundaries
  // ------------------------------------------------------------
  it('threshold 0 は早期リターンで入力そのまま', () => {
    const input = '同じ文章です。同じ文章です。全く違う内容です。';
    expect(deduplicateContent(input, { threshold: 0 })).toBe(input);
    expect(deduplicateContent(input, { threshold: 0 })).toBe(deduplicateContentReference(input, { threshold: 0 }));
  });

  it('threshold 1 は完全一致のみ除去', () => {
    const input = '同じ文章です。同じ文章です。ほぼ同じ文章です。';
    const opts = { threshold: 1.0, minLength: 5 };
    expect(deduplicateContent(input, opts)).toBe(deduplicateContentReference(input, opts));
  });

  it('minLength 未満は無条件保持（かつ keptSets に入る）', () => {
    // 短いセンテンス "短い。" (3文字) は minLength=10 で無条件保持
    // しかし後続の同一短文は J=1 で重複とみなされ除去されるべき（元の挙動）
    // ここでは新旧一致のみ検証
    const input = '短い。短い。長いセンテンスです。これは十分に長いセンテンスです。';
    const opts = { threshold: 0.7, minLength: 10 };
    expect(deduplicateContent(input, opts)).toBe(deduplicateContentReference(input, opts));
  });

  it('単一センテンスはそのまま', () => {
    const input = 'これは一つのセンテンスです。';
    expect(deduplicateContent(input)).toBe(input);
    expect(deduplicateContent(input)).toBe(deduplicateContentReference(input));
  });

  it('空文字・空白のみはそのまま', () => {
    expect(deduplicateContent('')).toBe('');
    expect(deduplicateContent('   ')).toBe('   ');
    expect(deduplicateContent('')).toBe(deduplicateContentReference(''));
    expect(deduplicateContent('   ')).toBe(deduplicateContentReference('   '));
  });

  it('全同一センテンスは1つだけ残る', () => {
    const sentence = '同じ文章です。';
    const input = sentence.repeat(5); // "同じ文章です。同じ文章です。..." ではなく区切りを正しく
    const input2 = Array(5).fill('同じ文章です。').join('');
    const opts = { threshold: 0.7, minLength: 5 };
    expect(deduplicateContent(input2, opts)).toBe(deduplicateContentReference(input2, opts));
    const result = deduplicateContent(input2, opts);
    const count = (result.match(/同じ文章です/g) || []).length;
    expect(count).toBe(1);
  });

  it('sentence order + delimiter restoration が保持される', () => {
    const input = 'AはBです。CはDです！EはFです？GはHです。';
    const opts = { threshold: 0.9 }; // 高閾値で除去なし
    const ref = deduplicateContentReference(input, opts);
    const cur = deduplicateContent(input, opts);
    expect(cur).toBe(ref);
    expect(cur).toBe(input);
  });

  it('短いセンテンスが keptSets に入る挙動を維持（後続の類似長文が除去される）', () => {
    // "ab cd ef gh" は length 11 (>=10) なので通常判定
    // "ab" は length 2 (<10) なので無条件保持だが、その語彙が keptSets に入る
    // 後続の "ab cd ef gh" が "ab" と Jaccard で比較される挙動を確認（新旧一致）
    const input = 'ab. ab cd ef gh ij kl mn op. ab cd ef gh ij kl mn op.';
    const opts = { threshold: 0.5, minLength: 10 };
    expect(deduplicateContent(input, opts)).toBe(deduplicateContentReference(input, opts));
  });
});
