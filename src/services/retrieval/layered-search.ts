/**
 * Layered search implementation for the three-tower memory architecture.
 *
 * Implements a waterfall query strategy:
 * 1. Search core layer first (permanent preferences/decisions)
 * 2. If results insufficient, search journey layer (project-related)
 * 3. If still insufficient, search moment layer (current context)
 *
 * @see docs/layered-index-design.md
 */

import type { Memory } from '../../contracts/types.js';
import type { VectorIndex, VectorSearchResult } from '../../storage/vector-index.js';
import type { MemoryLayer } from './layer-types.js';
import { getLayerWeight, getTypeWeight, calculateFreshnessFactor } from './layer-types.js';

/** Layer search order for waterfall queries */
const LAYER_ORDER: readonly MemoryLayer[] = ['core', 'journey', 'moment'] as const;

/**
 * Result from a single layer search.
 */
export interface LayerSearchResult {
  readonly layer: MemoryLayer;
  readonly results: readonly VectorSearchResult[];
}

/**
 * Scored result with layer-weighted scoring applied.
 */
export interface ScoredResult {
  readonly id: string;
  readonly rawScore: number;
  readonly layerWeight: number;
  readonly typeWeight: number;
  readonly freshnessFactor: number;
  /** layerWeight * typeWeight * freshnessFactor */
  readonly finalWeight: number;
  /** rawScore * finalWeight */
  readonly finalScore: number;
}

/**
 * Options for layered search.
 */
export interface LayeredSearchOptions {
  /** Query vector embedding */
  readonly vector: number[];
  /** Maximum total results to return */
  readonly limit: number;
  /** Minimum score threshold for core layer to short-circuit (default: 0.7) */
  readonly minCoreScore?: number;
  /** Maximum layers to search (1=core only, 2=core+journey, 3=all) */
  readonly maxLayers?: number;
  /** Current time for freshness calculation (default: new Date()) */
  readonly now?: Date;
  /** Function to look up memory by ID for type/freshness weights */
  readonly getMemoryById?: (id: string) => Memory | undefined;
}

/**
 * Converts cosine distance to similarity score (0-1).
 * LanceDB returns cosine distance where 0 = identical, 2 = opposite.
 */
function distanceToScore(distance: number): number {
  // Cosine distance ranges from 0 (identical) to 2 (opposite)
  // Convert to similarity score: 1 = identical, 0 = orthogonal, -1 = opposite
  // For scoring, we want 0-1 range where higher is better
  const similarity = 1 - distance / 2;
  return Math.max(0, Math.min(1, similarity));
}

/**
 * Searches a single layer and returns results with scores.
 */
async function searchLayer(
  index: VectorIndex,
  vector: number[],
  layer: MemoryLayer,
  limit: number
): Promise<LayerSearchResult> {
  const results = await index.searchByLayer(vector, layer, limit);
  return { layer, results };
}

/**
 * Performs waterfall search across memory layers.
 *
 * Strategy:
 * 1. Search core layer first
 * 2. If top result has score >= minCoreScore, return immediately
 * 3. Otherwise, search journey layer and merge results
 * 4. If combined results still insufficient, search moment layer
 * 5. Apply layer weights and return top results
 */
export async function layeredSearch(
  index: VectorIndex,
  options: LayeredSearchOptions
): Promise<readonly ScoredResult[]> {
  const {
    vector,
    limit,
    minCoreScore = 0.7,
    maxLayers = 3,
    now = new Date(),
    getMemoryById,
  } = options;

  const layersToSearch = LAYER_ORDER.slice(0, maxLayers);
  const allResults: Map<string, { layer: MemoryLayer; distance: number }> = new Map();

  // Waterfall through layers
  for (const layer of layersToSearch) {
    const layerResult = await searchLayer(index, vector, layer, limit);

    // Add results to map (first occurrence wins - core layer has priority)
    for (const result of layerResult.results) {
      if (!allResults.has(result.id)) {
        allResults.set(result.id, { layer, distance: result._distance });
      }
    }

    // Check for early termination on core layer
    if (layer === 'core') {
      const topCoreResult = layerResult.results[0];
      if (topCoreResult) {
        const topScore = distanceToScore(topCoreResult._distance);
        if (topScore >= minCoreScore) {
          // Core layer has strong match, short-circuit
          break;
        }
      }
    }

    // Check if we have enough results
    if (allResults.size >= limit) {
      break;
    }
  }

  // Score and weight results
  const scoredResults: ScoredResult[] = [];
  for (const [id, { layer, distance }] of allResults) {
    const rawScore = distanceToScore(distance);
    const layerWeight = getLayerWeight(layer);

    // Get type weight and freshness if memory lookup available
    let typeWeight = 1.0;
    let freshnessFactor = 1.0;

    if (getMemoryById) {
      const memory = getMemoryById(id);
      if (memory) {
        typeWeight = getTypeWeight(memory.entryType);
        freshnessFactor = calculateFreshnessFactor(
          memory.expiresAt,
          memory.createdAt,
          now
        );
      }
    }

    const finalWeight = layerWeight * typeWeight * freshnessFactor;
    const finalScore = rawScore * finalWeight;

    scoredResults.push({
      id,
      rawScore,
      layerWeight,
      typeWeight,
      freshnessFactor,
      finalWeight,
      finalScore,
    });
  }

  // Sort by final score (descending) and return top results
  scoredResults.sort((a, b) => b.finalScore - a.finalScore);
  return scoredResults.slice(0, limit);
}

/**
 * Searches only the specified layers.
 * Useful for targeted searches (e.g., only search core for preferences).
 */
export async function searchLayers(
  index: VectorIndex,
  vector: number[],
  layers: readonly MemoryLayer[],
  limit: number
): Promise<readonly VectorSearchResult[]> {
  const results: VectorSearchResult[] = [];
  const seenIds = new Set<string>();

  for (const layer of layers) {
    const layerResults = await index.searchByLayer(vector, layer, limit);
    for (const result of layerResults) {
      if (!seenIds.has(result.id)) {
        seenIds.add(result.id);
        results.push(result);
      }
    }
    if (results.length >= limit) {
      break;
    }
  }

  return results.slice(0, limit);
}

// Re-export layer utilities for convenience
export { LAYER_ORDER, distanceToScore };
