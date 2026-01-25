// Embedding Utilities for Deduplication

import { createHash } from 'crypto';
import { logger } from './logger.js';

/**
 * Calculate cosine similarity between two embeddings
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Embeddings must have the same dimensions');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (normA * normB);
}

/**
 * Calculate SHA256 hash of text (for exact matching)
 */
export function textHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Calculate Levenshtein distance (for fuzzy matching)
 */
export function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  // Initialize matrix
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  // Fill matrix
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,      // insertion
          matrix[i - 1][j] + 1       // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calculate Levenshtein similarity (0-1 range)
 */
export function levenshteinSimilarity(a: string, b: string): number {
  const distance = levenshteinDistance(a, b);
  const maxLength = Math.max(a.length, b.length);

  if (maxLength === 0) {
    return 1.0;
  }

  return 1.0 - distance / maxLength;
}

/**
 * Find similar items using embeddings
 */
export interface SimilarityResult<T> {
  item: T;
  similarity: number;
}

export function findSimilar<T>(
  query: number[],
  items: Array<{ embedding: number[]; data: T }>,
  threshold: number = 0.85,
  limit?: number
): SimilarityResult<T>[] {
  const results: SimilarityResult<T>[] = [];

  for (const item of items) {
    const similarity = cosineSimilarity(query, item.embedding);

    if (similarity >= threshold) {
      results.push({
        item: item.data,
        similarity,
      });
    }
  }

  // Sort by similarity (descending)
  results.sort((a, b) => b.similarity - a.similarity);

  // Apply limit if specified
  if (limit && limit > 0) {
    return results.slice(0, limit);
  }

  return results;
}

/**
 * Find all pairs of similar items
 */
export interface SimilarPair<T> {
  item1: T;
  item2: T;
  similarity: number;
}

export function findSimilarPairs<T>(
  items: Array<{ embedding: number[]; data: T; id?: number }>,
  threshold: number = 0.85
): SimilarPair<T>[] {
  const pairs: SimilarPair<T>[] = [];

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const similarity = cosineSimilarity(items[i].embedding, items[j].embedding);

      if (similarity >= threshold) {
        pairs.push({
          item1: items[i].data,
          item2: items[j].data,
          similarity,
        });
      }
    }
  }

  // Sort by similarity (descending)
  pairs.sort((a, b) => b.similarity - a.similarity);

  return pairs;
}

/**
 * Normalize text for comparison
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .trim();
}

/**
 * Check if two texts are exact duplicates (normalized)
 */
export function areExactDuplicates(a: string, b: string): boolean {
  return normalizeText(a) === normalizeText(b);
}

/**
 * Batch items for processing
 */
export function batchItems<T>(items: T[], batchSize: number): T[][] {
  const batches: T[][] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }

  return batches;
}

/**
 * Calculate average embedding (for cluster summarization)
 */
export function averageEmbedding(embeddings: number[][]): number[] {
  if (embeddings.length === 0) {
    throw new Error('Cannot calculate average of empty embedding list');
  }

  const dimensions = embeddings[0].length;
  const sum = new Array(dimensions).fill(0);

  for (const embedding of embeddings) {
    if (embedding.length !== dimensions) {
      throw new Error('All embeddings must have the same dimensions');
    }

    for (let i = 0; i < dimensions; i++) {
      sum[i] += embedding[i];
    }
  }

  return sum.map(val => val / embeddings.length);
}

/**
 * Cluster embeddings using simple k-means
 */
export interface Cluster<T> {
  centroid: number[];
  items: T[];
}

export function clusterEmbeddings<T>(
  items: Array<{ embedding: number[]; data: T }>,
  k: number,
  maxIterations: number = 10
): Cluster<T>[] {
  if (items.length === 0 || k <= 0) {
    return [];
  }

  if (k >= items.length) {
    // Each item is its own cluster
    return items.map(item => ({
      centroid: item.embedding,
      items: [item.data],
    }));
  }

  // Initialize centroids randomly
  const centroids: number[][] = [];
  const indices = new Set<number>();

  while (centroids.length < k) {
    const idx = Math.floor(Math.random() * items.length);
    if (!indices.has(idx)) {
      indices.add(idx);
      centroids.push([...items[idx].embedding]);
    }
  }

  // Run k-means iterations
  for (let iter = 0; iter < maxIterations; iter++) {
    // Assign items to nearest centroid
    const clusters: T[][] = Array.from({ length: k }, () => []);
    const clusterEmbeddings: number[][][] = Array.from({ length: k }, () => []);

    for (const item of items) {
      let nearestIdx = 0;
      let nearestDist = Infinity;

      for (let i = 0; i < k; i++) {
        const similarity = cosineSimilarity(item.embedding, centroids[i]);
        const distance = 1 - similarity; // Convert similarity to distance

        if (distance < nearestDist) {
          nearestDist = distance;
          nearestIdx = i;
        }
      }

      clusters[nearestIdx].push(item.data);
      clusterEmbeddings[nearestIdx].push(item.embedding);
    }

    // Update centroids
    let changed = false;
    for (let i = 0; i < k; i++) {
      if (clusterEmbeddings[i].length > 0) {
        const newCentroid = averageEmbedding(clusterEmbeddings[i]);

        // Check if centroid changed significantly
        const similarity = cosineSimilarity(centroids[i], newCentroid);
        if (similarity < 0.999) {
          changed = true;
        }

        centroids[i] = newCentroid;
      }
    }

    // Early stop if converged
    if (!changed) {
      logger.debug({ iteration: iter + 1 }, 'K-means converged early');
      break;
    }
  }

  // Build final clusters
  const finalClusters: Cluster<T>[] = [];

  for (let i = 0; i < k; i++) {
    const clusterItems: T[] = [];
    const clusterEmbeddings: number[][] = [];

    for (const item of items) {
      const similarity = cosineSimilarity(item.embedding, centroids[i]);
      const distance = 1 - similarity;

      // Find nearest centroid for this item
      let nearestIdx = 0;
      let nearestDist = Infinity;

      for (let j = 0; j < k; j++) {
        const sim = cosineSimilarity(item.embedding, centroids[j]);
        const dist = 1 - sim;

        if (dist < nearestDist) {
          nearestDist = dist;
          nearestIdx = j;
        }
      }

      if (nearestIdx === i) {
        clusterItems.push(item.data);
        clusterEmbeddings.push(item.embedding);
      }
    }

    if (clusterItems.length > 0) {
      finalClusters.push({
        centroid: averageEmbedding(clusterEmbeddings),
        items: clusterItems,
      });
    }
  }

  return finalClusters;
}
