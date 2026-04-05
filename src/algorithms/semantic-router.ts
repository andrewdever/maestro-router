/**
 * @maestro/router — Semantic Router (Embedding-based intent classification)
 *
 * Ported from Aurelio AI's Semantic Router (MIT, 3.4K stars).
 * https://github.com/aurelio-labs/semantic-router
 *
 * Classifies task intent via vector similarity, enabling the router to match
 * tasks to specialized model configurations by semantic meaning rather than
 * keyword rules.
 *
 * Algorithm:
 *   1. Tokenize input text into words (whitespace + punctuation split, lowercased)
 *   2. Build TF-IDF-like vectors for utterances and input
 *   3. Compute cosine similarity between input vector and each route's utterance vectors
 *   4. Return the best match above a configurable threshold
 *
 * ZERO external dependencies — pure TypeScript math.
 *
 * @example
 * ```typescript
 * import { createDefaultRouter } from './semantic-router.js';
 *
 * const router = createDefaultRouter();
 * const match = router.classify('can you review this pull request?');
 * // { route: 'code-review', score: 0.72, metadata: { ... } }
 * ```
 *
 * @packageDocumentation
 */

// ── Types ─────────────────────────────────────────────────────────

/**
 * A route definition: a named category with example utterances.
 *
 * The router compares input text against these utterances using
 * cosine similarity on bag-of-words TF vectors. More utterances
 * per route improves classification accuracy.
 */
export interface Route {
  /** Unique name for this route (e.g. 'code-review', 'analysis'). */
  name: string;
  /** Example utterances that represent this route's intent. */
  utterances: string[];
  /** Optional metadata carried through to the RouteMatch result. */
  metadata?: Record<string, unknown>;
}

/**
 * The result of classifying input text against routes.
 *
 * Returned by `SemanticRouter.classify()` when a match exceeds
 * the configured similarity threshold.
 */
export interface RouteMatch {
  /** The matched route name. */
  route: string;
  /** Cosine similarity score (0-1). Higher = better match. */
  score: number;
  /** Metadata from the matched route, if any. */
  metadata?: Record<string, unknown>;
}

// ── Stop Words ────────────────────────────────────────────────────

/**
 * Common English stop words filtered during tokenization.
 *
 * Removing these improves classification accuracy by focusing
 * on semantically meaningful terms rather than function words.
 */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
  'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
  'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
  'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
  'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
  'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
  'just', 'because', 'but', 'and', 'or', 'if', 'while', 'about',
  'up', 'that', 'this', 'these', 'those', 'am', 'it', 'its', 'i',
  'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', 'your',
  'yours', 'yourself', 'yourselves', 'he', 'him', 'his', 'himself',
  'she', 'her', 'hers', 'herself', 'they', 'them', 'their', 'theirs',
  'themselves', 'what', 'which', 'who', 'whom', 'when', 'where',
]);

// ── Tokenization ──────────────────────────────────────────────────

/**
 * Tokenize text into lowercase words, stripping punctuation and stop words.
 *
 * The tokenizer applies a simple pipeline:
 *   1. Convert to lowercase
 *   2. Replace non-alphanumeric characters (except hyphens) with spaces
 *   3. Split on whitespace
 *   4. Filter out stop words and single-character tokens
 *
 * This is intentionally simple — production semantic routers use
 * subword tokenizers (BPE, SentencePiece), but bag-of-words with
 * TF-IDF weighting works surprisingly well for intent classification.
 *
 * @param text - The input text to tokenize
 * @returns Array of lowercase, filtered tokens
 *
 * @example
 * ```typescript
 * tokenize('Can you review this PR?')
 * // ['review', 'pr']
 * ```
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\-\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

// ── Vocabulary ────────────────────────────────────────────────────

/**
 * Build a deduplicated, sorted vocabulary from all route utterances.
 *
 * The vocabulary defines the vector space dimensions. Each unique
 * token across all routes becomes one dimension in the bag-of-words
 * vector. Sorting ensures deterministic vector construction.
 *
 * @param routes - All registered routes
 * @returns Sorted array of unique tokens forming the vocabulary
 *
 * @example
 * ```typescript
 * const vocab = buildVocabulary([
 *   { name: 'greeting', utterances: ['hello world', 'hi there'] },
 * ]);
 * // ['hello', 'hi', 'there', 'world']
 * ```
 */
export function buildVocabulary(routes: Route[]): string[] {
  const vocabSet = new Set<string>();
  for (const route of routes) {
    for (const utterance of route.utterances) {
      const tokens = tokenize(utterance);
      for (const token of tokens) {
        vocabSet.add(token);
      }
    }
  }
  return Array.from(vocabSet).sort();
}

// ── Vectorization ─────────────────────────────────────────────────

/**
 * Convert a token list into a bag-of-words term-frequency (TF) vector.
 *
 * Each dimension corresponds to a vocabulary term. The value is the
 * raw term frequency (count of occurrences). This produces a sparse
 * vector suitable for cosine similarity comparison.
 *
 * For intent classification with short utterances, raw TF performs
 * comparably to TF-IDF because document frequency is relatively
 * uniform across short phrases.
 *
 * @param tokens - Tokenized input text
 * @param vocabulary - The global vocabulary (defines vector dimensions)
 * @returns Numeric vector of term frequencies, aligned with vocabulary indices
 *
 * @example
 * ```typescript
 * const vocab = ['code', 'hello', 'review', 'world'];
 * vectorize(['review', 'code', 'review'], vocab);
 * // [1, 0, 2, 0]
 * ```
 */
export function vectorize(tokens: string[], vocabulary: string[]): number[] {
  const vector = new Array<number>(vocabulary.length).fill(0);
  const vocabIndex = new Map<string, number>();
  for (let i = 0; i < vocabulary.length; i++) {
    vocabIndex.set(vocabulary[i], i);
  }
  for (const token of tokens) {
    const idx = vocabIndex.get(token);
    if (idx !== undefined) {
      vector[idx]++;
    }
  }
  return vector;
}

// ── IDF Computation ───────────────────────────────────────────────

/**
 * Compute Inverse Document Frequency weights for the vocabulary.
 *
 * IDF measures how informative a term is across all utterances.
 * Common terms (appearing in many utterances) get lower weights,
 * while rare terms get higher weights.
 *
 * Formula: IDF(t) = log(N / (1 + df(t))) + 1
 * Where N = total number of utterances, df(t) = number of utterances containing term t.
 * The +1 in the denominator prevents division by zero.
 * The +1 outside the log ensures all weights are positive.
 *
 * @param routes - All registered routes
 * @param vocabulary - The global vocabulary
 * @returns Array of IDF weights aligned with vocabulary indices
 */
function computeIDF(routes: Route[], vocabulary: string[]): number[] {
  const vocabIndex = new Map<string, number>();
  for (let i = 0; i < vocabulary.length; i++) {
    vocabIndex.set(vocabulary[i], i);
  }

  // Count total utterances and document frequency per term
  let totalUtterances = 0;
  const docFrequency = new Array<number>(vocabulary.length).fill(0);

  for (const route of routes) {
    for (const utterance of route.utterances) {
      totalUtterances++;
      const tokens = new Set(tokenize(utterance));
      for (const token of tokens) {
        const idx = vocabIndex.get(token);
        if (idx !== undefined) {
          docFrequency[idx]++;
        }
      }
    }
  }

  // Compute IDF: log(N / (1 + df)) + 1
  const idf = new Array<number>(vocabulary.length);
  for (let i = 0; i < vocabulary.length; i++) {
    idf[i] = Math.log(totalUtterances / (1 + docFrequency[i])) + 1;
  }

  return idf;
}

/**
 * Apply TF-IDF weighting to a raw TF vector.
 *
 * Multiplies each term frequency by its IDF weight, producing
 * a vector that emphasizes distinctive terms over common ones.
 *
 * @param tfVector - Raw term-frequency vector
 * @param idfWeights - IDF weights aligned with vocabulary
 * @returns TF-IDF weighted vector
 */
function applyTFIDF(tfVector: number[], idfWeights: number[]): number[] {
  const result = new Array<number>(tfVector.length);
  for (let i = 0; i < tfVector.length; i++) {
    result[i] = tfVector[i] * idfWeights[i];
  }
  return result;
}

// ── Cosine Similarity ─────────────────────────────────────────────

/**
 * Compute cosine similarity between two numeric vectors.
 *
 * Cosine similarity measures the angle between two vectors,
 * producing a value between -1 and 1 (0 to 1 for non-negative
 * TF vectors). A value of 1 means identical direction (perfect match),
 * 0 means orthogonal (no similarity).
 *
 * Formula: cos(θ) = (A · B) / (‖A‖ × ‖B‖)
 *
 * Returns 0 if either vector has zero magnitude (prevents NaN).
 *
 * @param a - First vector
 * @param b - Second vector (must be same length as a)
 * @returns Cosine similarity score between 0 and 1 (for non-negative vectors)
 *
 * @example
 * ```typescript
 * cosineSimilarity([1, 0, 1], [1, 0, 1]); // 1.0
 * cosineSimilarity([1, 0, 0], [0, 1, 0]); // 0.0
 * cosineSimilarity([1, 1, 0], [1, 0, 1]); // 0.5
 * ```
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `Vector dimension mismatch: ${a.length} vs ${b.length}. ` +
      'Both vectors must use the same vocabulary.',
    );
  }

  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    magnitudeA += a[i] * a[i];
    magnitudeB += b[i] * b[i];
  }

  magnitudeA = Math.sqrt(magnitudeA);
  magnitudeB = Math.sqrt(magnitudeB);

  // Prevent division by zero — zero-magnitude vectors have no direction
  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0;
  }

  return dotProduct / (magnitudeA * magnitudeB);
}

// ── Precomputed Route Data ────────────────────────────────────────

/**
 * Internal representation of a route with precomputed TF-IDF vectors
 * for each utterance. Avoids recomputing on every classify() call.
 */
interface CompiledRoute {
  /** Original route definition. */
  route: Route;
  /** Precomputed TF-IDF vectors for each utterance. */
  utteranceVectors: number[][];
  /** Centroid vector (average of all utterance vectors). */
  centroid: number[];
}

// ── SemanticRouter ────────────────────────────────────────────────

/**
 * Embedding-based intent classifier using TF-IDF cosine similarity.
 *
 * The SemanticRouter classifies input text against a set of named routes,
 * each defined by example utterances. Classification works by:
 *
 *   1. Building a shared vocabulary across all route utterances
 *   2. Computing TF-IDF vectors for each utterance
 *   3. For each route, computing a centroid vector (average of its utterances)
 *   4. On classify(), vectorizing the input and finding the closest route centroid
 *
 * This approach is inspired by Aurelio's Semantic Router, which uses dense
 * embeddings from transformer models. Our implementation substitutes sparse
 * TF-IDF vectors — less accurate on nuanced language, but zero-dependency,
 * deterministic, and fast enough for routing decisions.
 *
 * Performance characteristics:
 * - Vocabulary size: O(V) where V = unique tokens across all utterances
 * - Classification: O(R × V) where R = number of routes
 * - Memory: O(R × U × V) where U = utterances per route
 * - Typical: <1ms for classify() with <20 routes
 *
 * @example
 * ```typescript
 * const router = new SemanticRouter({ threshold: 0.3 });
 *
 * router.addRoute({
 *   name: 'code-review',
 *   utterances: [
 *     'review this code',
 *     'check the pull request',
 *     'code quality feedback',
 *   ],
 * });
 *
 * const match = router.classify('please review my PR');
 * // { route: 'code-review', score: 0.68 }
 * ```
 */
export class SemanticRouter {
  /** Registered routes. */
  private routes: Route[] = [];

  /** Compiled route data with precomputed vectors. */
  private compiled: CompiledRoute[] = [];

  /** Global vocabulary (sorted unique tokens). */
  private vocabulary: string[] = [];

  /** IDF weights aligned with vocabulary. */
  private idfWeights: number[] = [];

  /**
   * Minimum cosine similarity score for a match to be returned.
   * Range: 0-1. Default: 0.3.
   * Lower values = more permissive matching, higher = stricter.
   */
  private readonly threshold: number;

  /** Flag indicating compiled data is stale and needs rebuilding. */
  private dirty = true;

  /**
   * Create a new SemanticRouter.
   *
   * @param options - Configuration options
   * @param options.threshold - Minimum similarity score for a match (default: 0.3)
   */
  constructor(options: { threshold?: number } = {}) {
    this.threshold = options.threshold ?? 0.3;
  }

  /**
   * Register a route with example utterances.
   *
   * Adding a route invalidates the compiled vocabulary and vectors.
   * Recompilation happens lazily on the next `classify()` call.
   *
   * @param route - Route definition with name and utterances
   * @throws Error if route name is empty or utterances array is empty
   *
   * @example
   * ```typescript
   * router.addRoute({
   *   name: 'summarization',
   *   utterances: ['summarize this', 'give me a TL;DR', 'brief overview'],
   *   metadata: { effort: 'minimal' },
   * });
   * ```
   */
  addRoute(route: Route): void {
    if (!route.name || route.name.trim().length === 0) {
      throw new Error('Route name must be a non-empty string.');
    }
    if (!route.utterances || route.utterances.length === 0) {
      throw new Error(
        `Route '${route.name}' must have at least one utterance.`,
      );
    }
    this.routes.push({ ...route, utterances: [...route.utterances] });
    this.dirty = true;
  }

  /**
   * Remove a route by name.
   *
   * @param name - The route name to remove
   * @returns True if a route was removed, false if not found
   */
  removeRoute(name: string): boolean {
    const before = this.routes.length;
    this.routes = this.routes.filter((r) => r.name !== name);
    if (this.routes.length !== before) {
      this.dirty = true;
      return true;
    }
    return false;
  }

  /**
   * Get all registered route names.
   *
   * @returns Array of route names
   */
  getRouteNames(): string[] {
    return this.routes.map((r) => r.name);
  }

  /**
   * Classify input text against registered routes.
   *
   * Tokenizes the input, builds a TF-IDF vector, and computes cosine
   * similarity against each route's centroid vector. Returns the best
   * match if it exceeds the threshold, or null if no route matches.
   *
   * On first call (or after adding routes), triggers a recompilation
   * of the vocabulary and route vectors. Subsequent calls reuse the
   * compiled data for fast classification.
   *
   * @param text - The input text to classify
   * @returns The best matching route with similarity score, or null if no match
   *
   * @example
   * ```typescript
   * const match = router.classify('can you review this pull request?');
   * if (match) {
   *   console.log(`Matched: ${match.route} (score: ${match.score})`);
   * } else {
   *   console.log('No route matched.');
   * }
   * ```
   */
  classify(text: string): RouteMatch | null {
    if (this.routes.length === 0) {
      return null;
    }

    // Recompile if routes have changed
    if (this.dirty) {
      this.compile();
    }

    // Tokenize and vectorize the input
    const tokens = tokenize(text);
    if (tokens.length === 0) {
      return null;
    }

    const tfVector = vectorize(tokens, this.vocabulary);
    const inputVector = applyTFIDF(tfVector, this.idfWeights);

    // Find the best matching route by cosine similarity to centroid
    let bestMatch: RouteMatch | null = null;
    let bestScore = -1;

    for (const compiled of this.compiled) {
      // Compare against centroid (average of all utterance vectors)
      const centroidScore = cosineSimilarity(inputVector, compiled.centroid);

      // Also check max similarity against individual utterances
      // This handles cases where a route has diverse utterances
      // and the centroid doesn't well-represent any single one
      let maxUtteranceScore = 0;
      for (const utteranceVector of compiled.utteranceVectors) {
        const score = cosineSimilarity(inputVector, utteranceVector);
        if (score > maxUtteranceScore) {
          maxUtteranceScore = score;
        }
      }

      // Use the higher of centroid and max-utterance scores.
      // Centroid captures the "average intent" of the route,
      // while max-utterance catches exact phrasings.
      const finalScore = Math.max(centroidScore, maxUtteranceScore);

      if (finalScore > bestScore) {
        bestScore = finalScore;
        bestMatch = {
          route: compiled.route.name,
          score: finalScore,
          metadata: compiled.route.metadata,
        };
      }
    }

    // Apply threshold filter
    if (bestMatch && bestMatch.score >= this.threshold) {
      return bestMatch;
    }

    return null;
  }

  /**
   * Classify input text and return all routes with scores above threshold,
   * sorted by descending score.
   *
   * Useful when you need to see all potential matches or implement
   * custom tie-breaking logic.
   *
   * @param text - The input text to classify
   * @returns Array of route matches sorted by score (highest first)
   */
  classifyAll(text: string): RouteMatch[] {
    if (this.routes.length === 0) {
      return [];
    }

    if (this.dirty) {
      this.compile();
    }

    const tokens = tokenize(text);
    if (tokens.length === 0) {
      return [];
    }

    const tfVector = vectorize(tokens, this.vocabulary);
    const inputVector = applyTFIDF(tfVector, this.idfWeights);

    const matches: RouteMatch[] = [];

    for (const compiled of this.compiled) {
      const centroidScore = cosineSimilarity(inputVector, compiled.centroid);

      let maxUtteranceScore = 0;
      for (const utteranceVector of compiled.utteranceVectors) {
        const score = cosineSimilarity(inputVector, utteranceVector);
        if (score > maxUtteranceScore) {
          maxUtteranceScore = score;
        }
      }

      const finalScore = Math.max(centroidScore, maxUtteranceScore);

      if (finalScore >= this.threshold) {
        matches.push({
          route: compiled.route.name,
          score: finalScore,
          metadata: compiled.route.metadata,
        });
      }
    }

    // Sort by score descending
    matches.sort((a, b) => b.score - a.score);
    return matches;
  }

  /**
   * Recompile the vocabulary, IDF weights, and route vectors.
   *
   * Called lazily when routes change. Rebuilds the entire vector
   * space from scratch. For small route sets (<100 routes), this
   * takes <1ms and is not a performance concern.
   */
  private compile(): void {
    // Rebuild vocabulary from all routes
    this.vocabulary = buildVocabulary(this.routes);

    // Compute IDF weights
    this.idfWeights = computeIDF(this.routes, this.vocabulary);

    // Compile each route: vectorize utterances and compute centroids
    this.compiled = this.routes.map((route) => {
      const utteranceVectors = route.utterances.map((utterance) => {
        const tokens = tokenize(utterance);
        const tfVector = vectorize(tokens, this.vocabulary);
        return applyTFIDF(tfVector, this.idfWeights);
      });

      // Compute centroid (element-wise average of all utterance vectors)
      const centroid = new Array<number>(this.vocabulary.length).fill(0);
      if (utteranceVectors.length > 0) {
        for (const vec of utteranceVectors) {
          for (let i = 0; i < vec.length; i++) {
            centroid[i] += vec[i];
          }
        }
        for (let i = 0; i < centroid.length; i++) {
          centroid[i] /= utteranceVectors.length;
        }
      }

      return { route, utteranceVectors, centroid };
    });

    this.dirty = false;
  }
}

// ── Default Routes ────────────────────────────────────────────────

/**
 * Predefined routes for common AI task types.
 *
 * These capture the most frequent intent categories in orchestration
 * scenarios. Each route has diverse utterances to improve classification
 * coverage across different phrasings.
 */
const DEFAULT_ROUTES: Route[] = [
  {
    name: 'code-review',
    utterances: [
      'review this code',
      'check the pull request',
      'code quality feedback',
      'review my PR',
      'look over these changes',
      'find bugs in this code',
      'code review for this diff',
      'check for issues in my implementation',
      'audit this code',
      'review the code changes',
      'PR review needed',
      'assess code quality',
    ],
    metadata: { effort: 'standard', category: 'review' },
  },
  {
    name: 'code-generation',
    utterances: [
      'write code for this',
      'implement this feature',
      'create a function that',
      'code this up',
      'build a component',
      'generate the implementation',
      'write a script to',
      'implement the following',
      'create a new module',
      'write the handler for',
      'scaffold this feature',
      'coding task',
    ],
    metadata: { effort: 'standard', category: 'generation' },
  },
  {
    name: 'analysis',
    utterances: [
      'analyze this data',
      'investigate the issue',
      'research this topic',
      'look into why',
      'debug this problem',
      'figure out what went wrong',
      'root cause analysis',
      'deep dive into',
      'examine the logs',
      'trace the error',
      'explore the codebase',
      'understand how this works',
    ],
    metadata: { effort: 'deep', category: 'analysis' },
  },
  {
    name: 'summarization',
    utterances: [
      'summarize this',
      'give me a TLDR',
      'brief overview',
      'short summary',
      'key points from',
      'executive summary',
      'condense this',
      'what are the main takeaways',
      'boil this down',
      'quick recap',
      'summarize the discussion',
      'highlights of',
    ],
    metadata: { effort: 'minimal', category: 'summarization' },
  },
  {
    name: 'conversation',
    utterances: [
      'lets chat about',
      'discuss this with me',
      'explain how',
      'tell me about',
      'help me understand',
      'walk me through',
      'what do you think about',
      'can we talk about',
      'describe the concept of',
      'clarify this for me',
      'teach me about',
      'explain the difference between',
    ],
    metadata: { effort: 'standard', category: 'conversation' },
  },
];

// ── Factory ───────────────────────────────────────────────────────

/**
 * Create a SemanticRouter pre-loaded with default task-type routes.
 *
 * The default routes cover the most common orchestration intents:
 * code-review, code-generation, analysis, summarization, and conversation.
 *
 * @param options - Configuration options
 * @param options.threshold - Minimum similarity score for a match (default: 0.3)
 * @returns A SemanticRouter instance with default routes registered
 *
 * @example
 * ```typescript
 * const router = createDefaultRouter();
 * const match = router.classify('summarize the meeting notes');
 * // { route: 'summarization', score: 0.81, metadata: { effort: 'minimal', ... } }
 * ```
 */
export function createDefaultRouter(
  options: { threshold?: number } = {},
): SemanticRouter {
  const router = new SemanticRouter(options);
  for (const route of DEFAULT_ROUTES) {
    router.addRoute(route);
  }
  return router;
}
