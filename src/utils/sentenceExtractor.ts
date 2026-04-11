/**
 * sentenceExtractor.ts
 * L0 Extractive Compression using TextRank algorithm
 * Based on Mihalcea & Tarau (2004) - TextRank: Bringing Order into Text
 * 
 * Features:
 * - Jaccard/bigram similarity for Japanese and English
 * - PageRank-based sentence ranking
 * - Configurable extraction options
 */

export interface ExtractOptions {
  /** Number of sentences to extract (default: 10) */
  topK?: number;
  /** Minimum sentence length in characters (default: 20) */
  minLength?: number;
  /** Similarity threshold for graph edges (default: 0.3) */
  similarityThreshold?: number;
  /** Use embedding-based similarity (default: false, not implemented) */
  useEmbedding?: boolean;
}

const DEFAULT_OPTIONS: Required<ExtractOptions> = {
  topK: 10,
  minLength: 20,
  similarityThreshold: 0.3,
  useEmbedding: false
};

/**
 * Split text into sentences
 * Supports Japanese (。！？) and English (.!?)
 */
export function splitSentences(text: string): string[] {
  if (!text || !text.trim()) {
    return [];
  }

  const result: string[] = [];
  const regex = /([。！？.!?])\s*/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const sentence = text.slice(lastIndex, match.index + match[1].length).trim();
      if (sentence) {
        result.push(sentence);
      }
    }
    lastIndex = match.index + match[1].length;
  }

  // Handle remaining text without punctuation
  if (lastIndex < text.length) {
    const remaining = text.slice(lastIndex).trim();
    if (remaining) {
      result.push(remaining);
    }
  }

  return result;
}

/**
 * Check if text contains Japanese characters
 */
function containsJapanese(text: string): boolean {
  return /[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff]/.test(text);
}

/**
 * Get character bigrams from text (useful for Japanese similarity)
 */
function getBigrams(text: string): string[] {
  const bigrams: string[] = [];
  for (let i = 0; i < text.length - 1; i++) {
    bigrams.push(text[i] + text[i + 1]);
  }
  return bigrams;
}

/**
 * Convert text to word set for similarity calculation
 */
function toWordSet(text: string): Set<string> {
  const cleaned = text.toLowerCase();
  const words = cleaned
    .split(/[\s\u3000\u3001\u3002\uff0c\uff0e\uff01\uff1f、。，．！？,.!?\-_:;()\[\]{}""''\u300c\u300d]+/)
    .filter(w => w.length >= 2);

  if (containsJapanese(cleaned)) {
    words.push(...getBigrams(cleaned));
  }

  return new Set(words);
}

/**
 * Calculate Jaccard similarity between two texts
 * J(A, B) = |A ∩ B| / |A ∪ B|
 */
export function calculateSimilarity(s1: string, s2: string): number {
  if (!s1 || !s2) {
    return 0.0;
  }

  const set1 = toWordSet(s1);
  const set2 = toWordSet(s2);

  if (set1.size === 0 && set2.size === 0) {
    return 1.0;
  }
  if (set1.size === 0 || set2.size === 0) {
    return 0.0;
  }

  let intersection = 0;
  for (const word of set1) {
    if (set2.has(word)) {
      intersection++;
    }
  }

  const union = set1.size + set2.size - intersection;
  return intersection / union;
}

/**
 * Build similarity graph from sentences
 * Nodes = sentences, Edges = similarity above threshold
 */
export function buildSentenceGraph(
  sentences: string[],
  threshold: number = 0.3
): Map<string, number[]> {
  const graph = new Map<string, number[]>();
  const n = sentences.length;

  // Initialize graph
  for (let i = 0; i < n; i++) {
    graph.set(sentences[i], []);
  }

  // Build edges based on similarity
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const sim = calculateSimilarity(sentences[i], sentences[j]);
      if (sim >= threshold) {
        // Add edge (bidirectional)
        graph.get(sentences[i])!.push(j);
        graph.get(sentences[j])!.push(i);
      }
    }
  }

  return graph;
}

/**
 * TextRank algorithm for sentence importance
 * Based on PageRank with damping factor 0.85
 */
export function textRank(graph: Map<string, number[]>): Map<string, number> {
  const nodes = Array.from(graph.keys());
  const n = nodes.length;

  if (n === 0) {
    return new Map();
  }

  if (n === 1) {
    return new Map([[nodes[0], 1.0]]);
  }

  const dampingFactor = 0.85;
  const maxIterations = 100;
  const convergenceThreshold = 0.0001;

  // Initialize scores
  const scores = new Map<string, number>();
  nodes.forEach(node => scores.set(node, 1.0 / n));

  // Iterative PageRank calculation
  for (let iter = 0; iter < maxIterations; iter++) {
    const newScores = new Map<string, number>();
    let maxDiff = 0;

    for (let i = 0; i < n; i++) {
      const node = nodes[i];
      const neighbors = graph.get(node) || [];

      if (neighbors.length === 0) {
        newScores.set(node, (1 - dampingFactor) / n);
        continue;
      }

      // Sum of scores from incoming edges, weighted by out-degree
      let sum = 0;
      for (const neighborIdx of neighbors) {
        const neighbor = nodes[neighborIdx];
        const neighborNeighbors = graph.get(neighbor) || [];
        const outDegree = neighborNeighbors.length;
        if (outDegree > 0) {
          sum += (scores.get(neighbor) || 0) / outDegree;
        }
      }

      const newScore = (1 - dampingFactor) / n + dampingFactor * sum;
      newScores.set(node, newScore);

      const diff = Math.abs(newScore - (scores.get(node) || 0));
      if (diff > maxDiff) {
        maxDiff = diff;
      }
    }

    // Update scores
    nodes.forEach(node => {
      scores.set(node, newScores.get(node) || 0);
    });

    // Check convergence
    if (maxDiff < convergenceThreshold) {
      break;
    }
  }

  return scores;
}

/**
 * Extract top K important sentences from text using TextRank
 */
export function extractSentences(
  text: string,
  options: ExtractOptions = {}
): string[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (!text || !text.trim()) {
    return [];
  }

  // Split into sentences
  const sentences = splitSentences(text);
  if (sentences.length <= opts.topK) {
    return sentences;
  }

  // Filter by minimum length
  const validSentences = sentences.filter(s => s.length >= opts.minLength);
  
  // Determine which sentences to use for extraction
  let sentencesForExtraction: string[];
  let useAllSentencesFallback = false;
  
  if (validSentences.length === 0) {
    // No valid sentences meet minLength, use all sentences but apply minLength to output
    sentencesForExtraction = sentences;
    useAllSentencesFallback = true;
  } else if (validSentences.length <= opts.topK) {
    // Not enough valid sentences, use all for extraction
    sentencesForExtraction = sentences;
  } else {
    sentencesForExtraction = validSentences;
  }

  // Build similarity graph
  const graph = buildSentenceGraph(sentencesForExtraction, opts.similarityThreshold);

  // Run TextRank
  const scores = textRank(graph);

  // Sort by score and get top K
  const sorted = Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, opts.topK)
    .map(([sentence]) => sentence);

  // Filter output by minLength if using fallback
  const finalResult = useAllSentencesFallback 
    ? sorted.filter(s => s.length >= opts.minLength)
    : sorted;

  return finalResult.length > 0 ? finalResult : sorted.slice(0, opts.topK);
}

/**
 * Get compression statistics
 */
export interface CompressionStats {
  originalLength: number;
  extractedLength: number;
  compressionRatio: number;
  sentenceCount: number;
  extractedCount: number;
}

export function getCompressionStats(
  text: string,
  extractedSentences: string[]
): CompressionStats {
  const encoder = new TextEncoder();
  const originalLength = encoder.encode(text).length;
  const extractedLength = encoder.encode(extractedSentences.join('\n')).length;
  const sentenceCount = splitSentences(text).length;

  return {
    originalLength,
    extractedLength,
    compressionRatio: originalLength > 0 ? originalLength / extractedLength : 0,
    sentenceCount,
    extractedCount: extractedSentences.length
  };
}