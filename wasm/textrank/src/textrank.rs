//! TextRank sentence extraction, an exact port of `extractSentences` /
//! `buildSentenceGraph` / `textRank` from `src/utils/sentenceExtractor.ts`.
//!
//! Parity contracts kept identical to the TS original:
//! - the early return when `sentences.len() <= topK` (no minLength filter, no cap),
//! - the three-branch selection of the sentence list fed into the graph,
//! - the `MAX_SENTENCES_FOR_TEXTRANK` (VULN-051) cap applied AFTER selection
//!   (see `src/utils/computeLimits.ts` — 200; enforced here too so the WASM
//!   path cannot become a cap bypass),
//! - PageRank constants (damping 0.85, 100 iterations, 1e-4 convergence),
//! - float operation order and iteration order, and the stable
//!   score-descending sort (ties keep sentence order),
//! - the `useAllSentencesFallback` output minLength filter with the
//!   `sorted.slice(0, topK)` re-fallback.

use crate::jsstring::{js_trim, split_sentence_ranges};
use crate::tokenize::{jaccard_similarity, to_word_set, WordSet};

const MAX_SENTENCES_FOR_TEXTRANK: usize = 200;
const DAMPING_FACTOR: f64 = 0.85;
const MAX_ITERATIONS: usize = 100;
const CONVERGENCE_THRESHOLD: f64 = 0.0001;

/// Extracted result: `indices` into `splitSentences(text)` of the selected
/// sentences, in selection order, plus `sentence_count` — the total number
/// of sentences the core split the text into. Returning indices (not
/// strings) keeps the JS↔WASM transfer to a small number array; the TS
/// wrapper maps them back over its own (identical) sentence split, using
/// `sentence_count` to detect any split disagreement between the two
/// implementations before mapping.
pub fn extract_core(
    units: &[u16],
    top_k: usize,
    min_length: usize,
    similarity_threshold: f64,
) -> (Vec<u32>, usize) {
    if js_trim(units).is_empty() {
        return (Vec::new(), 0);
    }

    let ranges = split_sentence_ranges(units);
    let n = ranges.len();
    if n == 0 {
        return (Vec::new(), 0);
    }
    if n <= top_k {
        return ((0..n as u32).collect(), n);
    }

    let sentence_len = |i: usize| ranges[i].1 - ranges[i].0; // UTF-16 length, like JS .length

    let valid: Vec<usize> = (0..n).filter(|&i| sentence_len(i) >= min_length).collect();

    let (selection, use_all_fallback): (Vec<usize>, bool) = if valid.is_empty() {
        ((0..n).collect(), true)
    } else if valid.len() <= top_k {
        ((0..n).collect(), false)
    } else {
        (valid, false)
    };

    // VULN-051 cap, applied after selection exactly like the TS slice.
    let selection: Vec<usize> = if selection.len() > MAX_SENTENCES_FOR_TEXTRANK {
        selection[..MAX_SENTENCES_FOR_TEXTRANK].to_vec()
    } else {
        selection
    };

    // Tokenize once per node; the O(n^2) matrix then reuses the sets instead
    // of re-tokenizing each pair (the TS original rebuilds two Sets per pair).
    let m = selection.len();
    let word_sets: Vec<WordSet> = selection
        .iter()
        .map(|&i| to_word_set(&units[ranges[i].0..ranges[i].1]))
        .collect();

    // Adjacency lists; the i<j double loop pushes in ascending order on both
    // sides, matching the TS graph's neighbor order (which PageRank's float
    // summation order depends on).
    let mut graph: Vec<Vec<usize>> = vec![Vec::new(); m];
    for i in 0..m {
        for j in (i + 1)..m {
            let sim = jaccard_similarity(&word_sets[i], &word_sets[j]);
            if sim >= similarity_threshold {
                graph[i].push(j);
                graph[j].push(i);
            }
        }
    }

    let scores = page_rank(&graph);

    // Stable sort by score descending; ties keep sentence order (JS
    // Array.prototype.sort is stable and entries start in index order).
    let mut ranked: Vec<(usize, f64)> = selection.iter().copied().zip(scores).collect();
    ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    let selected: Vec<u32> = ranked
        .iter()
        .take(top_k)
        // ranked already carries the ORIGINAL sentence index; re-indexing
        // through `selection` here would double-map (bug caught by the
        // JS-parity suite: selection [2,3,4,5,7] returned [4,5]).
        .map(|&(idx, _)| idx as u32)
        .collect();

    if use_all_fallback {
        let filtered: Vec<u32> = selected
            .iter()
            .copied()
            .filter(|&idx| sentence_len(idx as usize) >= min_length)
            .collect();
        if !filtered.is_empty() {
            return (filtered, n);
        }
    }
    (selected, n)
}

/// PageRank with the TS constants and iteration/summation order.
fn page_rank(graph: &[Vec<usize>]) -> Vec<f64> {
    let n = graph.len();
    if n == 0 {
        return Vec::new();
    }
    if n == 1 {
        return vec![1.0];
    }

    let n_f = n as f64;
    let mut scores = vec![1.0 / n_f; n];
    let mut new_scores = vec![0.0; n];

    for _ in 0..MAX_ITERATIONS {
        let mut max_diff = 0.0f64;
        for i in 0..n {
            let neighbors = &graph[i];
            let new_score = if neighbors.is_empty() {
                (1.0 - DAMPING_FACTOR) / n_f
            } else {
                let mut sum = 0.0;
                for &j in neighbors {
                    let out_degree = graph[j].len();
                    if out_degree > 0 {
                        sum += scores[j] / out_degree as f64;
                    }
                }
                (1.0 - DAMPING_FACTOR) / n_f + DAMPING_FACTOR * sum
            };
            let diff = (new_score - scores[i]).abs();
            if diff > max_diff {
                max_diff = diff;
            }
            new_scores[i] = new_score;
        }
        scores.copy_from_slice(&new_scores);
        if max_diff < CONVERGENCE_THRESHOLD {
            break;
        }
    }
    scores
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u16_of(s: &str) -> Vec<u16> {
        s.encode_utf16().collect()
    }

    fn extract(text: &str, top_k: usize, min_length: usize, threshold: f64) -> Vec<u32> {
        extract_core(&u16_of(text), top_k, min_length, threshold).0
    }

    #[test]
    fn fewer_sentences_than_top_k_returns_all() {
        let text = "One. Two. Three.";
        assert_eq!(extract(text, 10, 20, 0.3), vec![0, 1, 2]);
    }

    #[test]
    fn empty_and_whitespace_return_empty() {
        assert!(extract("", 10, 20, 0.3).is_empty());
        assert!(extract("   \n\t", 10, 20, 0.3).is_empty());
    }

    #[test]
    fn no_valid_sentences_uses_all_with_output_filter() {
        // All sentences are shorter than min_length=50 → useAllSentencesFallback:
        // extract over all, the output filter drops everything, and the TS
        // re-fallback (`sorted.slice(0, topK)`) returns the unfiltered
        // top-ranked sentence — here the first (PageRank-symmetric pair).
        let text = "Short one. Another short. Tiny.";
        let out = extract(text, 1, 50, 0.3);
        assert_eq!(out, vec![0]);
    }

    #[test]
    fn similarity_identical_sentences_all_win() {
        // Three identical long sentences (>= min length) + fillers: identical
        // sentences get Jaccard 1.0 edges and symmetric PageRank — selection
        // must still be deterministic (stable tie order = sentence order).
        let text = "This is a fairly long repeated sentence about rust. \
                    This is a fairly long repeated sentence about rust. \
                    This is a fairly long repeated sentence about rust. \
                    The last filler sentence differs from all others entirely.";
        let out = extract(text, 2, 20, 0.3);
        assert_eq!(out, vec![0, 1]);
    }

    #[test]
    fn cap_limits_graph_input() {
        // 201 sentences, top_k 10, min_length 1 → cap keeps the first 200.
        let text = (0..201).map(|i| format!("Sentence number {i} here.")).collect::<String>();
        let out = extract(&text, 10, 1, 0.3);
        assert_eq!(out.len(), 10);
        // All selected indices are within the capped first 200 sentences.
        assert!(out.iter().all(|&i| i < 200));
    }

    #[test]
    fn japanese_extraction_runs() {
        let text = "これは最初の文です。本文は日本語で書かれており、十分な長さがあります。\
                    三文目も同様に長さを持たせています。最後の文です。";
        let out = extract(text, 2, 10, 0.3);
        assert_eq!(out.len(), 2);
    }

    #[test]
    fn pagerank_single_node() {
        assert_eq!(page_rank(&[vec![]]), vec![1.0]);
        assert!(page_rank(&[]).is_empty());
    }
}
